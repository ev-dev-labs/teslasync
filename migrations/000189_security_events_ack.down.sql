-- Phase-43a / Prompt 0006 — reverse 000189_security_events_ack.up.sql.
--
-- Idempotent: every DROP uses IF EXISTS so a partial up + immediate
-- down is safe.
--
-- The implicit ownership tie (ALTER SEQUENCE ... OWNED BY) means the
-- sequence is dropped automatically when the id column is dropped, but
-- we DROP SEQUENCE IF EXISTS at the end as a belt-and-suspenders for
-- environments where the sequence was created without the OWNED BY
-- linkage taking effect.

DROP INDEX IF EXISTS security_events_vehicle_id_idx;

ALTER TABLE security_events DROP COLUMN IF EXISTS acknowledged_by;
ALTER TABLE security_events DROP COLUMN IF EXISTS acknowledged_at;
ALTER TABLE security_events DROP COLUMN IF EXISTS id;

DROP SEQUENCE IF EXISTS security_events_id_seq;
