-- Phase-14: Rename signal_history → signal_log, widen columns, add value_jsonb,
-- convert to hypertable with compression.
-- Precondition: signal_history is a plain table with id BIGSERIAL PK (from 000040).

BEGIN;

-- 1. Rename table to canonical name.
ALTER TABLE signal_history RENAME TO signal_log;

-- 2. Widen columns to prevent prod overflow crashes.
ALTER TABLE signal_log ALTER COLUMN signal TYPE TEXT;
ALTER TABLE signal_log ALTER COLUMN value_str TYPE TEXT;

-- 3. Add compound signal column (DoorState, DetailedChargeState, etc.).
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS value_jsonb JSONB;

-- 4. Drop old PK (hypertable needs time column in PK).
ALTER TABLE signal_log DROP CONSTRAINT IF EXISTS signal_history_pkey;
ALTER TABLE signal_log DROP COLUMN IF EXISTS id;

-- 5. Add new composite PK.
ALTER TABLE signal_log ADD PRIMARY KEY (created_at, vehicle_id, signal);

-- 6. Rename indexes to match new table name.
ALTER INDEX IF EXISTS idx_signal_history_created RENAME TO idx_signal_log_created;
ALTER INDEX IF EXISTS idx_signal_history_vehicle_signal_time RENAME TO idx_signal_log_vehicle_signal_time;

-- 7. Convert to hypertable (1-day chunks, migrate existing rows).
SELECT create_hypertable('signal_log', 'created_at',
    migrate_data        => true,
    chunk_time_interval => INTERVAL '1 day'
);

-- 8. Enable native compression.
ALTER TABLE signal_log SET (
    timescaledb.compress,
    timescaledb.compress_segmentby  = 'vehicle_id, signal',
    timescaledb.compress_orderby    = 'created_at DESC'
);

-- 9. Compress chunks older than 1 hour.
SELECT add_compression_policy('signal_log', INTERVAL '1 hour');

COMMIT;
