-- performance_benchmark.sql
--
-- Benchmark the top hot-path queries with EXPLAIN (ANALYZE, BUFFERS).
-- Run before and after the migration; compare execution times and plans.
--
-- Usage:
--   psql "$DB_URL" -v vehicle_id=1 -f scripts/performance_benchmark.sql \
--       2>&1 | tee perf_results.txt

\timing on
\set ON_ERROR_STOP on
\if :{?vehicle_id}
\else
    \set vehicle_id 1
\endif

\echo '=== Q1: Latest charging telemetry (API hot path) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM public.charging_telemetry
WHERE vehicle_id = :vehicle_id
ORDER BY created_at DESC
LIMIT 1;

\echo ''
\echo '=== Q2: 30-day battery trend ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT date_trunc('day', created_at) AS day, avg(battery_level) AS avg_battery
FROM public.charging_telemetry
WHERE vehicle_id = :vehicle_id
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '=== Q3: Charging hourly distribution (raw) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT date_trunc('hour', created_at) AS hour, avg(battery_level), count(*)
FROM public.charging_telemetry
WHERE vehicle_id = :vehicle_id
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY 1
ORDER BY 1;

\echo ''
\echo '=== Q4: Continuous aggregate read (should be near-instant) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM public.cagg_charging_hourly
WHERE vehicle_id = :vehicle_id
  AND bucket > NOW() - INTERVAL '30 days'
ORDER BY bucket DESC;

\echo ''
\echo '=== Q5: Daily CAGG roll-up read ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM public.cagg_charging_daily
WHERE vehicle_id = :vehicle_id
  AND bucket > NOW() - INTERVAL '180 days'
ORDER BY bucket DESC;

\echo ''
\echo '=== Q6: Latest position ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM public.positions
WHERE vehicle_id = :vehicle_id
ORDER BY created_at DESC
LIMIT 1;

\echo ''
\echo '=== Q7: Cross-table join (positions x charging) ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT p.created_at, p.latitude, p.longitude, ct.battery_level
FROM public.positions p
JOIN public.charging_telemetry ct
  ON ct.vehicle_id = p.vehicle_id
 AND ct.created_at BETWEEN p.created_at - INTERVAL '1 minute'
                       AND p.created_at + INTERVAL '1 minute'
WHERE p.vehicle_id = :vehicle_id
  AND p.created_at > NOW() - INTERVAL '7 days'
LIMIT 100;

\echo ''
\echo '=== Q8: Fleet-wide aggregation ==='
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT vehicle_id, avg(battery_level) AS avg_battery, count(*)
FROM public.charging_telemetry
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY vehicle_id
ORDER BY avg_battery;

\echo ''
\echo '=== Q9: Semantic search (pgvector, skipped if no embeddings) ==='
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
       AND EXISTS (SELECT 1 FROM public.embeddings LIMIT 1) THEN
        RAISE NOTICE 'pgvector available — running ANN query';
    ELSE
        RAISE NOTICE 'skipped (no pgvector or no embeddings)';
    END IF;
END$$;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT entity_type, content,
       1 - (embedding <=> (SELECT embedding FROM public.embeddings LIMIT 1)) AS similarity
FROM public.embeddings
WHERE vehicle_id = :vehicle_id
ORDER BY embedding <=> (SELECT embedding FROM public.embeddings LIMIT 1)
LIMIT 5;
