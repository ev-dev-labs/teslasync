-- Clean up historical zero-value records from positions and tire_pressure_snapshots.
-- These rows were stored when car was asleep / sensors unavailable.

-- Delete positions with (0,0) coordinates
DELETE FROM positions WHERE latitude = 0 AND longitude = 0;

-- Delete tire pressure snapshots where all four values are zero
DELETE FROM tire_pressure_snapshots
WHERE front_left = 0 AND front_right = 0 AND rear_left = 0 AND rear_right = 0;
