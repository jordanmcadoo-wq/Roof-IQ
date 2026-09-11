-- Read-only planner for a rotating working set.
--
-- The free plan ceiling is 500 MB and the database sits at 891 MB, so the
-- useful question is not "what can we delete" but "what is the largest working
-- set that fits". Measured answer: 10,692 bytes per property all-in, so the
-- free plan holds about 49,000 properties.
--
-- This reframes properties as an evictable cache rather than a system of
-- record. It is re-importable: county_sources carries
-- oklahoma_county_tax_parcels, an ArcGIS REST feed with 336,992 records and a
-- deterministic identity (OKCO:<OBJECTID>). Only 87,399 have been pulled, and
-- the pull is paused at continuation_token 93500 by the storage guard.
--
-- Anything carrying work is pinned and never evictable. Every child table
-- cascades on delete of a property -- activities, lead_assignments,
-- opportunities, lead_tasks, ml_outcomes, inspections -- so evicting a worked
-- property destroys the rep's work and the training labels with it.
--
-- STABLE rather than VOLATILE on purpose: it is the machine-checkable
-- guarantee that this function writes nothing. That also rules out temp
-- tables, hence the CTEs.

create or replace function public.roofiq_storage_plan(
  p_radius_m integer default 5000,
  p_min_hail numeric default 1.75,
  p_since date default '2024-01-01'
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
set statement_timeout = '5min'
as $function$
declare
  v_total bigint; v_pinned bigint; v_footprint bigint; v_retained bigint;
  v_bytes bigint; v_per_prop numeric; v_projected bigint;
  v_limit bigint := 524288000;
begin
  select count(*) into v_total from properties;
  select pg_database_size(current_database()) into v_bytes;
  v_per_prop := case when v_total > 0 then v_bytes::numeric / v_total else 0 end;

  with severe as (
    -- Buffers unioned once. A pairwise st_dwithin against every severe event
    -- does not finish inside a sane timeout at this row count.
    select st_union(st_buffer(location::geography, p_radius_m)::geometry) as g
    from storm_events
    where state_code = 'OK' and hail_size_inches >= p_min_hail
      and event_date >= p_since and location is not null
  ),
  pinned as (
    select p.id from properties p
    where not roofiq_lead_untouched(p.lead_status::text)
       or exists (select 1 from activities    a where a.property_id = p.id)
       or exists (select 1 from opportunities o where o.property_id = p.id)
       or exists (select 1 from lead_tasks    t where t.property_id = p.id)
       or exists (select 1 from ml_outcomes   m where m.property_id = p.id)
       or exists (select 1 from inspections   i where i.property_id = p.id)
  ),
  footprint as (
    select p.id from properties p, severe s
    where p.location is not null and st_intersects(p.location::geometry, s.g)
  ),
  retained as (select id from pinned union select id from footprint)
  select (select count(*) from pinned),
         (select count(*) from footprint),
         (select count(*) from retained)
    into v_pinned, v_footprint, v_retained;

  v_projected := round(v_retained * v_per_prop);

  return jsonb_build_object(
    'inputs', jsonb_build_object(
      'radius_m', p_radius_m, 'min_hail_inches', p_min_hail, 'since', p_since),
    'properties_total', v_total,
    'pinned_has_work', v_pinned,
    'inside_hail_footprint', v_footprint,
    'retained', v_retained,
    'evictable', v_total - v_retained,
    'bytes_per_property', round(v_per_prop),
    'mb_now', round(v_bytes/1048576.0, 1),
    'mb_projected', round(v_projected/1048576.0, 1),
    'mb_free_limit', round(v_limit/1048576.0, 1),
    'fits_free_plan', v_projected <= v_limit,
    'max_properties_on_free_plan', floor(v_limit / nullif(v_per_prop,0)),
    'note', 'Measurement only. Nothing is written or deleted.'
  );
end
$function$;

revoke all on function public.roofiq_storage_plan(integer, numeric, date) from anon;
