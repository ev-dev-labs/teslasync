-- Rollback migration 22: Remove missing signal columns

ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS tpms_hard_warnings;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS tpms_soft_warnings;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_time_fl;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_time_fr;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_time_rl;
ALTER TABLE tire_pressure_snapshots DROP COLUMN IF EXISTS last_seen_time_rr;

ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS lifetime_energy_gained_regen;
ALTER TABLE motor_snapshots DROP COLUMN IF EXISTS lifetime_energy_used_drive;

ALTER TABLE location_snapshots DROP COLUMN IF EXISTS route_last_updated;
ALTER TABLE location_snapshots DROP COLUMN IF EXISTS current_lat;
ALTER TABLE location_snapshots DROP COLUMN IF EXISTS current_lon;

ALTER TABLE media_snapshots DROP COLUMN IF EXISTS audio_volume_increment;

ALTER TABLE vehicle_config_snapshots DROP COLUMN IF EXISTS software_update_scheduled_start;

ALTER TABLE charging_telemetry DROP COLUMN IF EXISTS scheduled_charging_start_time;
ALTER TABLE charging_telemetry DROP COLUMN IF EXISTS scheduled_departure_time;
ALTER TABLE charging_telemetry DROP COLUMN IF EXISTS expected_energy_pct_at_arrival;
