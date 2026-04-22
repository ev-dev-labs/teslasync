-- TimescaleDB Hypertable Preflight Audit
--
-- Run before applying migration 000001_create_hypertables.up.sql against any
-- legacy database. On a fresh DB built from migration 000000_baseline.up.sql
-- every check should already report PASS — the baseline was squashed with the
-- composite (id, created_at) primary keys required by create_hypertable().
--
-- Usage:
--   docker exec -i teslasync-postgres psql -U teslasync -d teslasync \
--     -f /repo/scripts/preflight_audit.sql
--
-- Candidate hypertable tables (must satisfy all checks):
--   charging_telemetry, climate_snapshots, security_events, positions,
--   motor_snapshots, tire_pressure_snapshots, media_snapshots, safety_snapshots

\echo '=== HYPERTABLE PREFLIGHT AUDIT ==='
\echo ''

\echo '--- 1. Primary keys must include created_at ---'
SELECT tc.table_name,
       string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) AS pk_columns,
       CASE WHEN bool_or(kcu.column_name = 'created_at') THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema    = kcu.table_schema
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_name IN (
    'charging_telemetry','climate_snapshots','security_events','positions',
    'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots'
  )
GROUP BY tc.table_name
ORDER BY tc.table_name;

\echo ''
\echo '--- 2. Inbound foreign keys (count must be 0) ---'
SELECT count(*) AS inbound_fk_count,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN (
    'charging_telemetry','climate_snapshots','security_events','positions',
    'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots'
  );

-- If the count above is non-zero, this query lists the offenders:
SELECT tc.constraint_name,
       tc.table_name      AS referencing_table,
       kcu.column_name    AS referencing_column,
       ccu.table_name     AS referenced_table,
       ccu.column_name    AS referenced_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON tc.constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_name IN (
    'charging_telemetry','climate_snapshots','security_events','positions',
    'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots'
  )
ORDER BY ccu.table_name, tc.table_name;

\echo ''
\echo '--- 3. BEFORE triggers (count must be 0) ---'
SELECT count(*) AS before_trigger_count,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS status
FROM information_schema.triggers
WHERE event_object_table IN (
    'charging_telemetry','climate_snapshots','security_events','positions',
    'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots'
  )
  AND action_timing = 'BEFORE';

\echo ''
\echo '--- 4. Native PARTITION BY (relkind must be r, never p) ---'
SELECT c.relname,
       c.relkind,
       CASE c.relkind WHEN 'r' THEN 'PASS' ELSE 'FAIL' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relname IN (
    'charging_telemetry','climate_snapshots','security_events','positions',
    'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots'
  )
  AND n.nspname = 'public'
ORDER BY c.relname;

\echo ''
\echo '--- 5. Unique indexes must include created_at ---'
SELECT t.relname AS table_name,
       i.relname AS index_name,
       array_agg(a.attname ORDER BY k.n) AS index_columns,
       CASE WHEN 'created_at' = ANY(array_agg(a.attname)) THEN 'PASS' ELSE 'FAIL' END AS status
FROM pg_class t
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i  ON i.oid = ix.indexrelid
JOIN generate_subscripts(ix.indkey, 1) AS k(n) ON true
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[k.n]
WHERE t.relname IN (
    'charging_telemetry','climate_snapshots','security_events','positions',
    'motor_snapshots','tire_pressure_snapshots','media_snapshots','safety_snapshots'
  )
  AND ix.indisunique
GROUP BY t.relname, i.relname
ORDER BY t.relname, i.relname;

\echo ''
\echo '=== AUDIT COMPLETE — every status column above must be PASS ==='
