-- Vehicle units table: tracks Tesla API source units and car display preferences.
-- Tesla API always sends distance in miles, speed in mph, temp in °C, pressure in PSI.
-- The car_*_pref columns store what the car's dashboard displays (from Setting*Unit signals).
CREATE TABLE IF NOT EXISTS vehicle_units (
    vehicle_id       BIGINT PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
    distance_unit    VARCHAR(20) NOT NULL DEFAULT 'mi',
    speed_unit       VARCHAR(20) NOT NULL DEFAULT 'mph',
    temp_unit        VARCHAR(20) NOT NULL DEFAULT 'C',
    pressure_unit    VARCHAR(20) NOT NULL DEFAULT 'psi',
    car_distance_pref  VARCHAR(50),
    car_temp_pref      VARCHAR(50),
    car_pressure_pref  VARCHAR(50),
    car_charge_pref    VARCHAR(50),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Populate for existing vehicles
INSERT INTO vehicle_units (vehicle_id)
SELECT id FROM vehicles
ON CONFLICT (vehicle_id) DO NOTHING;
