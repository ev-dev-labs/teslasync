BEGIN;
DROP INDEX IF EXISTS idx_notification_logs_vehicle_created;
ALTER TABLE notification_logs DROP COLUMN IF EXISTS vehicle_id;
COMMIT;
