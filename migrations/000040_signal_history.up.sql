-- Signal history table for per-signal telemetry recording in Postgres.
-- Replaces MongoDB signal_log dependency. Auto-cleaned via TTL (default 7 days).
CREATE TABLE IF NOT EXISTS signal_history (
    id          BIGSERIAL PRIMARY KEY,
    vehicle_id  BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    signal      VARCHAR(100) NOT NULL,
    value_num   DOUBLE PRECISION,
    value_str   VARCHAR(500),
    value_bool  BOOLEAN,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary query: signal history for a vehicle in a time range
CREATE INDEX idx_signal_history_vehicle_signal_time
    ON signal_history (vehicle_id, signal, created_at DESC);

-- TTL cleanup: DELETE WHERE created_at < NOW() - INTERVAL '7 days'
CREATE INDEX idx_signal_history_created
    ON signal_history (created_at);
