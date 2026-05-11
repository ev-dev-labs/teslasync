-- 000192_geofences_alerts.down.sql
-- Reverse 000192_geofences_alerts.up.sql.
-- Drop in reverse declaration order; IF EXISTS keeps the down idempotent.

ALTER TABLE geofences
    DROP COLUMN IF EXISTS alert_on_exit,
    DROP COLUMN IF EXISTS alert_on_entry,
    DROP COLUMN IF EXISTS enabled;
