CREATE TABLE IF NOT EXISTS tesla_charging_history (
    id                      BIGSERIAL PRIMARY KEY,
    session_id              BIGINT NOT NULL UNIQUE,
    vin                     TEXT NOT NULL,
    site_location_name      TEXT NOT NULL DEFAULT '',
    charge_start_datetime   TIMESTAMPTZ NOT NULL,
    charge_stop_datetime    TIMESTAMPTZ,
    country                 TEXT,
    state                   TEXT,
    county                  TEXT,
    postal_code             TEXT,
    billing_type            TEXT,
    fee_type                TEXT,
    currency_code           TEXT,
    pricing_type            TEXT,
    rate_base               DOUBLE PRECISION,
    usage_kwh               DOUBLE PRECISION,
    total_due               DOUBLE PRECISION,
    has_invoice             BOOLEAN NOT NULL DEFAULT false,
    invoice_content_id      TEXT,
    raw_json                JSONB NOT NULL DEFAULT '{}',
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_charging_history_vin ON tesla_charging_history (vin, charge_start_datetime DESC);
