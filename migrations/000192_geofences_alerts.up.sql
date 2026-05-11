-- 000192_geofences_alerts.up.sql
-- Add Active toggle + Alert Type columns to the geofences table.
--
-- Pre-existing rows are backfilled with `enabled=FALSE` so an operator must
-- explicitly opt each fence in once the new UI ships. Default for fresh inserts
-- stays FALSE — the web Create flow always sends an explicit `enabled` value
-- so the default only matters for back-channel scripts/import bundles that
-- omit it.

ALTER TABLE geofences
    ADD COLUMN IF NOT EXISTS enabled        BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS alert_on_entry BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS alert_on_exit  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN geofences.enabled        IS 'Active toggle from the Geofences UI; alert evaluators MUST filter on this.';
COMMENT ON COLUMN geofences.alert_on_entry IS 'Fire an alert when a vehicle enters the fence polygon.';
COMMENT ON COLUMN geofences.alert_on_exit  IS 'Fire an alert when a vehicle exits the fence polygon.';
