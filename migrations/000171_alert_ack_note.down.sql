-- Phase-46 / Prompt 20 — rollback for alert acknowledgement + audit timeline.
--
-- Drops the per-alert audit table first (FK dependency on notification_logs)
-- then removes the three nullable ack columns. Any acknowledgement state
-- recorded by the up migration is permanently lost on rollback.

BEGIN;

DROP INDEX IF EXISTS idx_notification_log_events_log;
DROP TABLE IF EXISTS notification_log_events;

ALTER TABLE notification_logs DROP COLUMN IF EXISTS acknowledgement_note;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS acknowledged_by;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS acknowledged_at;

COMMIT;
