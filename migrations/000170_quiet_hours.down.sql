-- Phase-46 / Prompt 19 rollback: drop notification_quiet_hours and the
-- helper severity / partial-status index added to notification_logs. Any
-- deferred_dnd rows are left intact (they will appear as a foreign status
-- value in the older code) — operators downgrading should drain them
-- with `UPDATE notification_logs SET status='failed' WHERE status='deferred_dnd'`
-- before applying this rollback if they want a clean inbox.
BEGIN;

DROP INDEX IF EXISTS idx_notification_logs_status_created;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS severity;

DROP INDEX IF EXISTS idx_notification_quiet_hours_user;
DROP TABLE IF EXISTS notification_quiet_hours;

COMMIT;
