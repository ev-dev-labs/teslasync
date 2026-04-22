-- row_count_parity.sql
--
-- Run this script against BOTH the source database (legacy PG17) and the
-- target database (TimescaleDB after pg_dump/restore + hypertable conversion).
-- Diff the two outputs to verify zero data loss during migration.
--
-- Usage:
--   psql "$SRC_URL"    -A -t -F, -f scripts/row_count_parity.sql > rows_source.txt
--   psql "$TARGET_URL" -A -t -F, -f scripts/row_count_parity.sql > rows_target.txt
--   diff rows_source.txt rows_target.txt && echo "PASS: row counts match"

\pset footer off
\pset border 0

SELECT 'charging_telemetry'      AS t, count(*) AS rows FROM public.charging_telemetry
UNION ALL SELECT 'climate_snapshots',         count(*) FROM public.climate_snapshots
UNION ALL SELECT 'security_events',           count(*) FROM public.security_events
UNION ALL SELECT 'positions',                 count(*) FROM public.positions
UNION ALL SELECT 'motor_snapshots',           count(*) FROM public.motor_snapshots
UNION ALL SELECT 'tire_pressure_snapshots',   count(*) FROM public.tire_pressure_snapshots
UNION ALL SELECT 'media_snapshots',           count(*) FROM public.media_snapshots
UNION ALL SELECT 'safety_snapshots',          count(*) FROM public.safety_snapshots
UNION ALL SELECT 'drives',                    count(*) FROM public.drives
UNION ALL SELECT 'charging_sessions',         count(*) FROM public.charging_sessions
ORDER BY t;

-- Hypertable chunk + size summary (only meaningful on the target DB).
\echo ''
\echo '--- Hypertable Chunk Summary ---'

SELECT
    h.hypertable_name,
    h.num_chunks,
    pg_size_pretty(
        public.hypertable_size(format('%I.%I', h.hypertable_schema, h.hypertable_name)::regclass)
    ) AS size
FROM timescaledb_information.hypertables h
ORDER BY h.hypertable_name;
