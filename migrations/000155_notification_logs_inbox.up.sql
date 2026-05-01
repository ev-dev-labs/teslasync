-- Phase 40 / Prompt 29: notification inbox UX (read / archive state).
--
-- The /notifications page is being rebuilt as an "inbox" view of every
-- notification ever fired. Users need to mark items as read, archive what
-- they no longer want in the active feed, and see an unread count badge in
-- the header. None of that is possible against an append-only delivery log,
-- so this migration adds two nullable timestamps directly on
-- `notification_logs`:
--
--   read_at      - when the user (or auto-mark policy) marked the row read
--   archived_at  - when the user moved the row out of the active inbox
--
-- Both default to NULL ("unread" / "in the inbox"). Indexes target the
-- common queries:
--   - "unread count"      → WHERE read_at IS NULL AND archived_at IS NULL
--   - "archived view"     → WHERE archived_at IS NOT NULL
--   - "inbox by date"     → ORDER BY created_at DESC
BEGIN;

ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS read_at      timestamptz NULL,
  ADD COLUMN IF NOT EXISTS archived_at  timestamptz NULL;

COMMENT ON COLUMN notification_logs.read_at IS
  'When the user marked this notification read (auto on inbox open or per-row click). '
  'NULL = still unread. Server-authoritative so unread counts match across devices.';

COMMENT ON COLUMN notification_logs.archived_at IS
  'When the user archived this notification out of the active inbox. '
  'NULL = still in the inbox. Archived rows are still queryable via the Archived tab.';

CREATE INDEX IF NOT EXISTS idx_notification_logs_read_at
  ON notification_logs (read_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_archived_at
  ON notification_logs (archived_at);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_desc
  ON notification_logs (created_at DESC);

COMMIT;
