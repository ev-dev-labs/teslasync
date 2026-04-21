-- validation_checklist.sql
-- Post-migration-phase smoke test. Every section should report ✅ PASS;
-- ❌ FAIL means that phase is not safe to mark complete.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/validation/validation_checklist.sql

\set ON_ERROR_STOP on
\pset pager off

\echo ''
\echo '================ POST-MIGRATION VALIDATION CHECKLIST ================'
\echo ''

-- ---------------------------------------------------------------------------
-- Check 1: baseline row counts
-- ---------------------------------------------------------------------------
\echo '--- 1. Table row counts ---'
SELECT 'charging_telemetry'      AS relation, count(*)::text AS rows FROM charging_telemetry
UNION ALL SELECT 'climate_snapshots',          count(*)::text FROM climate_snapshots
UNION ALL SELECT 'security_events',            count(*)::text FROM security_events
UNION ALL SELECT 'positions',                  count(*)::text FROM positions
UNION ALL SELECT 'motor_snapshots',            count(*)::text FROM motor_snapshots
UNION ALL SELECT 'tire_pressure_snapshots',    count(*)::text FROM tire_pressure_snapshots
UNION ALL SELECT 'media_snapshots',            count(*)::text FROM media_snapshots
UNION ALL SELECT 'safety_snapshots',           count(*)::text FROM safety_snapshots
ORDER BY relation;

-- ---------------------------------------------------------------------------
-- Check 2: JSONB backfill completeness
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 2. JSONB backfill completeness ---'
WITH tables(t) AS (VALUES
  ('charging_telemetry'),('climate_snapshots'),('security_events'),
  ('positions'),('motor_snapshots'),('tire_pressure_snapshots'),
  ('media_snapshots'),('safety_snapshots')
), stats AS (
  SELECT t,
         (SELECT count(*) FROM pg_class c WHERE c.relname = t) AS exists_,
         (SELECT count(*) FROM information_schema.columns
           WHERE table_name = t AND column_name = 'signals') AS has_signals
    FROM tables
)
SELECT t                      AS relation,
       CASE WHEN exists_ = 0  THEN '⏭ table missing'
            WHEN has_signals = 0 THEN '⏭ signals column missing'
            ELSE 'checking…' END AS status
FROM stats ORDER BY t;

-- Actual NULL/empty signals scan (one row per table)
DO $$
DECLARE
  r record;
  empty_count bigint;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
     WHERE c.column_name = 'signals' AND c.table_schema = 'public'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE signals IS NULL OR signals = ''{}''::jsonb',
      r.table_name
    ) INTO empty_count;
    IF empty_count = 0 THEN
      RAISE NOTICE '  %: ✅ PASS (no empty signals)', r.table_name;
    ELSE
      RAISE WARNING '  %: ❌ FAIL (% empty signals rows)', r.table_name, empty_count;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Check 3: hypertables
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 3. Hypertable status ---'
SELECT hypertable_name,
       num_chunks,
       pg_size_pretty(
         hypertable_size(format('%I.%I', hypertable_schema, hypertable_name)::regclass)
       ) AS size
  FROM timescaledb_information.hypertables
 ORDER BY hypertable_name;

-- ---------------------------------------------------------------------------
-- Check 4: continuous aggregate freshness
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 4. Continuous aggregate freshness ---'
SELECT view_name,
       materialization_hypertable_schema
         || '.' || materialization_hypertable_name AS mat_table
  FROM timescaledb_information.continuous_aggregates
 ORDER BY view_name;

-- Report lag between latest bucket and wall clock for charging CAGG
DO $$
DECLARE
  latest timestamptz;
  lag    interval;
BEGIN
  IF to_regclass('public.cagg_charging_hourly') IS NULL THEN
    RAISE NOTICE '  cagg_charging_hourly not installed — skipping lag check';
    RETURN;
  END IF;

  EXECUTE 'SELECT max(bucket) FROM cagg_charging_hourly' INTO latest;
  lag := NOW() - COALESCE(latest, '-infinity'::timestamptz);
  IF latest IS NULL THEN
    RAISE NOTICE '  cagg_charging_hourly: empty (no data yet)';
  ELSIF lag < INTERVAL '2 hours' THEN
    RAISE NOTICE '  cagg_charging_hourly: ✅ PASS (lag %)', lag;
  ELSE
    RAISE WARNING '  cagg_charging_hourly: ❌ FAIL (lag %)', lag;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Check 5: compression
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 5. Compression status ---'
SELECT hypertable_name,
       count(*) FILTER (WHERE is_compressed)     AS compressed,
       count(*) FILTER (WHERE NOT is_compressed) AS uncompressed
  FROM timescaledb_information.chunks
 GROUP BY hypertable_name
 ORDER BY hypertable_name;

-- ---------------------------------------------------------------------------
-- Check 6: compatibility views
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 6. Compatibility views ---'
SELECT table_name AS view_name, 'EXISTS' AS status
  FROM information_schema.views
 WHERE table_schema = 'public' AND table_name LIKE 'v_%'
 ORDER BY table_name;

-- ---------------------------------------------------------------------------
-- Check 7: connection details (useful when running through PgBouncer)
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 7. Backend connection info ---'
SELECT current_database()          AS database,
       current_user                AS "user",
       inet_server_addr()::text    AS server_ip,
       inet_server_port()          AS server_port,
       version()                   AS version;

\echo ''
\echo 'Checklist complete — review any ❌ FAIL notices above.'
