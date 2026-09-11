-- RoofIQ field app: one read surface for the rep route.
--
-- Why this view exists:
--   1. okc_launch_cut has no foreign key to properties, so PostgREST cannot
--      embed the join. Without this, the client needs N+1 round trips.
--   2. geom is a PostGIS geography column. Selected directly over PostgREST it
--      comes back as EWKB hex, which is useless to a map. st_y/st_x here hand
--      the client plain numeric lat/lon.
--
-- security_invoker = true keeps row-level security intact: the view runs as the
-- querying user, so the existing org-scoping policies on properties and
-- okc_launch_cut still apply. Without it a view would run as its owner and
-- quietly bypass RLS.

create or replace view public.rep_route_leads
with (security_invoker = true) as
select
  c.property_id,
  c.zone_name,
  c.stop_order,
  c.band,
  c.rank_score,
  c.top300,
  c.city              as zone_city,
  c.territory_id,
  st_y(c.geom::geometry) as lat,
  st_x(c.geom::geometry) as lon,
  p.organization_id,
  p.property_address,
  p.owner_name,
  p.mailing_address,
  p.market_value,
  p.year_built,
  p.building_area,
  p.owner_occupied,
  p.lead_status,
  p.lead_priority,
  p.assigned_to,
  p.contact_name,
  p.contact_phone,
  p.last_contacted_at,
  p.has_recent_roof_permit,
  p.roof_age_estimate,
  p.sales_priority_band,
  p.sales_action_timing,
  p.sales_evidence_quality,
  p.lead_value_estimate,
  s.strongest_hail_inches,
  s.strongest_wind_mph,
  s.latest_storm_at,
  s.storm_event_count,
  s.storm_confidence,
  s.storm_score
from public.okc_launch_cut c
join public.properties p
  on p.id = c.property_id
left join public.property_storm_summary s
  on s.property_id = c.property_id;

comment on view public.rep_route_leads is
  'Denormalised door-knock route for the field app: launch-cut walk order joined to
   property and storm facts, with geography projected to plain lat/lon. Runs as the
   querying user (security_invoker), so org RLS on the base tables still applies.';

grant select on public.rep_route_leads to authenticated;

-- The public schema's default privileges hand `anon` full rights on any newly
-- created view. security_invoker already prevents a leak (anon holds no grant on
-- okc_launch_cut and no RLS policy on properties grants it rows), but that is
-- defence by accident rather than by intent. State it outright: this view is for
-- signed-in reps, and read-only even for them.
revoke all on public.rep_route_leads from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.rep_route_leads from authenticated;
