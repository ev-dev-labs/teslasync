-- OPS-03 — restore drill fixture.
--
-- Seeds representative rows into every table listed under
-- `critical_tables` in ops/restore/drill.yaml, so the drill actually
-- proves something.
--
-- WHY THIS EXISTS: the first version of the drill seeded only a vehicle
-- and then compared source and restored row counts for drives and
-- charging_sessions. Both were empty, so `0 == 0` passed and the drill
-- reported green while proving nothing about the two largest tables it
-- claimed to cover. `ops/restore/drill.yaml` requires critical tables to
-- be NON-EMPTY; the workflow asserts that on the SOURCE side before it
-- compares anything.
--
-- SCHEMA CONTRACT (migration 000142 baseline + 000154 timezone):
--   vehicles(id GENERATED ALWAYS AS IDENTITY, tesla_id, vin, display_name,
--            model, option_codes, color, trim_level, timezone,
--            enrolled_at, archived_at, created_at, updated_at)
--
-- `id` is GENERATED ALWAYS AS IDENTITY, so it MUST NOT be supplied.
-- Child rows therefore resolve the surrogate key by VIN rather than
-- assuming a literal id. Enforced by
-- `go run ./cmd/ops-gate -check fixtures`, which reconstructs the schema
-- from the migrations and rejects any fixture that writes a dropped
-- column or an identity column — and by the `fixture-execution` CI job,
-- which runs this file against a freshly migrated database.
--
-- Columns are SI-canonical (phase-42 / ADR-004): meters, seconds, watt
-- hours, m/s, watts. Do not reintroduce mi/min/kWh/mph suffixes.

BEGIN;

-- ── idempotency ──────────────────────────────────────────────────────
-- Child rows have surrogate BIGSERIAL keys and no natural key, so a
-- re-run would otherwise double the counts and make the parity numbers
-- depend on how many times the drill had executed.
DELETE FROM charging_sessions
 WHERE vehicle_id IN (SELECT id FROM vehicles WHERE vin LIKE 'DRILL%');
DELETE FROM drives
 WHERE vehicle_id IN (SELECT id FROM vehicles WHERE vin LIKE 'DRILL%');

-- ── vehicles ─────────────────────────────────────────────────────────
-- No explicit `id`: the column is GENERATED ALWAYS AS IDENTITY.
-- ON CONFLICT (vin) keeps the surrogate key stable across re-runs so the
-- child rows below always resolve to the same vehicle.
INSERT INTO vehicles (tesla_id, vin, display_name, model, option_codes, color, trim_level, timezone)
VALUES
  (1900000001, 'DRILL000000000001', 'Drill Model Y', 'Model Y', 'MTY07,PMNG,WY19B', 'Midnight Silver', 'Long Range', 'America/Los_Angeles'),
  (1900000002, 'DRILL000000000002', 'Drill Model 3', 'Model 3', 'MT303,PPSB,W40B',  'Deep Blue',       'Performance', 'America/New_York')
ON CONFLICT (vin) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  model        = EXCLUDED.model,
  color        = EXCLUDED.color,
  trim_level   = EXCLUDED.trim_level,
  timezone     = EXCLUDED.timezone;

INSERT INTO vehicle_live_state (vehicle_id, updated_at, drive_state, soc_pct, odometer_m)
SELECT v.id, now(), 'park', 68.5, 120103000
  FROM vehicles v WHERE v.vin = 'DRILL000000000001'
ON CONFLICT (vehicle_id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

INSERT INTO vehicle_live_state (vehicle_id, updated_at, drive_state, soc_pct, odometer_m)
SELECT v.id, now(), 'drive', 41.0, 45195000
  FROM vehicles v WHERE v.vin = 'DRILL000000000002'
ON CONFLICT (vehicle_id) DO UPDATE SET updated_at = EXCLUDED.updated_at;

-- ── drives ───────────────────────────────────────────────────────────
-- Three completed drives plus one in progress (ended_at NULL), so the
-- round trip exercises both populated and nullable columns.
INSERT INTO drives (vehicle_id, started_at, ended_at,
                    start_lat, start_lng, end_lat, end_lng,
                    start_place, end_place,
                    start_odometer_m, end_odometer_m, distance_m, duration_s,
                    start_soc_pct, end_soc_pct,
                    energy_used_wh, regen_energy_wh,
                    avg_speed_mps, max_speed_mps, avg_power_w, peak_power_w,
                    ambient_temp_c_avg)
SELECT v.id, d.started_at, d.ended_at,
       d.start_lat, d.start_lng, d.end_lat, d.end_lng,
       d.start_place, d.end_place,
       d.start_odometer_m, d.end_odometer_m, d.distance_m, d.duration_s,
       d.start_soc_pct, d.end_soc_pct,
       d.energy_used_wh, d.regen_energy_wh,
       d.avg_speed_mps, d.max_speed_mps, d.avg_power_w, d.peak_power_w,
       d.ambient_temp_c_avg
  FROM (VALUES
    ('DRILL000000000001', now() - interval '10 days', now() - interval '10 days' + interval '42 minutes',
     37.7749, -122.4194, 37.3382, -121.8863, 'Home', 'Office',
     120000000.0, 120075000.0, 75000.0, 2520::bigint,
     82.0::real, 68.5::real, 13800.0, 1450.0, 29.8, 33.5, 19714.0, 88000.0, 14.5),
    ('DRILL000000000001', now() - interval '7 days', now() - interval '7 days' + interval '18 minutes',
     37.3382, -121.8863, 37.4419, -122.1430, 'Office', 'Supercharger',
     120075000.0, 120103000.0, 28000.0, 1080::bigint,
     68.5::real, 61.0::real, 5200.0, 640.0, 25.9, 31.2, 17333.0, 62000.0, 16.1),
    ('DRILL000000000002', now() - interval '3 days', now() - interval '3 days' + interval '95 minutes',
     34.0522, -118.2437, 32.7157, -117.1611, 'Los Angeles', 'San Diego',
     45000000.0, 45195000.0, 195000.0, 5700::bigint,
     95.0::real, 41.0::real, 36400.0, 3100.0, 34.2, 36.1, 22989.0, 141000.0, 21.8),
    ('DRILL000000000002', now() - interval '2 hours', NULL::timestamptz,
     32.7157, -117.1611, NULL::double precision, NULL::double precision, 'San Diego', NULL::text,
     45195000.0, NULL::double precision, NULL::double precision, NULL::bigint,
     41.0::real, NULL::real, NULL::double precision, NULL::double precision,
     NULL::double precision, NULL::double precision, NULL::double precision, NULL::double precision,
     NULL::double precision)
  ) AS d(vin, started_at, ended_at,
         start_lat, start_lng, end_lat, end_lng,
         start_place, end_place,
         start_odometer_m, end_odometer_m, distance_m, duration_s,
         start_soc_pct, end_soc_pct,
         energy_used_wh, regen_energy_wh,
         avg_speed_mps, max_speed_mps, avg_power_w, peak_power_w,
         ambient_temp_c_avg)
  JOIN vehicles v ON v.vin = d.vin;

-- ── charging_sessions ────────────────────────────────────────────────
INSERT INTO charging_sessions (vehicle_id, started_at, ended_at,
                               start_soc_pct, end_soc_pct, delta_soc_pct,
                               start_odometer_m, end_odometer_m,
                               start_lat, start_lng, start_place,
                               total_energy_added_wh, peak_power_w, avg_power_w,
                               cost_decimal, cost_currency, charger_type, cable_type)
SELECT v.id, c.started_at, c.ended_at,
       c.start_soc_pct, c.end_soc_pct, c.delta_soc_pct,
       c.start_odometer_m, c.end_odometer_m,
       c.start_lat, c.start_lng, c.start_place,
       c.total_energy_added_wh, c.peak_power_w, c.avg_power_w,
       c.cost_decimal, c.cost_currency, c.charger_type, c.cable_type
  FROM (VALUES
    ('DRILL000000000001', now() - interval '7 days' + interval '20 minutes',
                          now() - interval '7 days' + interval '52 minutes',
     61.0, 90.0, 29.0, 120103000.0, 120103000.0, 37.4419, -122.1430, 'Supercharger',
     21500.0, 187000.0, 40312.0, 8.6000::numeric(12,4), 'USD'::char(3), 'supercharger', 'ccs'),
    ('DRILL000000000001', now() - interval '4 days',
                          now() - interval '4 days' + interval '6 hours',
     45.0, 80.0, 35.0, 120103000.0, 120103000.0, 37.7749, -122.4194, 'Home',
     26000.0, 11500.0, 4333.0, 3.1200::numeric(12,4), 'USD'::char(3), 'ac', 'j1772'),
    ('DRILL000000000002', now() - interval '3 days' + interval '100 minutes',
                          now() - interval '3 days' + interval '135 minutes',
     41.0, 78.0, 37.0, 45195000.0, 45195000.0, 32.7157, -117.1611, 'Supercharger',
     27400.0, 205000.0, 46971.0, 10.9600::numeric(12,4), 'USD'::char(3), 'supercharger', 'ccs')
  ) AS c(vin, started_at, ended_at,
         start_soc_pct, end_soc_pct, delta_soc_pct,
         start_odometer_m, end_odometer_m,
         start_lat, start_lng, start_place,
         total_energy_added_wh, peak_power_w, avg_power_w,
         cost_decimal, cost_currency, charger_type, cable_type)
  JOIN vehicles v ON v.vin = c.vin;

COMMIT;

-- ── verification ─────────────────────────────────────────────────────
-- The workflow independently asserts non-zero counts; this is for the
-- job log so a human reading a failed run sees what was seeded.
SELECT 'vehicles' AS table_name, count(*) AS seeded_rows
  FROM vehicles WHERE vin LIKE 'DRILL%'
UNION ALL
SELECT 'drives', count(*) FROM drives
 WHERE vehicle_id IN (SELECT id FROM vehicles WHERE vin LIKE 'DRILL%')
UNION ALL
SELECT 'charging_sessions', count(*) FROM charging_sessions
 WHERE vehicle_id IN (SELECT id FROM vehicles WHERE vin LIKE 'DRILL%');
