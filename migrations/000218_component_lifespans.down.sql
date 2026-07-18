-- Migration 218: Component lifespans reference table (rollback).
--
-- Drops the whole component model. IF EXISTS keeps the rollback a safe no-op on
-- a database where the up migration never ran. Dropping the table also discards
-- the seeded figures and any admin edits — the Remaining Useful Life endpoints
-- degrade to a 500 until the up migration is re-applied, which is the intended
-- "feature removed" state for a down migration.

DROP TABLE IF EXISTS component_lifespans;
