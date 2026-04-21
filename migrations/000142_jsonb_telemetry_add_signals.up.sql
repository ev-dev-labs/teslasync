-- Phase 1: Add signals JSONB column + GIN indexes to high-churn telemetry tables.
-- The signals column becomes the long-term home for flexibly-schemaed Tesla signals,
-- eliminating the "ADD COLUMN every time Tesla ships a new signal" migration churn
-- that produced migrations 000022, 000026, 000030, 000035, 000121-000137.
--
-- This migration is non-breaking: existing code reading typed columns continues
-- to work. Backfill happens in 000143. Old columns are dropped in 000144.

ALTER TABLE charging_telemetry
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_charging_telemetry_signals
    ON charging_telemetry USING GIN (signals);

ALTER TABLE climate_snapshots
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_climate_snapshots_signals
    ON climate_snapshots USING GIN (signals);

ALTER TABLE security_events
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_security_events_signals
    ON security_events USING GIN (signals);

ALTER TABLE motor_snapshots
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_motor_snapshots_signals
    ON motor_snapshots USING GIN (signals);

ALTER TABLE tire_pressure_snapshots
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_tire_pressure_snapshots_signals
    ON tire_pressure_snapshots USING GIN (signals);

ALTER TABLE media_snapshots
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_media_snapshots_signals
    ON media_snapshots USING GIN (signals);

ALTER TABLE safety_snapshots
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_safety_snapshots_signals
    ON safety_snapshots USING GIN (signals);

ALTER TABLE vehicle_config_snapshots
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_vehicle_config_snapshots_signals
    ON vehicle_config_snapshots USING GIN (signals);

ALTER TABLE user_preference_snapshots
    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_user_preference_snapshots_signals
    ON user_preference_snapshots USING GIN (signals);
