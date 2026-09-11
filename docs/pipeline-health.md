# Pipeline health — findings, 2026-09-11

A snapshot of why RoofIQ's storm data stopped moving, taken while investigating a
request to "increase storm data". Nothing here was changed: the guard, the
scoring functions and the cron schedules are all as found. This is the diagnosis
and the options, so the decision can be made on evidence.

## The short version

Ingestion is not broken. It switched itself off on 2026-09-07 because the
database outgrew its storage limit, and every downstream feed has been coasting
on stale data since.

## Root cause: the storage guard

`public.pipeline_storage_guard()` returns:

```json
{
  "safe": false,
  "ingestion_safe": false,
  "mrms_history_safe": false,
  "score_queue_safe": false,
  "database_bytes": 933764243,
  "automatic_growth_limit_bytes": 524288000,
  "mrms_backfill_pause_bytes": 450887680,
  "assessor_hard_stop_bytes": 461373440
}
```

**891 MB against a 500 MB limit — 78% over.** Every storage-gated threshold is
behind us.

`private.invoke_roofiq_mrms_if_safe()` reads that flag first:

```sql
v_guard := public.pipeline_storage_guard();
if coalesce((v_guard->>'safe')::boolean, false) is false then return null; end if;
```

So the cron fires on schedule, the guard says no, and the function returns
without invoking the edge function. This is the guard working as designed.

### Why the crons look healthy

`cron.job_run_details` reports `roofiq-mrms-hail-sync` succeeding 48 times in 24
hours. That is true and misleading: the job succeeds because the *SQL statement*
completed. It measures whether the invocation was queued, not whether anything
was ingested.

The real outcome lives in `public.sync_jobs`, where `mrms_mesh_1440_live` last
recorded a run at **2026-09-07 23:42** with **0 records inserted**, and nothing
since.

Any monitoring that watches cron exit status rather than `sync_jobs` rows will
report this pipeline as healthy for as long as it stays broken.

## Freshness against the project's own thresholds

Thresholds come from `public.roofiq_data_sources`, measured 2026-09-11 ~07:20Z.

| Feed | Age | Warn | Fail | |
| --- | ---: | ---: | ---: | --- |
| `hail_mrms_files` | 80h | 6h | 36h | fail |
| `scoring` | 77h | 6h | 24h | fail |
| `map_feed` | 78h | 12h | 48h | fail |
| `storm_events` | 67h | 12h | 48h | fail |
| `permits` | 400h | 168h | 336h | fail |
| `wind_exposure` | 99h | 48h | 168h | warn |
| `hail_swdi` | 70h | 30h | 72h | warn |
| `hail_mrms_summary` | 1140h | 336h | 1440h | warn |

The scoring row matters most. Its own note in `roofiq_data_sources` reads: *"If
this goes stale the field list is running on yesterday's model."* At 77 hours
against a 24-hour failure threshold, reps are working a three-day-old ranking.

## A second, independent failure

`roofiq-v4-refresh-start` fails nightly:

```
ERROR:  canceling statement due to statement timeout
CONTEXT: insert into sales_rank_v4_shadow (...)
         PL/pgSQL function roofiq_shadow_score_v5() line 6 at SQL statement
         PL/pgSQL function roofiq_v4_refresh_start() line 6 at assignment
```

`roofiq_shadow_score_v5()` scores every property in one statement — a CTE chain
over `property_hail_events` (277k rows) joined to properties, wind exposure and
the MRMS summary, with two window functions at the end. It exceeds
`statement_timeout`.

**This will not resolve when storage clears.** It needs the insert batched by
property range, or a raised `statement_timeout` scoped to that job. The second is
a smaller change and the first is the durable one.

## Why pruning does not fix the storage problem

Getting under 500 MB means reclaiming roughly 391 MB. The candidates do not add
up to that, and the obvious ones are load-bearing:

| Table | Size | Verdict |
| --- | ---: | --- |
| `properties` | 380 MB | Real data. 287 MB heap, 92 MB indexes, `score_breakdown` alone 62 MB. Autovacuum is current — no dead-tuple bloat to reclaim. |
| `property_storm_summary` | 73 MB | Live; the map feed reads it. |
| `owner_entities` | 71 MB | Live. |
| `property_hail_events` | 56 MB | The storm history the app now renders. |
| `property_storm_summaries` | 49 MB | Looks like a duplicate of `property_storm_summary` (same 87,399 rows) but **15 functions reference it**. Not safely droppable without tracing each one. |
| `sales_rank_v4_shadow` | 45 MB | Challenger output; its own comment says never read by the app. The most plausible candidate, and it is 45 MB against a 391 MB gap. |

Upgrading Supabase is the proportionate fix. Pruning trades real risk for a
fraction of the space needed.

## Re-checking this

```sql
-- Is the pipeline allowed to run?
select public.pipeline_storage_guard();

-- Did anything actually ingest, as opposed to merely being queued?
select job_type, status, max(created_at), sum(records_inserted)
from public.sync_jobs
where created_at > now() - interval '2 days'
group by 1, 2;

-- Which feeds are past their own thresholds?
select source_key, label, warn_after_hours, fail_after_hours, freshness_sql
from public.roofiq_data_sources where active;

-- What is failing on a schedule?
select j.jobname, d.status, d.start_time, d.return_message
from cron.job_run_details d join cron.job j using (jobid)
where d.status <> 'succeeded' and d.start_time > now() - interval '2 days'
order by d.start_time desc;
```

## Suggested order

1. Raise the storage ceiling. Nothing else moves until `safe` flips to true.
2. Watch the backlog drain: `mrms_source_files.processed_at` should start
   advancing, then `property_mrms_hail_summary.calculated_at`, then
   `properties.scored_at`.
3. Fix `roofiq_shadow_score_v5()` separately — it fails on its own merits.
4. Consider alerting on `sync_jobs` rows rather than cron exit status, so the
   next stall is visible on day one instead of day four.
