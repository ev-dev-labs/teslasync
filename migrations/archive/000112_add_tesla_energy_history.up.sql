-- Energy history (daily/weekly/monthly aggregates from Tesla calendar_history API)
CREATE TABLE IF NOT EXISTS tesla_energy_history (
    id                      BIGSERIAL PRIMARY KEY,
    energy_site_id          BIGINT NOT NULL,
    period                  TEXT NOT NULL,
    timestamp               TIMESTAMPTZ NOT NULL,
    solar_energy_wh         DOUBLE PRECISION,
    battery_energy_in_wh    DOUBLE PRECISION,
    battery_energy_out_wh   DOUBLE PRECISION,
    grid_energy_in_wh       DOUBLE PRECISION,
    grid_energy_out_wh      DOUBLE PRECISION,
    consumer_energy_wh      DOUBLE PRECISION,
    raw_json                JSONB NOT NULL DEFAULT '{}',
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_history_site ON tesla_energy_history (energy_site_id, period, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_energy_history_unique ON tesla_energy_history (energy_site_id, period, timestamp);

-- Backup events (off-grid events from Tesla calendar_history kind=backup)
CREATE TABLE IF NOT EXISTS tesla_energy_backup_events (
    id                      BIGSERIAL PRIMARY KEY,
    energy_site_id          BIGINT NOT NULL,
    period                  TEXT NOT NULL DEFAULT 'day',
    timestamp               TIMESTAMPTZ NOT NULL,
    duration_seconds        INTEGER NOT NULL DEFAULT 0,
    raw_json                JSONB NOT NULL DEFAULT '{}',
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_backup_site ON tesla_energy_backup_events (energy_site_id, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_energy_backup_unique ON tesla_energy_backup_events (energy_site_id, period, timestamp);

-- Wall connector charging history (from Tesla telemetry_history kind=charge)
CREATE TABLE IF NOT EXISTS tesla_energy_wc_charging (
    id                      BIGSERIAL PRIMARY KEY,
    energy_site_id          BIGINT NOT NULL,
    din                     TEXT,
    timestamp               TIMESTAMPTZ NOT NULL,
    energy_wh               DOUBLE PRECISION,
    raw_json                JSONB NOT NULL DEFAULT '{}',
    fetched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_energy_wc_charging_site ON tesla_energy_wc_charging (energy_site_id, timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_energy_wc_charging_unique ON tesla_energy_wc_charging (energy_site_id, COALESCE(din, ''), timestamp);
