-- Motor/Powertrain snapshots
CREATE TABLE IF NOT EXISTS motor_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    di_state        VARCHAR(20),
    di_torque       DOUBLE PRECISION,
    di_axle_speed   DOUBLE PRECISION,
    di_stator_temp  DOUBLE PRECISION,
    pedal_position  DOUBLE PRECISION,
    brake_pedal     BOOLEAN,
    lateral_accel   DOUBLE PRECISION,
    longitudinal_accel DOUBLE PRECISION,
    vehicle_speed   DOUBLE PRECISION,
    gear            VARCHAR(5),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_motor_snapshots_vehicle_time ON motor_snapshots (vehicle_id, created_at DESC);

-- Climate/HVAC snapshots
CREATE TABLE IF NOT EXISTS climate_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    inside_temp     DOUBLE PRECISION,
    outside_temp    DOUBLE PRECISION,
    hvac_power      DOUBLE PRECISION,
    hvac_fan_speed  INTEGER,
    hvac_left_temp_request  DOUBLE PRECISION,
    hvac_right_temp_request DOUBLE PRECISION,
    cabin_overheat_mode     VARCHAR(10),
    defrost_mode    BOOLEAN,
    battery_heater_on BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_climate_snapshots_vehicle_time ON climate_snapshots (vehicle_id, created_at DESC);

-- Security events
CREATE TABLE IF NOT EXISTS security_events (
    id              BIGSERIAL PRIMARY KEY,
    vehicle_id      BIGINT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    locked          BOOLEAN,
    sentry_mode     BOOLEAN,
    door_state      VARCHAR(20),
    fd_window       VARCHAR(20),
    fp_window       VARCHAR(20),
    rd_window       VARCHAR(20),
    rp_window       VARCHAR(20),
    homelink_nearby BOOLEAN,
    guest_mode      BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_security_events_vehicle_time ON security_events (vehicle_id, created_at DESC);
