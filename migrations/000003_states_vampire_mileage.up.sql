-- Migration 3: Add states, vampire drain, mileage, and visited locations tracking
-- Vehicle state tracking, vampire drain analysis, and mileage aggregation

-- Vehicle state changes over time (online, asleep, driving, charging, updating, offline)
CREATE TABLE IF NOT EXISTS vehicle_states (
    id         BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    state      VARCHAR(20) NOT NULL,  -- online, asleep, driving, charging, updating, offline
    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_date   TIMESTAMPTZ,
    duration_min DOUBLE PRECISION DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_states_vehicle ON vehicle_states(vehicle_id, start_date DESC);

-- Vampire drain tracking (energy lost while parked/sleeping)
CREATE TABLE IF NOT EXISTS vampire_drain_events (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    start_date    TIMESTAMPTZ NOT NULL,
    end_date      TIMESTAMPTZ,
    start_battery INT NOT NULL,
    end_battery   INT,
    battery_lost  INT DEFAULT 0,
    range_lost_km DOUBLE PRECISION DEFAULT 0,
    duration_hours DOUBLE PRECISION DEFAULT 0,
    drain_rate_pct_per_hour DOUBLE PRECISION DEFAULT 0,
    outside_temp_avg DOUBLE PRECISION,
    sentry_mode   BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vampire_drain_vehicle ON vampire_drain_events(vehicle_id, start_date DESC);

-- Daily mileage tracking
CREATE TABLE IF NOT EXISTS daily_mileage (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    date          DATE NOT NULL,
    distance_km   DOUBLE PRECISION DEFAULT 0,
    odometer_start DOUBLE PRECISION DEFAULT 0,
    odometer_end  DOUBLE PRECISION DEFAULT 0,
    drive_count   INT DEFAULT 0,
    energy_used_kwh DOUBLE PRECISION DEFAULT 0,
    UNIQUE(vehicle_id, date)
);
CREATE INDEX IF NOT EXISTS idx_daily_mileage_vehicle ON daily_mileage(vehicle_id, date DESC);

-- Visited locations (aggregated from positions/drives)
CREATE TABLE IF NOT EXISTS visited_locations (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    address_id    BIGINT REFERENCES addresses(id),
    visit_count   INT DEFAULT 1,
    total_duration_min DOUBLE PRECISION DEFAULT 0,
    last_visited  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(vehicle_id, address_id)
);

-- Trip tracking (multi-drive journeys)
CREATE TABLE IF NOT EXISTS trips (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    name          VARCHAR(255),
    start_date    TIMESTAMPTZ NOT NULL,
    end_date      TIMESTAMPTZ,
    total_distance_km DOUBLE PRECISION DEFAULT 0,
    total_energy_kwh  DOUBLE PRECISION DEFAULT 0,
    total_cost    DOUBLE PRECISION DEFAULT 0,
    drive_count   INT DEFAULT 0,
    charge_count  INT DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle ON trips(vehicle_id, start_date DESC);

-- Trip <-> Drive mapping
CREATE TABLE IF NOT EXISTS trip_drives (
    trip_id  BIGINT REFERENCES trips(id) ON DELETE CASCADE,
    drive_id BIGINT REFERENCES drives(id) ON DELETE CASCADE,
    PRIMARY KEY(trip_id, drive_id)
);

-- Tire pressure tracking (if available from API)
CREATE TABLE IF NOT EXISTS tire_pressure_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
    front_left    DOUBLE PRECISION,
    front_right   DOUBLE PRECISION,
    rear_left     DOUBLE PRECISION,
    rear_right    DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT create_hypertable('tire_pressure_snapshots', 'created_at', if_not_exists => TRUE, migrate_data => TRUE);
