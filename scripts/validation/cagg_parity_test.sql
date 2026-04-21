-- cagg_parity_test.sql
-- Verify each continuous aggregate matches the equivalent manual GROUP BY
-- over the raw hypertable for a recent window. Floating-point tolerance of
-- 0.01 absorbs aggregation ordering differences.
--
-- Usage:
--   psql "$DATABASE_URL" -v vehicle_id=1 -v window_days=7 -f scripts/validation/cagg_parity_test.sql

\set ON_ERROR_STOP on
\pset pager off
\set vehicle_id 1
\set window_days 7

\echo ''
\echo '=== Continuous Aggregate Parity ==='
\echo ''

-- ---------------------------------------------------------------------------
-- Helper: absolute difference tolerant comparison
-- ---------------------------------------------------------------------------

-- cagg_charging_hourly
\echo '--- cagg_charging_hourly vs manual GROUP BY ---'
WITH cagg AS (
  SELECT bucket, vehicle_id, avg_battery, sample_count
    FROM cagg_charging_hourly
   WHERE vehicle_id = :vehicle_id
     AND bucket >= NOW() - (:window_days || ' days')::interval
),
manual AS (
  SELECT time_bucket('1 hour', created_at) AS bucket,
         vehicle_id,
         avg((signals->>'battery_level')::double precision) AS avg_battery,
         count(*) AS sample_count
    FROM charging_telemetry
   WHERE vehicle_id = :vehicle_id
     AND created_at >= NOW() - (:window_days || ' days')::interval
   GROUP BY vehicle_id, time_bucket('1 hour', created_at)
),
diff AS (
  SELECT COALESCE(c.bucket, m.bucket) AS bucket,
         c.avg_battery     AS cagg_battery,
         m.avg_battery     AS manual_battery,
         c.sample_count    AS cagg_count,
         m.sample_count    AS manual_count,
         abs(COALESCE(c.avg_battery, 0) - COALESCE(m.avg_battery, 0)) < 0.01 AS battery_ok,
         c.sample_count IS NOT DISTINCT FROM m.sample_count               AS count_ok
    FROM cagg c
    FULL OUTER JOIN manual m USING (bucket, vehicle_id)
)
SELECT count(*)                                        AS total_buckets,
       count(*) FILTER (WHERE NOT battery_ok)          AS battery_mismatches,
       count(*) FILTER (WHERE NOT count_ok)            AS count_mismatches,
       CASE WHEN count(*) FILTER (WHERE NOT (battery_ok AND count_ok)) = 0
            THEN '✅ PASS' ELSE '❌ FAIL' END          AS status
FROM diff;

-- cagg_position_hourly (if present)
\echo ''
\echo '--- cagg_position_hourly vs manual GROUP BY ---'
DO $$
DECLARE
  exists_cagg boolean;
  mismatches  bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM timescaledb_information.continuous_aggregates
     WHERE view_name = 'cagg_position_hourly'
  ) INTO exists_cagg;

  IF NOT exists_cagg THEN
    RAISE NOTICE 'skipped — cagg_position_hourly not installed';
    RETURN;
  END IF;

  EXECUTE $q$
    WITH cagg AS (
      SELECT bucket, vehicle_id, sample_count
        FROM cagg_position_hourly
       WHERE bucket >= NOW() - INTERVAL '7 days'
    ),
    manual AS (
      SELECT time_bucket('1 hour', created_at) AS bucket,
             vehicle_id,
             count(*) AS sample_count
        FROM positions
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY vehicle_id, time_bucket('1 hour', created_at)
    )
    SELECT count(*) FROM cagg c
      FULL OUTER JOIN manual m USING (bucket, vehicle_id)
     WHERE c.sample_count IS DISTINCT FROM m.sample_count
  $q$ INTO mismatches;

  IF mismatches = 0 THEN
    RAISE NOTICE '✅ PASS — cagg_position_hourly matches raw GROUP BY';
  ELSE
    RAISE WARNING '❌ FAIL — % buckets diverge', mismatches;
  END IF;
END $$;

\echo ''
\echo 'Done.'
