-- Rollback for 000214_create_raw_signals.up.sql.
-- raw_signal owns its FK and both indexes, and is not a shared object, so
-- dropping it is non-destructive to other tables. Indexes first, then table.
DROP INDEX IF EXISTS idx_raw_signal_vehicle_kind_observed_at;
DROP INDEX IF EXISTS idx_raw_signal_observed_at;
DROP TABLE IF EXISTS raw_signal;
