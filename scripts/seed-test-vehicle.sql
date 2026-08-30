-- Seed a single test vehicle for local development and signal replay.
--
-- REWRITTEN against the current schema. The previous version of this
-- file still targeted the pre-000142 table shape — it inserted an
-- explicit `id` (now GENERATED ALWAYS AS IDENTITY) plus `vehicle_id`,
-- `trim_badging`, `exterior_color`, `wheel_type`, `state` and `healthy`,
-- none of which exist any more. It would have failed on the first
-- statement against any current database, and nothing referenced it, so
-- the breakage was invisible. It is now registered in
-- ops/fixtures/registry.yaml, which means:
--
--   * `go run ./cmd/ops-gate -check fixtures` reconstructs the schema
--     from migrations/ and rejects any dropped/identity column, and
--   * the `fixture-execution` job in .github/workflows/ops-gate.yml
--     actually runs it against a freshly migrated database.
--
-- For the fuller local-dev fixture (units history, live state, settings)
-- use tests/fixtures/seed_test_vehicle.sql instead; this file is the
-- minimal "one vehicle exists" seed.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/seed-test-vehicle.sql

BEGIN;

-- `id` is GENERATED ALWAYS AS IDENTITY — never supplied. `vin` is the
-- natural key, so ON CONFLICT (vin) makes this safely re-runnable.
INSERT INTO vehicles (tesla_id, vin, display_name, model, option_codes, color, trim_level, timezone)
VALUES (1000000001, 'TEST00000000VIN01', 'Test Model Y', 'Model Y', 'MTY07,PMNG,WY19B', 'Midnight Silver', 'Long Range', 'UTC')
ON CONFLICT (vin) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  model        = EXCLUDED.model,
  color        = EXCLUDED.color,
  trim_level   = EXCLUDED.trim_level;

-- Live-state row keyed off the generated surrogate id.
INSERT INTO vehicle_live_state (vehicle_id, updated_at)
SELECT v.id, now() FROM vehicles v WHERE v.vin = 'TEST00000000VIN01'
ON CONFLICT (vehicle_id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

COMMIT;

SELECT id, tesla_id, vin, display_name, model, timezone
  FROM vehicles WHERE vin = 'TEST00000000VIN01';
