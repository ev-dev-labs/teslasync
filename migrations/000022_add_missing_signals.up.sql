-- Migration 22: Add missing fleet telemetry signal columns
-- Adds storage for 16 signals that were subscribed but not processed.

-- 1. Tire Pressure: TPMS warnings and last-seen timestamps
ALTER TABLE tire_pressure_snapshots ADD COLUMN IF NOT EXISTS tpms_hard_warnings TEXT;
ALTER TABLE tire_pressure_snapshots ADD COLUMN IF NOT EXISTS tpms_soft_warnings TEXT;
ALTER TABLE tire_pressure_snapshots ADD COLUMN IF NOT EXISTS last_seen_time_fl TIMESTAMPTZ;
ALTER TABLE tire_pressure_snapshots ADD COLUMN IF NOT EXISTS last_seen_time_fr TIMESTAMPTZ;
ALTER TABLE tire_pressure_snapshots ADD COLUMN IF NOT EXISTS last_seen_time_rl TIMESTAMPTZ;
ALTER TABLE tire_pressure_snapshots ADD COLUMN IF NOT EXISTS last_seen_time_rr TIMESTAMPTZ;

-- 2. Motor: Lifetime energy tracking (regen and drive-specific)
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS lifetime_energy_gained_regen DOUBLE PRECISION;
ALTER TABLE motor_snapshots ADD COLUMN IF NOT EXISTS lifetime_energy_used_drive DOUBLE PRECISION;

-- 3. Location: Route update timestamp and raw location
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS route_last_updated TIMESTAMPTZ;
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS current_lat DOUBLE PRECISION;
ALTER TABLE location_snapshots ADD COLUMN IF NOT EXISTS current_lon DOUBLE PRECISION;

-- 4. Media: Volume increment
ALTER TABLE media_snapshots ADD COLUMN IF NOT EXISTS audio_volume_increment DOUBLE PRECISION;

-- 5. Vehicle Config: Software update scheduled start
ALTER TABLE vehicle_config_snapshots ADD COLUMN IF NOT EXISTS software_update_scheduled_start TEXT;

-- 6. Charging Telemetry: Schedule and trip energy fields
ALTER TABLE charging_telemetry ADD COLUMN IF NOT EXISTS scheduled_charging_start_time TEXT;
ALTER TABLE charging_telemetry ADD COLUMN IF NOT EXISTS scheduled_departure_time TEXT;
ALTER TABLE charging_telemetry ADD COLUMN IF NOT EXISTS expected_energy_pct_at_arrival DOUBLE PRECISION;
