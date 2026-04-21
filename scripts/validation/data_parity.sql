-- data_parity.sql
-- Verify every JSONB-backfilled value still matches the native column it
-- replaced. Run AFTER migration 000143 (backfill), BEFORE the corresponding
-- column-drop migration. After 000144+ the native columns no longer exist
-- and these checks become tautological — use the compat views instead
-- (see v_charging_telemetry, v_positions, ...).
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/validation/data_parity.sql

\set ON_ERROR_STOP on
\pset pager off

\echo ''
\echo '=== Data Parity — JSONB Backfill Verification ==='
\echo ''

-- ---------------------------------------------------------------------------
-- 1. No rows left behind (signals is always populated)
-- ---------------------------------------------------------------------------
\echo '--- 1. Signals population coverage ---'
SELECT t AS table_name,
       total,
       empty_signals,
       CASE WHEN empty_signals = 0
            THEN '✅ PASS'
            ELSE '❌ FAIL — ' || empty_signals || ' rows missing signals'
       END AS status
FROM (
  SELECT 'charging_telemetry'      AS t, count(*) AS total,
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb) AS empty_signals
    FROM charging_telemetry
  UNION ALL
  SELECT 'climate_snapshots',       count(*),
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb)
    FROM climate_snapshots
  UNION ALL
  SELECT 'security_events',         count(*),
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb)
    FROM security_events
  UNION ALL
  SELECT 'positions',               count(*),
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb)
    FROM positions
  UNION ALL
  SELECT 'motor_snapshots',         count(*),
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb)
    FROM motor_snapshots
  UNION ALL
  SELECT 'tire_pressure_snapshots', count(*),
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb)
    FROM tire_pressure_snapshots
  UNION ALL
  SELECT 'media_snapshots',         count(*),
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb)
    FROM media_snapshots
  UNION ALL
  SELECT 'safety_snapshots',        count(*),
         count(*) FILTER (WHERE signals IS NULL OR signals = '{}'::jsonb)
    FROM safety_snapshots
) s
ORDER BY t;

-- ---------------------------------------------------------------------------
-- 2. Column ↔ JSONB value parity (only meaningful while native columns still
--    exist, i.e. between migrations 000143 and 000144). The DO block guards
--    against the columns having been dropped.
-- ---------------------------------------------------------------------------
\echo ''
\echo '--- 2. Column vs JSONB value parity (charging_telemetry) ---'

DO $$
DECLARE
  has_soc  boolean;
  mismatches bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'charging_telemetry' AND column_name = 'soc'
  ) INTO has_soc;

  IF NOT has_soc THEN
    RAISE NOTICE 'skipped — native columns already dropped (use v_charging_telemetry for runtime parity)';
    RETURN;
  END IF;

  EXECUTE $q$
    SELECT count(*) FROM charging_telemetry
    WHERE NOT (
      soc                  IS NOT DISTINCT FROM (signals->>'soc')::double precision
      AND charge_energy_added IS NOT DISTINCT FROM (signals->>'charge_energy_added')::double precision
      AND est_battery_range   IS NOT DISTINCT FROM (signals->>'est_battery_range')::double precision
      AND charger_power       IS NOT DISTINCT FROM (signals->>'charger_power')::double precision
      AND charge_amps         IS NOT DISTINCT FROM (signals->>'charge_amps')::double precision
      AND ideal_battery_range IS NOT DISTINCT FROM (signals->>'ideal_battery_range')::double precision
      AND usable_battery_level IS NOT DISTINCT FROM (signals->>'usable_battery_level')::double precision
    )
  $q$ INTO mismatches;

  IF mismatches = 0 THEN
    RAISE NOTICE '✅ PASS — all charging_telemetry column/JSONB values match';
  ELSE
    RAISE WARNING '❌ FAIL — % rows have column/JSONB mismatches', mismatches;
  END IF;
END $$;

\echo ''
\echo 'Done.'
