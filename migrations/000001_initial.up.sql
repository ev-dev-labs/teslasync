-- Enable TimescaleDB extension for time-series optimization
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Vehicles table
CREATE TABLE IF NOT EXISTS vehicles (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL UNIQUE,
    vin             VARCHAR(17) NOT NULL UNIQUE,
    display_name    VARCHAR(255) NOT NULL DEFAULT '',
    model           VARCHAR(50) NOT NULL DEFAULT '',
    trim_badging    VARCHAR(50) NOT NULL DEFAULT '',
    exterior_color  VARCHAR(50) NOT NULL DEFAULT '',
    wheel_type      VARCHAR(50) NOT NULL DEFAULT '',
    state           VARCHAR(20) NOT NULL DEFAULT 'offline',
    healthy         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Positions hypertable (time-series optimized)
CREATE TABLE IF NOT EXISTS positions (
    id              BIGSERIAL,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    speed           DOUBLE PRECISION,
    power           DOUBLE PRECISION,
    heading         INTEGER,
    elevation       DOUBLE PRECISION,
    odometer        DOUBLE PRECISION NOT NULL DEFAULT 0,
    ideal_range     DOUBLE PRECISION,
    rated_range     DOUBLE PRECISION,
    battery_level   INTEGER NOT NULL DEFAULT 0,
    inside_temp     DOUBLE PRECISION,
    outside_temp    DOUBLE PRECISION,
    fan_status      INTEGER,
    is_climate_on   BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (id, created_at)
);

-- Convert positions to TimescaleDB hypertable for time-series performance
SELECT create_hypertable('positions', 'created_at', migrate_data => true, if_not_exists => true);

-- Drives table
CREATE TABLE IF NOT EXISTS drives (
    id                  BIGSERIAL PRIMARY KEY,
    vehicle_id          BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    start_date          TIMESTAMPTZ NOT NULL,
    end_date            TIMESTAMPTZ,
    start_position_id   BIGINT,
    end_position_id     BIGINT,
    start_address_id    BIGINT,
    end_address_id      BIGINT,
    distance            DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_min        DOUBLE PRECISION NOT NULL DEFAULT 0,
    start_range_km      DOUBLE PRECISION,
    end_range_km        DOUBLE PRECISION,
    speed_max           DOUBLE PRECISION,
    power_max           DOUBLE PRECISION,
    power_min           DOUBLE PRECISION,
    start_battery_level INTEGER,
    end_battery_level   INTEGER,
    inside_temp_avg     DOUBLE PRECISION,
    outside_temp_avg    DOUBLE PRECISION
);

-- Charging sessions table
CREATE TABLE IF NOT EXISTS charging_sessions (
    id                      BIGSERIAL PRIMARY KEY,
    vehicle_id              BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    start_date              TIMESTAMPTZ NOT NULL,
    end_date                TIMESTAMPTZ,
    address_id              BIGINT,
    charge_energy_added     DOUBLE PRECISION NOT NULL DEFAULT 0,
    charge_energy_used      DOUBLE PRECISION,
    start_battery_level     INTEGER NOT NULL DEFAULT 0,
    end_battery_level       INTEGER,
    start_range_km          DOUBLE PRECISION,
    end_range_km            DOUBLE PRECISION,
    charger_phases          INTEGER,
    charger_voltage         INTEGER,
    charger_actual_current  INTEGER,
    charger_power           DOUBLE PRECISION,
    fast_charger_type       VARCHAR(100),
    fast_charger_brand      VARCHAR(100),
    conn_charge_cable       VARCHAR(100),
    cost                    DOUBLE PRECISION,
    duration_min            DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- Addresses table
CREATE TABLE IF NOT EXISTS addresses (
    id              BIGSERIAL PRIMARY KEY,
    display_name    TEXT NOT NULL,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    name            VARCHAR(255),
    house_number    VARCHAR(50),
    road            VARCHAR(255),
    city            VARCHAR(255),
    county          VARCHAR(255),
    state           VARCHAR(255),
    country         VARCHAR(255),
    postcode        VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Geofences table
CREATE TABLE IF NOT EXISTS geofences (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    radius      DOUBLE PRECISION NOT NULL DEFAULT 50,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Software updates table
CREATE TABLE IF NOT EXISTS software_updates (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    version         VARCHAR(100) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'available',
    scheduled_at    TIMESTAMPTZ,
    installed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tokens table (single row)
CREATE TABLE IF NOT EXISTS tokens (
    id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    access_token    TEXT NOT NULL,
    refresh_token   TEXT NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Settings table (single row)
CREATE TABLE IF NOT EXISTS settings (
    id                  INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    unit_of_length      VARCHAR(5) NOT NULL DEFAULT 'km',
    unit_of_temp        VARCHAR(5) NOT NULL DEFAULT 'C',
    preferred_range     VARCHAR(10) NOT NULL DEFAULT 'rated',
    language            VARCHAR(10) NOT NULL DEFAULT 'en',
    base_cost_per_kwh   DOUBLE PRECISION NOT NULL DEFAULT 0
);

-- Insert default settings
INSERT INTO settings (id, unit_of_length, unit_of_temp, preferred_range, language, base_cost_per_kwh)
VALUES (1, 'km', 'C', 'rated', 'en', 0)
ON CONFLICT (id) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_positions_vehicle_time ON positions (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drives_vehicle_start ON drives (vehicle_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_charging_vehicle_start ON charging_sessions (vehicle_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_addresses_coords ON addresses (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_software_updates_vehicle ON software_updates (vehicle_id, created_at DESC);
