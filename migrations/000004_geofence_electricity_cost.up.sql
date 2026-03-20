-- Add cost_per_kwh to geofences (current rate)
ALTER TABLE geofences ADD COLUMN IF NOT EXISTS cost_per_kwh DOUBLE PRECISION DEFAULT NULL;

-- Geofence electricity rate history table for temporal versioning
-- When cost_per_kwh changes, the old rate is stored here so past charges keep original rate
CREATE TABLE IF NOT EXISTS geofence_electricity_rates (
    id              BIGSERIAL PRIMARY KEY,
    geofence_id     BIGINT NOT NULL REFERENCES geofences(id) ON DELETE CASCADE,
    cost_per_kwh    DOUBLE PRECISION NOT NULL,
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    effective_to    TIMESTAMPTZ DEFAULT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geofence_rates_geofence_id ON geofence_electricity_rates(geofence_id);
CREATE INDEX IF NOT EXISTS idx_geofence_rates_effective ON geofence_electricity_rates(geofence_id, effective_from, effective_to);
