ALTER TABLE notification_logs
  DROP COLUMN IF EXISTS event_type,
  DROP COLUMN IF EXISTS trigger_id;
