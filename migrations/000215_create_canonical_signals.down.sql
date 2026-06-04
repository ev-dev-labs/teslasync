-- Rollback for 000215_create_canonical_signals.up.sql.
-- canonical_signal owns its FK and both indexes, and is not a shared object, so
-- dropping it is non-destructive to other tables. Indexes first, then table.
DROP INDEX IF EXISTS idx_canonical_signal_vehicle_kind_observed_at;
DROP INDEX IF EXISTS idx_canonical_signal_kind_observed_at;
DROP TABLE IF EXISTS canonical_signal;
