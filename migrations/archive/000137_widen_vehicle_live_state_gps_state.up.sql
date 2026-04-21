-- GpsState is a string enum (NoFix, Fix2D, Fix3D), not a boolean.
-- The column was incorrectly created as BOOLEAN in migration 000027.
ALTER TABLE vehicle_live_state ALTER COLUMN gps_state TYPE TEXT USING gps_state::text;
