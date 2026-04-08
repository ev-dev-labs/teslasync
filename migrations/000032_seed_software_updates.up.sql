-- Migration 32: Seed software_updates from vehicle_config_snapshots
-- The InsertIfChanged firmware tracking was added after initial deployment,
-- so existing firmware versions need to be backfilled from config snapshots.
INSERT INTO software_updates (vehicle_id, version, status, installed_at, created_at)
SELECT DISTINCT ON (vehicle_id)
  vehicle_id,
  COALESCE(version, software_update_version),
  'installed',
  created_at,
  created_at
FROM vehicle_config_snapshots
WHERE (version IS NOT NULL AND version != '') OR (software_update_version IS NOT NULL AND software_update_version != '')
ORDER BY vehicle_id, created_at DESC
ON CONFLICT DO NOTHING;
