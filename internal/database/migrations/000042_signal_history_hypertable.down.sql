-- Reverse: convert signal_history hypertable back to a regular table.

BEGIN;

-- 1. Remove compression policy.
SELECT remove_compression_policy('signal_history', if_exists => true);

-- 2. Decompress all chunks so data can be copied out.
SELECT decompress_chunk(c, if_compressed => true)
FROM show_chunks('signal_history') c;

-- 3. Recreate as a regular table with the original schema.
CREATE TABLE signal_history_plain (
    id          BIGSERIAL PRIMARY KEY,
    vehicle_id  BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    signal      VARCHAR(100) NOT NULL,
    value_num   DOUBLE PRECISION,
    value_str   VARCHAR(500),
    value_bool  BOOLEAN,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO signal_history_plain (vehicle_id, signal, value_num, value_str, value_bool, created_at)
SELECT vehicle_id, signal, value_num, value_str, value_bool, created_at
FROM signal_history;

-- 4. Drop hypertable and rename plain table.
DROP TABLE signal_history;
ALTER TABLE signal_history_plain RENAME TO signal_history;

-- 5. Re-create indexes from original migration 000040.
CREATE INDEX idx_signal_history_vehicle_signal_time
    ON signal_history (vehicle_id, signal, created_at DESC);

CREATE INDEX idx_signal_history_created
    ON signal_history (created_at);

COMMIT;
