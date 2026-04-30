-- Convert signal_history to a TimescaleDB hypertable with compression.
-- Phase-12: enables chunk-based time partitioning and native compression.
-- Retention is NOT managed here — the existing TTL cleanup in
-- signal_history_writer.go:162 handles user-configurable retention.

BEGIN;

-- 1. Drop the surrogate BIGSERIAL id column.
--    CASCADE drops whatever PK constraint exists (name may vary).
ALTER TABLE signal_history DROP COLUMN id;

-- 2. Add composite PK including the partition column (created_at).
--    Matches codebase convention: (entity_key, time_col, discriminator).
ALTER TABLE signal_history ADD PRIMARY KEY (vehicle_id, created_at, signal);

-- 3. Convert to hypertable (1-day chunks, migrate existing rows).
SELECT create_hypertable('signal_history', 'created_at',
    migrate_data       => true,
    chunk_time_interval => INTERVAL '1 day');

-- 4. Enable native compression.
--    Segment by vehicle_id + signal for optimal per-signal decompression.
ALTER TABLE signal_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby  = 'vehicle_id, signal',
    timescaledb.compress_orderby    = 'created_at DESC'
);

-- 5. Compress chunks older than 1 hour (aggressive — signal_history is
--    predominantly read via recent time-range queries).
SELECT add_compression_policy('signal_history', INTERVAL '1 hour');

COMMIT;
