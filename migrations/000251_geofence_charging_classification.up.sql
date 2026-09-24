ALTER TABLE geofences
    ADD COLUMN IF NOT EXISTS is_charging_location boolean NOT NULL DEFAULT false;

UPDATE geofences
SET is_charging_location = true
WHERE is_charging_location = false
  AND (origin = 'charging_discovery' OR EXISTS (
      SELECT 1 FROM charging_sessions cs WHERE cs.geofence_id = geofences.id
  ));

UPDATE geofences
SET enabled = true
WHERE needs_review = false AND enabled = false;
