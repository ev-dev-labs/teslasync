CREATE TABLE IF NOT EXISTS tesla_energy_sites (
    id                  BIGSERIAL PRIMARY KEY,
    energy_site_id      BIGINT NOT NULL UNIQUE,
    resource_type       TEXT NOT NULL DEFAULT '',
    site_name           TEXT NOT NULL DEFAULT '',
    gateway_id          TEXT,
    total_pack_energy   DOUBLE PRECISION,
    percentage_charged  DOUBLE PRECISION,
    battery_type        TEXT,
    backup_capable      BOOLEAN NOT NULL DEFAULT false,
    storm_mode_enabled  BOOLEAN NOT NULL DEFAULT false,
    has_solar           BOOLEAN NOT NULL DEFAULT false,
    has_battery         BOOLEAN NOT NULL DEFAULT false,
    has_grid            BOOLEAN NOT NULL DEFAULT false,
    has_load_meter      BOOLEAN NOT NULL DEFAULT false,
    tou_capable         BOOLEAN NOT NULL DEFAULT false,
    storm_mode_capable  BOOLEAN NOT NULL DEFAULT false,
    raw_json            JSONB NOT NULL DEFAULT '{}',
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tesla_energy_sites_site_id ON tesla_energy_sites (energy_site_id);
