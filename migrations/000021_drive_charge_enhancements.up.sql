-- Migration 21: Drive & Charging Session Enhancements
-- Adds comprehensive tracking columns to drives and charging_sessions tables,
-- plus new tables for continuous telemetry readings during sessions.

-- ============================================================
-- DRIVES TABLE ENHANCEMENTS
-- ============================================================

-- Odometer tracking for distance computation
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_odometer DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS end_odometer DOUBLE PRECISION;

-- Speed statistics
ALTER TABLE drives ADD COLUMN IF NOT EXISTS speed_avg DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS speed_min DOUBLE PRECISION;

-- Range statistics (rated)
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_rated_range_km DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS end_rated_range_km DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS rated_range_avg DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS rated_range_max DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS rated_range_min DOUBLE PRECISION;

-- Range statistics (ideal)
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_ideal_range_km DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS end_ideal_range_km DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS ideal_range_avg DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS ideal_range_max DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS ideal_range_min DOUBLE PRECISION;

-- Range statistics (estimated)
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_est_range_km DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS end_est_range_km DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS est_range_avg DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS est_range_max DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS est_range_min DOUBLE PRECISION;

-- SOC statistics
ALTER TABLE drives ADD COLUMN IF NOT EXISTS soc_start DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS soc_end DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS soc_avg DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS soc_max DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS soc_min DOUBLE PRECISION;

-- Usable SOC
ALTER TABLE drives ADD COLUMN IF NOT EXISTS usable_soc_start DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS usable_soc_end DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS usable_soc_avg DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS usable_soc_max DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS usable_soc_min DOUBLE PRECISION;

-- Elevation
ALTER TABLE drives ADD COLUMN IF NOT EXISTS elevation_start DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS elevation_end DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS elevation_gain DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS elevation_loss DOUBLE PRECISION;

-- Temperature stats
ALTER TABLE drives ADD COLUMN IF NOT EXISTS driver_temp_avg DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS passenger_temp_avg DOUBLE PRECISION;

-- Battery heater
ALTER TABLE drives ADD COLUMN IF NOT EXISTS battery_heater_on BOOLEAN DEFAULT FALSE;

-- Address names (denormalized for quick display)
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_address TEXT;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS end_address TEXT;

-- Latitude/longitude for start/end (denormalized)
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_latitude DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS start_longitude DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS end_latitude DOUBLE PRECISION;
ALTER TABLE drives ADD COLUMN IF NOT EXISTS end_longitude DOUBLE PRECISION;

-- ============================================================
-- CHARGING SESSIONS TABLE ENHANCEMENTS
-- ============================================================

-- Location tracking
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS location_name TEXT;

-- Temperature during charging
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS inside_temp_avg DOUBLE PRECISION;
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS outside_temp_avg DOUBLE PRECISION;

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
