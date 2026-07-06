-- Migration 217: Grid carbon-intensity diurnal model (rollback).
--
-- Drops the whole grid model. IF EXISTS keeps the rollback a safe no-op on a
-- database where the up migration never ran. Dropping the table also discards
-- the seeded curve and any admin edits — the Carbon Intelligence endpoints
-- degrade to a 500 until the up migration is re-applied, which is the intended
-- "feature removed" state for a down migration.

DROP TABLE IF EXISTS grid_carbon_intensity;
