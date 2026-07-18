-- Migration 215: Point-in-time reconstruction index for signal_log (rollback).
--
-- Drops ONLY the index this migration may have created. The pre-existing
-- signal_log_vehicle_field_ts (owned by 000186_signal_log) is intentionally
-- left untouched — its lifecycle belongs to 000186's own down migration.
-- IF EXISTS keeps the rollback a safe no-op on a database where the up
-- migration short-circuited (because the equivalent 000186 index was
-- already present) and therefore never created idx_signal_log_vehicle_field_ts.

DROP INDEX IF EXISTS idx_signal_log_vehicle_field_ts;
