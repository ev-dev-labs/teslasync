-- Reverse Phase 40 / Prompt 29.
BEGIN;

DROP INDEX IF EXISTS idx_notification_logs_created_desc;
DROP INDEX IF EXISTS idx_notification_logs_archived_at;
DROP INDEX IF EXISTS idx_notification_logs_read_at;

ALTER TABLE notification_logs
  DROP COLUMN IF EXISTS archived_at,
  DROP COLUMN IF EXISTS read_at;

COMMIT;
