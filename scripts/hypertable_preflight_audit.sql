-- Hypertable preflight audit: run BEFORE and AFTER migration
-- 000145_hypertable_preflight_fixes to verify all TimescaleDB blockers are
-- resolved before migration 000146_create_hypertables converts the eight
-- candidate telemetry tables into hypertables.
--
-- Usage:
--   psql -U teslasync -d teslasync -f scripts/hypertable_preflight_audit.sql
--
-- Expected BEFORE 000145: "FAIL" rows on PK check for 7 of 8 tables.
-- Expected AFTER  000145: all rows report "PASS".

\echo '=== HYPERTABLE PREFLIGHT AUDIT ==='
\echo ''

\echo '--- 1. Primary Key must include created_at ---'
SELECT tc.table_name,
       string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS pk_columns,
       CASE WHEN bool_or(kcu.column_name = 'created_at') THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
     ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema   = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_name IN ('charging_telemetry','climate_snapshots','security_events','positions',
                        'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
GROUP BY tc.table_name
ORDER BY tc.table_name;

\echo ''
\echo '--- 2. Inbound foreign keys (must be zero) ---'
SELECT count(*) AS inbound_fk_count,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
     ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN ('charging_telemetry','climate_snapshots','security_events','positions',
                         'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots');

\echo ''
\echo '--- 3. BEFORE ROW triggers (must be zero) ---'
SELECT count(*) AS before_trigger_count,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.triggers
WHERE event_object_table IN ('charging_telemetry','climate_snapshots','security_events','positions',
                             'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
  AND action_timing = 'BEFORE';

\echo ''
\echo '--- 4. Native PARTITION BY (must all be PASS = regular tables) ---'
SELECT c.relname AS table_name,
       CASE c.relkind
            WHEN 'r' THEN 'PASS'
            WHEN 'p' THEN 'FAIL (native partitioned table)'
            ELSE 'UNKNOWN relkind=' || c.relkind::text
       END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IN ('charging_telemetry','climate_snapshots','security_events','positions',
                    'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
  AND n.nspname = 'public'
ORDER BY c.relname;

\echo ''
\echo '--- 5. Unique constraints without created_at (must be zero) ---'
WITH uniq_idx AS (
    SELECT t.relname   AS table_name,
           i.relname   AS index_name,
           array_agg(a.attname ORDER BY k.n) AS cols
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i  ON i.oid = ix.indexrelid
    JOIN generate_subscripts(ix.indkey, 1) AS k(n) ON true
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[k.n]
    WHERE ix.indisunique
      AND t.relname IN ('charging_telemetry','climate_snapshots','security_events','positions',
                        'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
    GROUP BY t.relname, i.relname
)
SELECT table_name, index_name, cols,
       CASE WHEN 'created_at' = ANY(cols) THEN 'PASS' ELSE 'FAIL' END AS status
FROM uniq_idx
ORDER BY table_name, index_name;

\echo ''
\echo '--- 6. Outbound foreign keys (informational — allowed on hypertables) ---'
SELECT tc.table_name    AS source_table,
       kcu.column_name  AS source_column,
       ccu.table_name   AS target_table,
       ccu.column_name  AS target_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
     ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
     ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('charging_telemetry','climate_snapshots','security_events','positions',
                        'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots')
ORDER BY tc.table_name;

\echo ''
\echo '=== AUDIT COMPLETE ==='
