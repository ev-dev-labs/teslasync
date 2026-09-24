DROP INDEX IF EXISTS idx_notification_logs_trigger_event;
ALTER TABLE notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_event_channel_check,
  DROP CONSTRAINT IF EXISTS notification_logs_status_check;

-- Fails safely if event rows remain; export/retain them before rolling back.
ALTER TABLE notification_logs
  ALTER COLUMN channel_id SET NOT NULL,
  ADD CONSTRAINT notification_logs_status_check
    CHECK (status IN ('pending', 'sent', 'failed', 'deferred_dnd')) NOT VALID;
