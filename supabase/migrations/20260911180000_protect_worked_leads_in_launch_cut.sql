-- Stop the hourly launch-cut rebuild from discarding work a rep has already done.
--
-- roofiq_rebuild_launch_cut() selected only A1/A2 properties and then ran:
--
--   delete from lead_assignments a
--   where a.organization_id = v_org
--     and not exists (select 1 from okc_launch_cut c where c.property_id = a.property_id);
--
-- Bands are percentiles, not absolute thresholds -- A1 is 1.53% and A2 3.95% of
-- whatever is in the table -- so a door can leave the cut because a storm
-- somewhere else outranked it, with nothing about that door having changed. When
-- that happened, the rep's assignment was deleted: the knock, the ownership and
-- the booked follow-up lost their link to the lead. roofiq-launch-cut-rebuild
-- runs at 25 * * * *, so this fires hourly once scoring resumes.
--
-- Two rules now:
--
--   * A lead that has been worked and is still open stays IN the cut, so the rep
--     can still see and finish the door.
--   * A lead that has been worked at all keeps its assignment, even once it is
--     out of the cut. Terminal outcomes (sold, lost, do_not_contact,
--     not_qualified) deliberately do NOT return to the walk list -- nobody wants
--     a do-not-contact door back on a route -- but the record of who worked it
--     survives.
--
-- Only genuinely untouched leads are still cleaned up, which was the original
-- and correct intent.
--
-- The eligibility rule lives in one function because it is needed in three
-- places: the rebuild's selection, the drift detector, and the delete guard. A
-- copy in each is how the cut and its drift check would silently disagree --
-- and a cut row the drift detector considers ineligible is permanent drift,
-- which would rebuild every hour forever.

create or replace function public.roofiq_cut_eligible(p_band text, p_status text)
returns boolean language sql immutable parallel safe as $$
  select p_band in ('A1', 'A2')
      or coalesce(p_status, 'new') in (
           'knocked', 'contact_made', 'attempted', 'contacted',
           'inspection_scheduled', 'inspection_set', 'inspection_complete',
           'estimate_sent', 'estimate', 'claim_filed')
$$;

comment on function public.roofiq_cut_eligible(text, text) is
  'Belongs in okc_launch_cut: currently top-band, or worked and still open. '
  'Terminal outcomes are excluded so a closed door does not return to a route.';

create or replace function public.roofiq_lead_untouched(p_status text)
returns boolean language sql immutable parallel safe as $$
  select coalesce(p_status, 'new') in ('new', 'researching', 'assigned', 'route_ready')
$$;

comment on function public.roofiq_lead_untouched(text) is
  'No rep has acted on this lead, so its assignment is safe to reap.';

create or replace function public.roofiq_rebuild_launch_cut(p_zones integer default 30, p_top integer default 300)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_org uuid; v_cut int; v_new int; v_gone int; v_kept int; v_terr_new int; v_terr_upd int;
begin
  select id into v_org from organizations where slug = 'roofiq-ai' limit 1;

  create temp table _cut on commit drop as
  with sel as (
    -- left join, not inner: 1,748 properties have no shadow row, and a lead a
    -- rep has worked must not fall out of the cut because its score is missing.
    select p.id as property_id, p.sales_priority_band as band, p.sales_rank_score as rank_score,
           p.city, p.lead_score, p.location::geometry as geom,
           coalesce(s.damage_score, 0) as damage_score
    from properties p
    left join sales_rank_v4_shadow s on s.property_id = p.id
    where p.location is not null
      and roofiq_cut_eligible(p.sales_priority_band, p.lead_status::text)
  ),
  k as (select sel.*, st_clusterkmeans(geom, p_zones) over () as k from sel),
  ord as (select k, dense_rank() over (order by avg(damage_score) desc) as zone_no from k group by k),
  named as (select k.*, o.zone_no from k join ord o on o.k = k.k)
  select property_id, k, band, rank_score, city, geom, zone_no, lead_score, damage_score,
         row_number() over (partition by zone_no order by st_geohash(geom, 9))::int as stop_order,
         (row_number() over (order by lead_score desc nulls last, damage_score desc, property_id) <= p_top) as top300
  from named;

  select count(*) into v_cut from _cut;

  -- Zone label keeps the established convention: 'OKC Launch · Zone NN · <dominant city>'.
  create temp table _zone on commit drop as
  select c.zone_no,
         'OKC Launch · Zone ' || lpad(c.zone_no::text, 2, '0') || ' · ' ||
           coalesce((select c2.city from _cut c2 where c2.zone_no = c.zone_no and c2.city is not null
                     group by c2.city order by count(*) desc, c2.city limit 1), 'Oklahoma City') as zone_name,
         -- Buffered hull: a collinear zone hulls to a LineString and territories.geometry
         -- is MultiPolygon. ~0.0002 deg is about 20 m.
         st_multi(st_buffer(st_convexhull(st_collect(c.geom)), 0.0002)) as geom,
         count(*)::int as n,
         count(*) filter (where c.band = 'A1')::int as n_a1
  from _cut c group by c.zone_no;

  -- Territories are matched on the ZONE NUMBER parsed out of the existing name, not on the
  -- whole name. The name carries the dominant city, which moves when k-means re-clusters;
  -- matching on the full string would create 30 duplicate territories and strand the rep
  -- already assigned to each zone.
  create temp table _terr on commit drop as
  select t.id, (regexp_match(t.name, 'Zone\s*(\d+)'))[1]::int as zone_no
  from territories t
  where t.organization_id = v_org and t.name ~ 'Zone\s*\d+';

  update territories t set
    name = z.zone_name, geometry = z.geom, property_count = z.n,
    high_priority_count = z.n_a1, last_calculated_at = now(), updated_at = now()
  from _zone z join _terr x on x.zone_no = z.zone_no
  where t.id = x.id;
  get diagnostics v_terr_upd = row_count;

  insert into territories (organization_id, name, county, geometry, status,
                           property_count, high_priority_count, last_calculated_at)
  select v_org, z.zone_name, 'Oklahoma', z.geom, 'active', z.n, z.n_a1, now()
  from _zone z
  where not exists (select 1 from _terr x where x.zone_no = z.zone_no);
  get diagnostics v_terr_new = row_count;

  truncate okc_launch_cut;
  insert into okc_launch_cut (property_id, k, band, rank_score, city, geom,
                              territory_id, zone_name, top300, stop_order)
  select c.property_id, c.k, c.band, c.rank_score, c.city, c.geom,
         t.id, z.zone_name, c.top300, c.stop_order
  from _cut c
  join _zone z on z.zone_no = c.zone_no
  left join territories t on t.organization_id = v_org and t.name = z.zone_name;

  -- Only reap assignments for leads nobody has touched. A worked lead that has
  -- gone terminal is out of the cut by design, but its assignment is the record
  -- of who worked it. A missing property row is still reaped.
  delete from lead_assignments a
  where a.organization_id = v_org
    and not exists (select 1 from okc_launch_cut c where c.property_id = a.property_id)
    and coalesce(
          (select roofiq_lead_untouched(p.lead_status::text)
             from properties p where p.id = a.property_id),
          true);
  get diagnostics v_gone = row_count;

  -- priority is an integer here: 1 = A1, 2 = A2. A lead that moved A2 -> A1 must not keep 2.
  update lead_assignments a
     set territory_id = c.territory_id,
         priority = case when c.band = 'A1' then 1 else 2 end,
         updated_at = now()
  from okc_launch_cut c
  where c.property_id = a.property_id and a.organization_id = v_org
    and (a.territory_id is distinct from c.territory_id
         or a.priority is distinct from case when c.band = 'A1' then 1 else 2 end);
  get diagnostics v_kept = row_count;

  -- assigned_to is NOT NULL; a new assignment inherits the rep who already owns that zone.
  insert into lead_assignments (organization_id, property_id, territory_id, assigned_to,
                                status, priority, assigned_at)
  select v_org, c.property_id, c.territory_id,
         coalesce(t.assigned_to,
                  (select a2.assigned_to from lead_assignments a2
                    where a2.organization_id = v_org and a2.assigned_to is not null limit 1)),
         'assigned', case when c.band = 'A1' then 1 else 2 end, now()
  from okc_launch_cut c
  left join territories t on t.id = c.territory_id
  where not exists (select 1 from lead_assignments a
                    where a.property_id = c.property_id and a.organization_id = v_org);
  get diagnostics v_new = row_count;

  return jsonb_build_object(
    'cut', v_cut,
    'zones', (select count(distinct zone_name) from okc_launch_cut),
    'territories_updated', v_terr_upd, 'territories_created', v_terr_new,
    'top300', (select count(*) from okc_launch_cut where top300),
    'assignments_added', v_new, 'assignments_removed', v_gone, 'assignments_updated', v_kept,
    'worked_retained', (select count(*) from okc_launch_cut c join properties p on p.id = c.property_id
                        where p.sales_priority_band not in ('A1','A2')),
    'launch_view', (select count(*) from okc_launch_leads_v));
end
$function$;

create or replace function public.roofiq_rebuild_launch_cut_if_ready()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_pending int; v_drift int;
begin
  -- Never rebuild mid-promotion: the cut would be built from a half-applied band set.
  select count(*) into v_pending from sales_rank_v4_shadow where not applied;
  if v_pending > 0 then
    return jsonb_build_object('skipped','promotion_in_flight','pending',v_pending);
  end if;

  -- Drift must be measured with the SAME eligibility rule the rebuild selects on.
  -- Measuring it as "not A1/A2" while the rebuild also keeps worked-open leads
  -- would score every retained lead as drift and rebuild every hour forever.
  -- The location check matches the rebuild too: a property with no geometry can
  -- never enter the cut, so counting it as missing would be permanent drift.
  select (select count(*) from properties p
           where p.location is not null
             and roofiq_cut_eligible(p.sales_priority_band, p.lead_status::text)
             and not exists (select 1 from okc_launch_cut c where c.property_id = p.id))
       + (select count(*) from okc_launch_cut c
           join properties p on p.id = c.property_id
          where not roofiq_cut_eligible(p.sales_priority_band, p.lead_status::text))
    into v_drift;

  if v_drift = 0 then
    return jsonb_build_object('skipped','no_drift','cut',(select count(*) from okc_launch_cut));
  end if;

  return jsonb_build_object('drift', v_drift, 'rebuilt', roofiq_rebuild_launch_cut());
end
$function$;
