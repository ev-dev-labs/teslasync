DROP INDEX IF EXISTS idx_user_preference_snapshots_signals;
ALTER TABLE user_preference_snapshots DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_vehicle_config_snapshots_signals;
ALTER TABLE vehicle_config_snapshots DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_safety_snapshots_signals;
ALTER TABLE safety_snapshots DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_media_snapshots_signals;
ALTER TABLE media_snapshots DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_tire_pressure_snapshots_signals;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_motor_snapshots_signals;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_security_events_signals;
ALTER TABLE security_events DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_climate_snapshots_signals;
ALTER TABLE climate_snapshots DROP COLUMN IF EXISTS signals;

DROP INDEX IF EXISTS idx_charging_telemetry_signals;
ALTER TABLE charging_telemetry DROP COLUMN IF EXISTS signals;
