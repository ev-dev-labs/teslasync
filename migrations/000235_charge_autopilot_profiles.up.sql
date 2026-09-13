CREATE TABLE charge_autopilot_profiles (
    vehicle_id            BIGINT PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    enabled               BOOLEAN NOT NULL DEFAULT FALSE,
    target_soc            INT NOT NULL DEFAULT 80,
    ready_by              TEXT NOT NULL DEFAULT '07:30',
    rate_plan             TEXT NOT NULL DEFAULT 'pge-ev2a',
    daily_cap_soc         INT NOT NULL DEFAULT 80,
    trip_override         BOOLEAN NOT NULL DEFAULT FALSE,
    precondition          BOOLEAN NOT NULL DEFAULT TRUE,
    max_amps              INT NOT NULL DEFAULT 32,
    battery_capacity_kwh  NUMERIC(6,2) NOT NULL DEFAULT 75,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
