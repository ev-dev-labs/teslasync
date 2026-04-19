CREATE TABLE IF NOT EXISTS tesla_charging_sessions (
    id                      BIGSERIAL PRIMARY KEY,
    session_id              BIGINT NOT NULL UNIQUE,
    vin                     TEXT NOT NULL,
    charger_id              TEXT,
    site_location_name      TEXT NOT NULL DEFAULT '',
    charge_start_datetime   TIMESTAMPTZ NOT NULL,
    charge_stop_datetime    TIMESTAMPTZ,
    energy_added_kwh        DOUBLE PRECISION,
    peak_power_kw           DOUBLE PRECISION,
    max_charge_rate_kw      DOUBLE PRECISION,
    charge_duration_s       INTEGER,
    charger_type            TEXT,
    currency_code           TEXT,
    total_cost              DOUBLE PRECISION,
    per_kwh_rate            DOUBLE PRECISION,
    idle_fee                DOUBLE PRECISION,
    congestion_fee          DOUBLE PRECISION,
    latitude                DOUBLE PRECISION,
    longitude               DOUBLE PRECISION,
    raw_json                JSONB NOT NULL DEFAULT '{}',
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_charging_sessions_vin ON tesla_charging_sessions (vin, charge_start_datetime DESC);
CREATE INDEX IF NOT EXISTS idx_tesla_charging_sessions_session ON tesla_charging_sessions (session_id);
