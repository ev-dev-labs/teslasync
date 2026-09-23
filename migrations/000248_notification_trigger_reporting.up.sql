ALTER TABLE notification_logs
  ADD COLUMN IF NOT EXISTS trigger_id uuid,
  ADD COLUMN IF NOT EXISTS event_type text;

COMMENT ON COLUMN notification_logs.trigger_id IS 'One producer firing shared across channel delivery rows; NULL on historical uncorrelated deliveries.';
COMMENT ON COLUMN notification_logs.event_type IS 'Producer-defined event classification; NULL on historical deliveries of unknown type.';
