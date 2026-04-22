CREATE TABLE IF NOT EXISTS tesla_energy_live_status (
    id                  BIGSERIAL PRIMARY KEY,
    energy_site_id      BIGINT NOT NULL,
    solar_power         DOUBLE PRECISION,
    battery_power       DOUBLE PRECISION,
    load_power          DOUBLE PRECISION,
    grid_power          DOUBLE PRECISION,
    grid_services_power DOUBLE PRECISION,
    energy_left         DOUBLE PRECISION,
    total_pack_energy   DOUBLE PRECISION,
    percentage_charged  DOUBLE PRECISION,
    grid_status         TEXT,
    backup_capable      BOOLEAN,
    storm_mode_active   BOOLEAN,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    timestamp           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_live_status_site ON tesla_energy_live_status (energy_site_id, timestamp DESC);
