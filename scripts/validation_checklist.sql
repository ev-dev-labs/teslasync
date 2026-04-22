-- validation_checklist.sql
--
-- Comprehensive sanity check after every database migration phase. All checks
-- should produce sensible non-empty output before marking a phase complete.
--
-- Usage:
--   psql "$DB_URL" -f scripts/validation_checklist.sql

\set ON_ERROR_STOP on

\echo '=== POST-MIGRATION VALIDATION CHECKLIST ==='
\echo ''

\echo '--- 1. Row Counts (telemetry tables) ---'
SELECT 'charging_telemetry'      AS table_name, count(*) FROM public.charging_telemetry
UNION ALL SELECT 'climate_snapshots',         count(*) FROM public.climate_snapshots
UNION ALL SELECT 'security_events',           count(*) FROM public.security_events
UNION ALL SELECT 'positions',                 count(*) FROM public.positions
UNION ALL SELECT 'motor_snapshots',           count(*) FROM public.motor_snapshots
UNION ALL SELECT 'tire_pressure_snapshots',   count(*) FROM public.tire_pressure_snapshots
UNION ALL SELECT 'media_snapshots',           count(*) FROM public.media_snapshots
UNION ALL SELECT 'safety_snapshots',          count(*) FROM public.safety_snapshots
ORDER BY table_name;

\echo ''
\echo '--- 2. Hypertables ---'
SELECT
    h.hypertable_name,
    h.num_chunks,
    pg_size_pretty(
        public.hypertable_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)
    ) AS size
FROM timescaledb_information.hypertables h
ORDER BY h.hypertable_name;

\echo ''
\echo '--- 3. Continuous Aggregate Freshness ---'
WITH cagg_latest AS (
    SELECT 'cagg_charging_hourly' AS view_name,
           (SELECT max(bucket) FROM public.cagg_charging_hourly) AS latest_bucket
    UNION ALL SELECT 'cagg_climate_hourly',
           (SELECT max(bucket) FROM public.cagg_climate_hourly)
    UNION ALL SELECT 'cagg_position_hourly',
           (SELECT max(bucket) FROM public.cagg_position_hourly)
    UNION ALL SELECT 'cagg_position_daily',
           (SELECT max(bucket) FROM public.cagg_position_daily)
    UNION ALL SELECT 'cagg_charging_daily',
           (SELECT max(bucket) FROM public.cagg_charging_daily)
    UNION ALL SELECT 'cagg_climate_daily',
           (SELECT max(bucket) FROM public.cagg_climate_daily)
)
SELECT
    view_name,
    latest_bucket,
    NOW() - latest_bucket                                 AS lag,
    CASE
        WHEN latest_bucket IS NULL                  THEN 'EMPTY'
        WHEN NOW() - latest_bucket < INTERVAL '2 days' THEN 'OK'
        ELSE 'STALE'
    END AS status
FROM cagg_latest
ORDER BY view_name;

\echo ''
\echo '--- 4. Compression Status ---'
SELECT hypertable_name,
       count(*) FILTER (WHERE is_compressed)     AS compressed,
       count(*) FILTER (WHERE NOT is_compressed) AS uncompressed
FROM timescaledb_information.chunks
GROUP BY hypertable_name
ORDER BY hypertable_name;

\echo ''
\echo '--- 5. Background Jobs ---'
SELECT j.job_id, j.proc_name, j.schedule_interval,
       js.last_run_status, js.last_successful_finish
FROM timescaledb_information.jobs j
JOIN timescaledb_information.job_stats js USING (job_id)
ORDER BY j.job_id;

\echo ''
\echo '--- 6. Connection Info ---'
SELECT inet_server_addr() AS server_addr,
       inet_server_port() AS server_port,
       current_database() AS db,
       current_user       AS usr,
       version()          AS server_version;

\echo ''
\echo '--- 7. Extensions ---'
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('timescaledb', 'vector', 'pg_stat_statements')
ORDER BY extname;
