-- tests/fixtures/seed_test_vehicle.sql
-- Seeds a test vehicle for local Docker development and signal replay testing.
--
-- Usage:
--   docker exec teslasync-postgres psql -U teslasync -d teslasync -f /seed.sql
--   OR: cat tests/fixtures/seed_test_vehicle.sql | docker exec -i teslasync-postgres psql -U teslasync -d teslasync
--
-- This script is idempotent (ON CONFLICT DO NOTHING) — safe to run multiple times.

BEGIN;

-- 1. Test vehicle
INSERT INTO vehicles (tesla_id, vin, display_name, model, color, trim_level)
VALUES (1234567890, 'TEST00000000000VIN', 'Test Model Y', 'Model Y', 'Pearl White', 'Long Range')
ON CONFLICT (vin) DO NOTHING;

-- 2. Vehicle unit preferences (what unit the "car" sends data in)
--    Miles / Fahrenheit / PSI — matches Tesla US defaults
INSERT INTO vehicle_units (vehicle_id, car_distance_pref, car_temp_pref, car_pressure_pref, car_charge_pref)
SELECT id, 'DistanceUnitMiles', 'TemperatureUnitFahrenheit', 'PressureUnitPsi', 'ChargeUnitPercent'
FROM vehicles WHERE vin = 'TEST00000000000VIN'
ON CONFLICT (vehicle_id) DO NOTHING;

-- 3. Vehicle live state (single-row current-state cache)
INSERT INTO vehicle_live_state (vehicle_id)
SELECT id FROM vehicles WHERE vin = 'TEST00000000000VIN'
ON CONFLICT (vehicle_id) DO NOTHING;

-- 4. Default settings (app display preferences)
INSERT INTO settings (key, value_text, data_kind)
VALUES
  ('unit_of_length', 'mi', 'text'),
  ('unit_of_temp', 'F', 'text'),
  ('unit_of_pressure', 'psi', 'text'),
  ('preferred_range', 'rated', 'text'),
  ('language', 'en', 'text'),
  ('theme', 'neon-cyan', 'text'),
  ('decimal_precision', '1', 'text')
ON CONFLICT (key) DO NOTHING;

-- 5. Polling config for the test vehicle
INSERT INTO polling_configs (vehicle_id, awake_interval_sec, asleep_interval_sec, driving_interval_sec, enabled)
SELECT id, 30, 300, 5, true
FROM vehicles WHERE vin = 'TEST00000000000VIN'
ON CONFLICT (vehicle_id) DO NOTHING;

COMMIT;

-- Verify
SELECT 'vehicles' AS entity, count(*) FROM vehicles
UNION ALL SELECT 'vehicle_units', count(*) FROM vehicle_units
UNION ALL SELECT 'vehicle_live_state', count(*) FROM vehicle_live_state
UNION ALL SELECT 'settings', count(*) FROM settings
UNION ALL SELECT 'polling_configs', count(*) FROM polling_configs;
