-- jsonb Telemetry Consolidation — Phase 1 (non-breaking foundation)
--
-- Adds a flexible `signals` JSONB column plus a GIN index to each telemetry/
-- snapshot table. All existing per-signal columns remain in place; the new
-- column simply makes future signal additions migration-free.
--
-- Phase 2 (backfill) and Phase 3 (drop legacy columns) will follow in later
-- migrations once every code path reads from `signals`.

ALTER TABLE charging_telemetry         ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE climate_snapshots          ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE security_events            ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE motor_snapshots            ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tire_pressure_snapshots    ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE media_snapshots            ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE safety_snapshots           ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vehicle_config_snapshots   ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE user_preference_snapshots  ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_charging_telemetry_signals        ON charging_telemetry        USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_climate_snapshots_signals         ON climate_snapshots         USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_security_events_signals           ON security_events           USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_motor_snapshots_signals           ON motor_snapshots           USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_tire_pressure_snapshots_signals   ON tire_pressure_snapshots   USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_media_snapshots_signals           ON media_snapshots           USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_safety_snapshots_signals          ON safety_snapshots          USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_vehicle_config_snapshots_signals  ON vehicle_config_snapshots  USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_user_preference_snapshots_signals ON user_preference_snapshots USING GIN (signals);
