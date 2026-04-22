DROP FUNCTION IF EXISTS fn_driving_acceleration_distribution(BIGINT, TIMESTAMPTZ, TIMESTAMPTZ);

ALTER TABLE drive_telemetry_readings DROP COLUMN IF EXISTS acceleration_gs;
