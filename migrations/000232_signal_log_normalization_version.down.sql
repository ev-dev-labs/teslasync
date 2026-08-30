-- Keep this migration applied during an application rollback: older writers
-- safely ignore the nullable provenance column. Dropping it removes the only
-- row-level distinction between legacy and current normalization semantics.

DROP TRIGGER IF EXISTS signal_log_normalization_provenance_guard ON signal_log;
DROP FUNCTION IF EXISTS guard_signal_log_normalization_provenance();

ALTER TABLE signal_log
    DROP COLUMN IF EXISTS normalization_write_token,
    DROP COLUMN IF EXISTS normalization_version;
