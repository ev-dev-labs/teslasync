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

-- 2. Vehicle unit history (wire-format units the "car" emits data in).
--    Phase-42 / ADR-004 #4: replaces the legacy `vehicle_units` row-per-vehicle
--    table with a per-(vehicle, unit_kind, effective_from) event log read by
--    units.ToSI at every unit-bearing telemetry sample. Miles / Fahrenheit /
--    Psi / Percent matches Tesla US defaults. source='manual' marks rows
--    seeded by this fixture rather than telemetry or rest_bootstrap.
--    effective_from is back-dated so any sample timestamp >= now()-1d hits
--    these rows on the lookup `effective_from <= sample_time ORDER BY ... DESC`.
INSERT INTO vehicle_unit_history (vehicle_id, unit_kind, unit_value, effective_from, source)
SELECT v.id, k.unit_kind, k.unit_value, now() - interval '1 day', 'manual'
FROM vehicles v
CROSS JOIN (VALUES
  ('distance',    'mi'),
  ('temperature', 'F'),
  ('pressure',    'psi'),
  ('charge',      'charge_percent')
) AS k(unit_kind, unit_value)
WHERE v.vin = 'TEST00000000000VIN'
ON CONFLICT (vehicle_id, unit_kind, effective_from, unit_value, source) DO NOTHING;

-- 3. Seed initial signal in Redis (done by app on first signal batch)
--    vehicle_live_state was dropped in Phase 14 — no longer needed here

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

-- 5. Polling config for the test vehicle (skip if table doesn't exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'polling_configs') THEN
    EXECUTE 'INSERT INTO polling_configs (vehicle_id, awake_interval_sec, asleep_interval_sec, driving_interval_sec, enabled)
    SELECT id, 30, 300, 5, true
    FROM vehicles WHERE vin = ''TEST00000000000VIN''
    ON CONFLICT (vehicle_id) DO NOTHING';
  END IF;
END $$;

COMMIT;

-- Verify
SELECT 'vehicles' AS entity, count(*) FROM vehicles
UNION ALL SELECT 'vehicle_unit_history', count(*) FROM vehicle_unit_history
UNION ALL SELECT 'settings', count(*) FROM settings;
