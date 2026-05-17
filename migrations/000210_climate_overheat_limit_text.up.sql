-- Phase signals-rewrite hotfix wave 3 (rubber-duck session
-- "cabin-overheat-migration-design"):
--
-- Convert climate_snapshots.cabin_overheat_protection_temperature_limit_c
-- from DOUBLE PRECISION (Celsius) to TEXT (enum label).
--
-- WHY: the source signal CabinOverheatProtectionTemperatureLimit is the
-- proto enum ClimateOverheatProtectionTempLimit {Unknown, High, Medium,
-- Low}. The original phase-42 schema modelled it as Celsius DOUBLE
-- PRECISION on the implicit assumption that the codec would translate
-- enum -> Celsius (Low=35, Medium=38, High=40). That mapping is NOT in
-- the open Tesla Fleet Telemetry API spec and would assert precision
-- the codec cannot verify. As a result the strict JSON decoder has been
-- silently dropping every CabinOverheatProtectionTemperatureLimit
-- payload in production since the signals-rewrite cutover (the column
-- has only ever held NULL on real traffic).
--
-- The principal-architect ruling (rubber-duck session
-- "codec-audit-findings") was: do NOT invent a Celsius mapping, and do
-- NOT store ordinal codes in a `_c` column either — change the schema
-- so the column can honestly hold the enum label and lift the deferred
-- coercion in internal/tesla/codec/coercion.go.
--
-- WHAT THIS MIGRATION DOES:
--   1. DROP the empty cabin_overheat_protection_temperature_limit_c
--      DOUBLE PRECISION column (no data preservation step needed — the
--      column has been NULL on every row since the signals-rewrite
--      deploy, per the wave-2 audit and the architect's prior ruling).
--   2. ADD cabin_overheat_protection_temperature_limit TEXT in its
--      place. The `_c` suffix is dropped because ADR-004 reserves
--      SI-unit suffixes for unit-bearing numeric columns and a label
--      is neither.
--   3. Refresh the column comment.
--
-- DEPLOYMENT NOTE: this is a destructive drop+add on a TimescaleDB
-- hypertable. The codec change in the same commit will write to the
-- NEW column name; the OLD column name is referenced nowhere after
-- this commit. Per repo norms (Argo CD coordinated sync), the chart
-- bump and the migration roll out together — there is no mixed-version
-- window where both schema and writer would be inconsistent for long
-- enough to drop a meaningful number of new payloads. Migration takes
-- AccessExclusiveLock briefly while propagating the column change to
-- existing chunks; no continuous aggregate, materialized view, or
-- compression policy references this column today (verified by ripgrep
-- of the migrations dir at authoring time).
ALTER TABLE climate_snapshots
  DROP COLUMN IF EXISTS cabin_overheat_protection_temperature_limit_c;

ALTER TABLE climate_snapshots
  ADD COLUMN cabin_overheat_protection_temperature_limit TEXT;

COMMENT ON COLUMN climate_snapshots.cabin_overheat_protection_temperature_limit IS
  'Cabin overheat protection cap level — enum label from ClimateOverheatProtectionTempLimit (one of "Low", "Medium", "High"). Numeric Celsius values are NOT exposed by Tesla in the open API spec; the codec rejects numeric and "Unknown" wire shapes (see internal/tesla/codec/coercion.go).';
