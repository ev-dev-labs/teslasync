-- Migration 22: Add missing fleet telemetry signal columns
-- Adds storage for 16 signals that were subscribed but not processed.
-- Wrapped in DO block for transactional safety with golang-migrate.

DO $$
BEGIN
  -- 1. Tire Pressure: TPMS warnings and last-seen timestamps
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tire_pressure_snapshots' AND column_name='tpms_hard_warnings') THEN
    ALTER TABLE tire_pressure_snapshots ADD COLUMN tpms_hard_warnings TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tire_pressure_snapshots' AND column_name='tpms_soft_warnings') THEN
    ALTER TABLE tire_pressure_snapshots ADD COLUMN tpms_soft_warnings TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tire_pressure_snapshots' AND column_name='last_seen_time_fl') THEN
    ALTER TABLE tire_pressure_snapshots ADD COLUMN last_seen_time_fl TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tire_pressure_snapshots' AND column_name='last_seen_time_fr') THEN
    ALTER TABLE tire_pressure_snapshots ADD COLUMN last_seen_time_fr TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tire_pressure_snapshots' AND column_name='last_seen_time_rl') THEN
    ALTER TABLE tire_pressure_snapshots ADD COLUMN last_seen_time_rl TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tire_pressure_snapshots' AND column_name='last_seen_time_rr') THEN
    ALTER TABLE tire_pressure_snapshots ADD COLUMN last_seen_time_rr TIMESTAMPTZ;
  END IF;

  -- 2. Motor: Lifetime energy tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='motor_snapshots' AND column_name='lifetime_energy_gained_regen') THEN
    ALTER TABLE motor_snapshots ADD COLUMN lifetime_energy_gained_regen DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='motor_snapshots' AND column_name='lifetime_energy_used_drive') THEN
    ALTER TABLE motor_snapshots ADD COLUMN lifetime_energy_used_drive DOUBLE PRECISION;
  END IF;

  -- 3. Location: Route update timestamp and raw location
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='location_snapshots' AND column_name='route_last_updated') THEN
    ALTER TABLE location_snapshots ADD COLUMN route_last_updated TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='location_snapshots' AND column_name='current_lat') THEN
    ALTER TABLE location_snapshots ADD COLUMN current_lat DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='location_snapshots' AND column_name='current_lon') THEN
    ALTER TABLE location_snapshots ADD COLUMN current_lon DOUBLE PRECISION;
  END IF;

  -- 4. Media: Volume increment
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='media_snapshots' AND column_name='audio_volume_increment') THEN
    ALTER TABLE media_snapshots ADD COLUMN audio_volume_increment DOUBLE PRECISION;
  END IF;

  -- 5. Vehicle Config: Software update scheduled start
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vehicle_config_snapshots' AND column_name='software_update_scheduled_start') THEN
    ALTER TABLE vehicle_config_snapshots ADD COLUMN software_update_scheduled_start TEXT;
  END IF;

  -- 6. Charging Telemetry: Schedule and trip energy fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_telemetry' AND column_name='scheduled_charging_start_time') THEN
    ALTER TABLE charging_telemetry ADD COLUMN scheduled_charging_start_time TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_telemetry' AND column_name='scheduled_departure_time') THEN
    ALTER TABLE charging_telemetry ADD COLUMN scheduled_departure_time TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_telemetry' AND column_name='expected_energy_pct_at_arrival') THEN
    ALTER TABLE charging_telemetry ADD COLUMN expected_energy_pct_at_arrival DOUBLE PRECISION;
  END IF;
END
$$;
