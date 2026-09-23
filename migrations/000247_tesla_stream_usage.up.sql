-- Per-field Tesla Fleet Telemetry emissions, not decoded atomics or internal MQTT publications.
-- A source timestamp + hashed topic + payload fingerprint identifies QoS1 redeliveries.
-- Only fingerprints, never raw VINs or telemetry values, are retained.
CREATE TABLE IF NOT EXISTS tesla_stream_usage (
    topic TEXT NOT NULL,
    emitted_at TIMESTAMPTZ NOT NULL,
    payload_sha256 BYTEA NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (topic, emitted_at, payload_sha256)
);
CREATE INDEX IF NOT EXISTS tesla_stream_usage_received_at_idx ON tesla_stream_usage (received_at);
-- Existing idx_api_logs_service_ts covers service + ts; avoid locking the hypertable.
-- Timescale's pre-existing 365-day drop_chunks policy would erase prior cycles.
SELECT remove_retention_policy('api_call_logs', if_exists => TRUE);
