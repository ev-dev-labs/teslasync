-- Down migration for 000228_geofence_charging_place_pricing.
--
-- Reversing the legacy geofence_electricity_rates_legacy_000004 reconciliation
-- is intentionally NOT attempted: that data now lives in geofence_rates
-- (SI canonical) and dropping this migration's schema does not resurrect the
-- pre-canonical shape or byte-identical legacy rows. This mirrors the
-- project-wide convention that forward-only SI migrations are not
-- round-trip lossless (see migrations/000184_charging_si, 000185_drives_si).
--
-- btree_gist is NOT dropped here — it was installed by, and is owned by,
-- migrations/000221_small_fleet_operations.

DROP INDEX IF EXISTS drives_end_geofence_idx;
DROP INDEX IF EXISTS drives_start_geofence_idx;
ALTER TABLE drives
    DROP COLUMN IF EXISTS end_geofence_id,
    DROP COLUMN IF EXISTS start_geofence_id;

DROP INDEX IF EXISTS charging_sessions_cost_source_idx;
DROP INDEX IF EXISTS charging_sessions_rate_idx;
DROP INDEX IF EXISTS charging_sessions_geofence_idx;
ALTER TABLE charging_sessions
    DROP CONSTRAINT IF EXISTS charging_sessions_cost_source_valid;
ALTER TABLE charging_sessions
    DROP COLUMN IF EXISTS cost_source,
    DROP COLUMN IF EXISTS rate_id,
    DROP COLUMN IF EXISTS geofence_id;

DROP TABLE IF EXISTS geofence_rates;

DROP INDEX IF EXISTS geofences_archived_idx;
DROP INDEX IF EXISTS geofences_needs_review_idx;
ALTER TABLE geofences
    DROP CONSTRAINT IF EXISTS geofences_origin_valid;
ALTER TABLE geofences
    DROP COLUMN IF EXISTS archived_at,
    DROP COLUMN IF EXISTS needs_review,
    DROP COLUMN IF EXISTS origin;
