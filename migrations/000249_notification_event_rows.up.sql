ALTER TABLE notification_logs
  ALTER COLUMN channel_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS notification_logs_status_check;

ALTER TABLE notification_logs
  ADD CONSTRAINT notification_logs_status_check
    CHECK (status IN ('pending', 'sent', 'failed', 'deferred_dnd', 'triggered')) NOT VALID,
  ADD CONSTRAINT notification_logs_event_channel_check
    CHECK ((status = 'triggered' AND channel_id IS NULL AND trigger_id IS NOT NULL AND event_type IS NOT NULL)
       OR (status <> 'triggered' AND channel_id IS NOT NULL)) NOT VALID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_logs_trigger_event
  ON notification_logs (trigger_id) WHERE status = 'triggered';

COMMENT ON COLUMN notification_logs.channel_id IS 'NULL only for a canonical triggered event; non-NULL for per-channel delivery attempts.';
