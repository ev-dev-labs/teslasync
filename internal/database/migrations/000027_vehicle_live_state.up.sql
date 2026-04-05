-- Migration 27: vehicle_live_state — single row per vehicle with always-complete signal state
-- Updated via UPSERT on every telemetry batch (only non-null fields touched).
-- Eliminates the "random subset" problem where each positions row has 30-50% nulls.

CREATE TABLE IF NOT EXISTS vehicle_live_state (
    vehicle_id       BIGINT PRIMARY KEY REFERENCES vehicles(id),

    -- Location
    latitude         DOUBLE PRECISION,
    longitude        DOUBLE PRECISION,
    heading          INTEGER,
    gps_state        BOOLEAN,

    -- Driving
    speed            DOUBLE PRECISION,    -- km/h (normalized from mph)
    power            DOUBLE PRECISION,    -- kW (computed from PackVoltage * PackCurrent)
    odometer         DOUBLE PRECISION,    -- km (normalized from miles)
    gear             VARCHAR(50),
    pedal_position   DOUBLE PRECISION,
    brake_pedal      BOOLEAN,

    -- Battery / Range
    battery_level    INTEGER,
    soc              DOUBLE PRECISION,
    ideal_range      DOUBLE PRECISION,    -- km
    rated_range      DOUBLE PRECISION,    -- km
    est_range        DOUBLE PRECISION,    -- km
    energy_remaining DOUBLE PRECISION,    -- kWh

    -- Climate
    inside_temp      DOUBLE PRECISION,    -- Celsius
    outside_temp     DOUBLE PRECISION,    -- Celsius
    hvac_power       BOOLEAN,
    fan_speed        INTEGER,
    is_climate_on    BOOLEAN,

    -- Charging
    charge_state         VARCHAR(50),
    detailed_charge_state VARCHAR(50),
    charger_voltage      DOUBLE PRECISION,
    charge_amps          DOUBLE PRECISION,
    charge_rate          DOUBLE PRECISION,   -- km/h
    charger_power        DOUBLE PRECISION,   -- kW (AC or DC)
    charge_limit_soc     INTEGER,
    time_to_full_charge  DOUBLE PRECISION,
    charging_cable_type  VARCHAR(50),

    -- Security
    locked           BOOLEAN,
    sentry_mode      BOOLEAN,
    door_state       VARCHAR(100),
    fd_window        VARCHAR(50),
    fp_window        VARCHAR(50),
    rd_window        VARCHAR(50),
    rp_window        VARCHAR(50),
    center_display   VARCHAR(50),

    -- Tire Pressure (bar)
    tire_pressure_fl DOUBLE PRECISION,
    tire_pressure_fr DOUBLE PRECISION,
    tire_pressure_rl DOUBLE PRECISION,
    tire_pressure_rr DOUBLE PRECISION,

    -- Vehicle Info
    vehicle_name     VARCHAR(100),
    car_type         VARCHAR(50),
    version          VARCHAR(50),
    wheel_type       VARCHAR(50),
    exterior_color   VARCHAR(50),

    -- Timestamps
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
