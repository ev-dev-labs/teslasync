-- Record row-level normalization provenance on the durable signal change feed.
--
-- Rows written before this migration, or by an older pod during a rolling
-- deployment, keep NULL. The current signal_log writer records version 1
-- after Tesla field-specific wire units have been converted to canonical SI.
-- Analytics that depend on conversion semantics can therefore exclude legacy
-- rows without guessing an application deployment timestamp or rewriting
-- historical telemetry.

ALTER TABLE signal_log
    ADD COLUMN normalization_version SMALLINT,
    ADD COLUMN normalization_write_token BOOLEAN;

COMMENT ON COLUMN signal_log.normalization_version IS
    'Normalization contract applied before persistence. NULL means legacy or unknown provenance; version 1 is the current Tesla-to-SI contract.';

COMMENT ON COLUMN signal_log.normalization_write_token IS
    'Internal rolling-deployment attestation toggled by provenance-aware writers; not an analytics field.';

-- A pre-000232 writer does not know either provenance column. On a
-- same-(vehicle, ts, field) conflict PostgreSQL therefore carries both old
-- values forward while that writer replaces the typed payload. Clear the
-- version whenever the payload changes without the attestation token
-- changing, so an old pod cannot accidentally preserve a trusted marker from
-- a newer pod. A byte-for-byte duplicate remains safe: the already-proven
-- canonical payload did not change.
CREATE OR REPLACE FUNCTION guard_signal_log_normalization_provenance()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.normalization_write_token IS NOT DISTINCT FROM OLD.normalization_write_token
       AND ROW(
           NEW.value_kind,
           NEW.str_value,
           NEW.bool_value,
           NEW.int_value,
           NEW.float_value,
           NEW.time_value
       ) IS DISTINCT FROM ROW(
           OLD.value_kind,
           OLD.str_value,
           OLD.bool_value,
           OLD.int_value,
           OLD.float_value,
           OLD.time_value
       ) THEN
        NEW.normalization_version := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signal_log_normalization_provenance_guard
BEFORE UPDATE OF
    value_kind,
    str_value,
    bool_value,
    int_value,
    float_value,
    time_value
ON signal_log
FOR EACH ROW
EXECUTE FUNCTION guard_signal_log_normalization_provenance();
