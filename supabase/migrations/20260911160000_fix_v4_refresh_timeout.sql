-- The nightly roofiq-v4-refresh-start job kept failing with
-- "canceling statement due to statement timeout" at ~121 seconds.
--
-- An earlier attempt set statement_timeout = '20min' on the functions
-- themselves (roofiq_v4_refresh_start, roofiq_shadow_score_v5). That does not
-- work, and the 2026-09-11 run failed identically. PostgreSQL arms the
-- statement-timeout timer when the TOP-LEVEL statement starts, using the
-- session value at that instant. pg_cron's command was
--
--   select roofiq_v4_refresh_start();
--
-- so the timer was already armed at the global 120000ms before the function
-- body -- and its SET -- was ever entered.
--
-- Demonstrated in a rolled-back transaction:
--
--   set statement_timeout = '1s';
--   create function pg_temp.timeout_probe() returns int
--     language plpgsql set statement_timeout = '30s' as $$
--   begin perform pg_sleep(3); return 1; end $$;
--   select pg_temp.timeout_probe();   -- ERROR: statement timeout
--
-- Raising it in a separate statement BEFORE the long one does work, so the
-- cron command now carries its own SET. The global 2-minute guard still
-- protects every other query, and the API roles keep their own tighter caps
-- (anon 3s, authenticated 8s); only this one nightly job runs long.
--
-- Batching remains rejected: bands come from
-- percent_rank() over (partition by organization_id order by dmg), and a
-- window function needs its whole partition. Splitting by property range would
-- compute percentiles per batch and silently mis-band every lead.

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'roofiq-v4-refresh-start';
  if v_jobid is null then
    raise notice 'roofiq-v4-refresh-start not scheduled here; nothing to alter';
    return;
  end if;

  perform cron.alter_job(
    job_id  := v_jobid,
    command := $cmd$set statement_timeout = '20min'; select roofiq_v4_refresh_start();$cmd$
  );
end $$;
