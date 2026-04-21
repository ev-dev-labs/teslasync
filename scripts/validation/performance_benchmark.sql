-- performance_benchmark.sql
-- EXPLAIN (ANALYZE, BUFFERS) for the hottest queries after the JSONB +
-- hypertable + CAGG refactor. Capture output both pre- and post-change
-- and diff the plan shapes and timings.
--
-- Usage:
--   psql "$DATABASE_URL" \
--     -v vehicle_id=1 \
--     -f scripts/validation/performance_benchmark.sql \
--     2>&1 | tee perf_$(date +%Y%m%d_%H%M%S).txt

\set ON_ERROR_STOP on
\timing on
\pset pager off
\set vehicle_id 1

\echo ''
\echo '=== Query 1: latest charging telemetry (API hot path) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM charging_telemetry
 WHERE vehicle_id = :vehicle_id
 ORDER BY created_at DESC
 LIMIT 1;

\echo ''
\echo '=== Query 2: 30-day battery trend (daily bucket) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT time_bucket('1 day', created_at) AS day,
       avg((signals->>'battery_level')::double precision) AS avg_battery
  FROM charging_telemetry
 WHERE vehicle_id = :vehicle_id
   AND created_at > NOW() - INTERVAL '30 days'
 GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== Query 3: 7-day hourly charging distribution ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT time_bucket('1 hour', created_at) AS hour,
       avg((signals->>'battery_level')::double precision) AS avg_battery,
       count(*) AS samples
  FROM charging_telemetry
 WHERE vehicle_id = :vehicle_id
   AND created_at > NOW() - INTERVAL '7 days'
 GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== Query 4: JSONB signal extraction, 24h window ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT created_at,
       (signals->>'soc')::double precision         AS soc,
       (signals->>'charge_amps')::double precision AS amps
  FROM charging_telemetry
 WHERE vehicle_id = :vehicle_id
   AND created_at > NOW() - INTERVAL '24 hours'
 ORDER BY created_at DESC;

\echo ''
\echo '=== Query 5: compatibility view vs base table ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM v_charging_telemetry
 WHERE vehicle_id = :vehicle_id
   AND created_at > NOW() - INTERVAL '24 hours'
 ORDER BY created_at DESC
 LIMIT 100;

\echo ''
\echo '=== Query 6: continuous aggregate (should be instant) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM cagg_charging_hourly
 WHERE vehicle_id = :vehicle_id
   AND bucket > NOW() - INTERVAL '30 days'
 ORDER BY bucket DESC;

\echo ''
\echo '=== Query 7: analytics function (fn_battery_degradation_rate) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM fn_battery_degradation_rate(:vehicle_id);

\echo ''
\echo '=== Query 8: positions × charging cross-join (7d) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.created_at, p.latitude, p.longitude,
       (ct.signals->>'battery_level')::double precision AS battery
  FROM positions p
  JOIN charging_telemetry ct
    ON ct.vehicle_id = p.vehicle_id
   AND ct.created_at BETWEEN p.created_at - INTERVAL '1 minute'
                          AND p.created_at + INTERVAL '1 minute'
 WHERE p.vehicle_id = :vehicle_id
   AND p.created_at > NOW() - INTERVAL '7 days'
 LIMIT 100;

\echo ''
\echo '=== Query 9: pgvector semantic search (if installed) ==='
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
     AND to_regclass('public.embeddings') IS NOT NULL THEN
    EXECUTE $q$
      EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
      SELECT entity_type, content,
             1 - (embedding <=> (SELECT embedding FROM embeddings LIMIT 1)) AS similarity
        FROM embeddings
       ORDER BY embedding <=> (SELECT embedding FROM embeddings LIMIT 1)
       LIMIT 5
    $q$;
  ELSE
    RAISE NOTICE 'pgvector / embeddings not present — skipping';
  END IF;
END $$;

\echo ''
\echo '=== Query 10: fleet-wide aggregation (all vehicles, 7d) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT vehicle_id,
       avg((signals->>'battery_level')::double precision) AS avg_battery,
       count(*) AS samples
  FROM charging_telemetry
 WHERE created_at > NOW() - INTERVAL '7 days'
 GROUP BY vehicle_id
 ORDER BY avg_battery NULLS LAST;

\echo ''
\echo 'Done.'
