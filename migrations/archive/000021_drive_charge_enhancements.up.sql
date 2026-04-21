-- Migration 21: Drive & Charging Session Enhancements
-- Adds comprehensive tracking columns to drives and charging_sessions tables,
-- plus new tables for continuous telemetry readings during sessions.
-- Wrapped in DO block for transactional safety with golang-migrate.

-- ============================================================
-- DRIVES TABLE ENHANCEMENTS
-- ============================================================

DO $$
BEGIN
  -- Odometer tracking for distance computation
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='start_odometer') THEN
    ALTER TABLE drives ADD COLUMN start_odometer DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='end_odometer') THEN
    ALTER TABLE drives ADD COLUMN end_odometer DOUBLE PRECISION;
  END IF;
  -- Speed statistics
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='speed_avg') THEN
    ALTER TABLE drives ADD COLUMN speed_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='speed_min') THEN
    ALTER TABLE drives ADD COLUMN speed_min DOUBLE PRECISION;
  END IF;
  -- Range statistics (rated)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='start_rated_range_km') THEN
    ALTER TABLE drives ADD COLUMN start_rated_range_km DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='end_rated_range_km') THEN
    ALTER TABLE drives ADD COLUMN end_rated_range_km DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='rated_range_avg') THEN
    ALTER TABLE drives ADD COLUMN rated_range_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='rated_range_max') THEN
    ALTER TABLE drives ADD COLUMN rated_range_max DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='rated_range_min') THEN
    ALTER TABLE drives ADD COLUMN rated_range_min DOUBLE PRECISION;
  END IF;
  -- Range statistics (ideal)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='start_ideal_range_km') THEN
    ALTER TABLE drives ADD COLUMN start_ideal_range_km DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='end_ideal_range_km') THEN
    ALTER TABLE drives ADD COLUMN end_ideal_range_km DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='ideal_range_avg') THEN
    ALTER TABLE drives ADD COLUMN ideal_range_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='ideal_range_max') THEN
    ALTER TABLE drives ADD COLUMN ideal_range_max DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='ideal_range_min') THEN
    ALTER TABLE drives ADD COLUMN ideal_range_min DOUBLE PRECISION;
  END IF;
  -- Range statistics (estimated)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='start_est_range_km') THEN
    ALTER TABLE drives ADD COLUMN start_est_range_km DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='end_est_range_km') THEN
    ALTER TABLE drives ADD COLUMN end_est_range_km DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='est_range_avg') THEN
    ALTER TABLE drives ADD COLUMN est_range_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='est_range_max') THEN
    ALTER TABLE drives ADD COLUMN est_range_max DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='est_range_min') THEN
    ALTER TABLE drives ADD COLUMN est_range_min DOUBLE PRECISION;
  END IF;
  -- SOC statistics
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='soc_start') THEN
    ALTER TABLE drives ADD COLUMN soc_start DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='soc_end') THEN
    ALTER TABLE drives ADD COLUMN soc_end DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='soc_avg') THEN
    ALTER TABLE drives ADD COLUMN soc_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='soc_max') THEN
    ALTER TABLE drives ADD COLUMN soc_max DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='soc_min') THEN
    ALTER TABLE drives ADD COLUMN soc_min DOUBLE PRECISION;
  END IF;
  -- Usable SOC
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='usable_soc_start') THEN
    ALTER TABLE drives ADD COLUMN usable_soc_start DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='usable_soc_end') THEN
    ALTER TABLE drives ADD COLUMN usable_soc_end DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='usable_soc_avg') THEN
    ALTER TABLE drives ADD COLUMN usable_soc_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='usable_soc_max') THEN
    ALTER TABLE drives ADD COLUMN usable_soc_max DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='usable_soc_min') THEN
    ALTER TABLE drives ADD COLUMN usable_soc_min DOUBLE PRECISION;
  END IF;
  -- Elevation
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='elevation_start') THEN
    ALTER TABLE drives ADD COLUMN elevation_start DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='elevation_end') THEN
    ALTER TABLE drives ADD COLUMN elevation_end DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='elevation_gain') THEN
    ALTER TABLE drives ADD COLUMN elevation_gain DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='elevation_loss') THEN
    ALTER TABLE drives ADD COLUMN elevation_loss DOUBLE PRECISION;
  END IF;
  -- Temperature stats
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='driver_temp_avg') THEN
    ALTER TABLE drives ADD COLUMN driver_temp_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='passenger_temp_avg') THEN
    ALTER TABLE drives ADD COLUMN passenger_temp_avg DOUBLE PRECISION;
  END IF;
  -- Battery heater
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='battery_heater_on') THEN
    ALTER TABLE drives ADD COLUMN battery_heater_on BOOLEAN DEFAULT FALSE;
  END IF;
  -- Address names (denormalized for quick display)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='start_address') THEN
    ALTER TABLE drives ADD COLUMN start_address TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='end_address') THEN
    ALTER TABLE drives ADD COLUMN end_address TEXT;
  END IF;
  -- Latitude/longitude for start/end (denormalized)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='start_latitude') THEN
    ALTER TABLE drives ADD COLUMN start_latitude DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='start_longitude') THEN
    ALTER TABLE drives ADD COLUMN start_longitude DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='end_latitude') THEN
    ALTER TABLE drives ADD COLUMN end_latitude DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='drives' AND column_name='end_longitude') THEN
    ALTER TABLE drives ADD COLUMN end_longitude DOUBLE PRECISION;
  END IF;
END
$$;

-- ============================================================
-- CHARGING SESSIONS TABLE ENHANCEMENTS
-- ============================================================

DO $$
BEGIN
  -- Location tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_sessions' AND column_name='latitude') THEN
    ALTER TABLE charging_sessions ADD COLUMN latitude DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_sessions' AND column_name='longitude') THEN
    ALTER TABLE charging_sessions ADD COLUMN longitude DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_sessions' AND column_name='location_name') THEN
    ALTER TABLE charging_sessions ADD COLUMN location_name TEXT;
  END IF;
  -- Temperature during charging
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_sessions' AND column_name='inside_temp_avg') THEN
    ALTER TABLE charging_sessions ADD COLUMN inside_temp_avg DOUBLE PRECISION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='charging_sessions' AND column_name='outside_temp_avg') THEN
    ALTER TABLE charging_sessions ADD COLUMN outside_temp_avg DOUBLE PRECISION;
  END IF;
END
$$;

-- ============================================================
-- DRIVE TELEMETRY READINGS TABLE (continuous tracking during drives)
-- ============================================================
CREATE TABLE IF NOT EXISTS drive_telemetry_readings (
    id BIGSERIAL PRIMARY KEY,
    drive_id BIGINT NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

    -- Position
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    elevation DOUBLE PRECISION,
    heading INTEGER,
    odometer DOUBLE PRECISION,

    -- Speed & Power
    speed DOUBLE PRECISION,
    power DOUBLE PRECISION,

    -- Battery
    battery_level INTEGER,
    soc DOUBLE PRECISION,
    usable_soc DOUBLE PRECISION,

    -- Range
    rated_range DOUBLE PRECISION,
    ideal_range DOUBLE PRECISION,
    est_range DOUBLE PRECISION,

    -- Temperature
    inside_temp DOUBLE PRECISION,
    outside_temp DOUBLE PRECISION,
    driver_temp DOUBLE PRECISION,
    passenger_temp DOUBLE PRECISION,

    -- Climate
    fan_status INTEGER,
    is_climate_on BOOLEAN,

    -- Tire Pressure
    tire_pressure_fl DOUBLE PRECISION,
    tire_pressure_fr DOUBLE PRECISION,
    tire_pressure_rl DOUBLE PRECISION,
    tire_pressure_rr DOUBLE PRECISION,

    -- Battery heater
    battery_heater_on BOOLEAN,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drive_telemetry_drive_id ON drive_telemetry_readings(drive_id);
CREATE INDEX IF NOT EXISTS idx_drive_telemetry_vehicle_time ON drive_telemetry_readings(vehicle_id, created_at DESC);

-- ============================================================
-- CHARGE TELEMETRY READINGS TABLE (continuous tracking during charging)
-- ============================================================
CREATE TABLE IF NOT EXISTS charge_telemetry_readings (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES charging_sessions(id) ON DELETE CASCADE,
    vehicle_id BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

    -- Battery
    battery_level INTEGER,
    soc DOUBLE PRECISION,

    -- Power
    power_kw DOUBLE PRECISION,
    voltage DOUBLE PRECISION,
    current_amps DOUBLE PRECISION,
    phases INTEGER,

    -- Energy
    energy_added DOUBLE PRECISION,

    -- Range
    rated_range DOUBLE PRECISION,
    ideal_range DOUBLE PRECISION,
    est_range DOUBLE PRECISION,

    -- Temperature
    inside_temp DOUBLE PRECISION,
    outside_temp DOUBLE PRECISION,
    battery_temp DOUBLE PRECISION,

    -- Location
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,

    -- Charge rate
    charge_rate DOUBLE PRECISION,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_charge_telemetry_session_id ON charge_telemetry_readings(session_id);
CREATE INDEX IF NOT EXISTS idx_charge_telemetry_vehicle_time ON charge_telemetry_readings(vehicle_id, created_at DESC);

-- ============================================================
-- FLEET TELEMETRY SUBSCRIPTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS fleet_telemetry_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    vin VARCHAR(17),
    signals TEXT[] NOT NULL,
    interval_seconds INTEGER NOT NULL DEFAULT 30,
    hostname TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 4443,
    protocol TEXT NOT NULL DEFAULT 'wss',
    ca_pem TEXT,
    subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active',
    response_code INTEGER,
    response_body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fleet_sub_vin ON fleet_telemetry_subscriptions(vin);
CREATE INDEX IF NOT EXISTS idx_fleet_sub_vehicle ON fleet_telemetry_subscriptions(vehicle_id);

-- ============================================================
-- GEOFENCE SPATIAL INDEX
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_geofences_coords ON geofences(latitude, longitude);
