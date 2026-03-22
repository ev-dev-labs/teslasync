DROP TABLE IF EXISTS notification_metrics;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notification_schedules;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS scheduled_at;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS latency_ms;
