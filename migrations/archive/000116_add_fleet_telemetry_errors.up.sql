-- Fleet telemetry error logs from partner-level API
CREATE TABLE IF NOT EXISTS tesla_fleet_telemetry_errors (
    id              BIGSERIAL PRIMARY KEY,
    vin             TEXT NOT NULL,
    error_code      TEXT,
    error_message   TEXT,
    reported_at     TIMESTAMPTZ,
    raw_json        JSONB NOT NULL DEFAULT '{}',
    tesla_updated_at TIMESTAMPTZ,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (vin, error_code, reported_at)
);

CREATE INDEX IF NOT EXISTS idx_fleet_telemetry_errors_vin ON tesla_fleet_telemetry_errors (vin, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_telemetry_errors_fetched ON tesla_fleet_telemetry_errors (fetched_at DESC);

-- Track which VINs currently have telemetry errors (latest snapshot)
CREATE TABLE IF NOT EXISTS tesla_fleet_telemetry_error_vins (
    id              BIGSERIAL PRIMARY KEY,
    vin             TEXT NOT NULL UNIQUE,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fleet_telemetry_error_vins_active ON tesla_fleet_telemetry_error_vins (active) WHERE active = TRUE;
