-- Phase signals-rewrite hotfix wave 3 (rollback).
--
-- Restore the pre-migration column shape: a DOUBLE PRECISION column
-- with the `_c` suffix. Phase-42 is forward-only (.github/ARCHITECTURE.md
-- ADR-004), so this rollback is symbolic — it satisfies the
-- golang-migrate down-file contract but is not part of any planned
-- runbook. Any data written to the TEXT column during the period the
-- up-migration was applied will be lost.
ALTER TABLE climate_snapshots
  DROP COLUMN IF EXISTS cabin_overheat_protection_temperature_limit;

ALTER TABLE climate_snapshots
  ADD COLUMN cabin_overheat_protection_temperature_limit_c DOUBLE PRECISION;

COMMENT ON COLUMN climate_snapshots.cabin_overheat_protection_temperature_limit_c IS
  'Cabin overheat protection cap in Celsius.';
