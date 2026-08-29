-- Restore the exact 000232 normalization-only trigger body before removing
-- DT-01 columns. The existing trigger remains installed throughout rollback.
DROP TRIGGER IF EXISTS signal_log_transport_evidence_capture ON signal_log;
DROP FUNCTION IF EXISTS persist_signal_transport_evidence();
DROP TABLE IF EXISTS signal_transport_evidence;

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

ALTER TABLE signal_log
    DROP CONSTRAINT IF EXISTS signal_log_ingest_origin_check,
    DROP COLUMN IF EXISTS provenance_write_token,
    DROP COLUMN IF EXISTS received_at,
    DROP COLUMN IF EXISTS source_emitted_at,
    DROP COLUMN IF EXISTS ingest_origin;
