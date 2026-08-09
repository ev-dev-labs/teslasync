package geofence

import (
	"context"
	"fmt"
)

// =============================================================================
// repo_archive.go — soft-delete (archive/unarchive) for the charging-place
// pricing feature (migration 000228_geofence_charging_place_pricing).
//
// Historical-integrity rule: geofences with sessions/rates are archived
// rather than hard-deleted. Archived places are excluded from the default
// active listing (GetAll, FindByCoordinates, ListNeedsReview) but remain
// individually resolvable via GetByID for historical display (a past
// session's stored geofence_id must always resolve to *something*, even
// after the place is retired).
// =============================================================================

// Archive soft-deletes a geofence by stamping archived_at. Idempotent:
// archiving an already-archived geofence updates nothing (the original
// archive timestamp is preserved) and still returns success.
func (r *GeofenceRepo) Archive(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `UPDATE geofences SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("geofences archive %d: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		// Either already archived (no-op success) or the id does not exist.
		// Disambiguate with a lightweight existence check so callers get an
		// honest 404 for a bad id while a re-archive stays a silent success.
		g, err := r.GetByID(ctx, id)
		if err != nil {
			return fmt.Errorf("geofences archive %d: %w", id, err)
		}
		if g == nil {
			return fmt.Errorf("geofences archive %d: %w", id, ErrGeofenceNotFound)
		}
	}
	return nil
}

// Unarchive restores a previously-archived geofence back into the active
// listing. Idempotent: unarchiving an already-active geofence is a no-op
// success.
func (r *GeofenceRepo) Unarchive(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `UPDATE geofences SET archived_at = NULL, updated_at = now() WHERE id = $1 AND archived_at IS NOT NULL`, id)
	if err != nil {
		return fmt.Errorf("geofences unarchive %d: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		g, err := r.GetByID(ctx, id)
		if err != nil {
			return fmt.Errorf("geofences unarchive %d: %w", id, err)
		}
		if g == nil {
			return fmt.Errorf("geofences unarchive %d: %w", id, ErrGeofenceNotFound)
		}
	}
	return nil
}

// HasChargingHistory reports whether any charging session, rate, or drive
// endpoint still references this geofence id. The handler layer uses this
// to decide whether a delete request must be redirected to Archive instead
// — geofence_id/rate_id/start_geofence_id/end_geofence_id have no DB-level
// FK (by design, to keep the telemetry hot path unblocked), so a hard
// DELETE on a referenced geofence would silently orphan those ids rather
// than fail loudly. A place with zero history can still be hard-deleted
// exactly as before this feature.
func (r *GeofenceRepo) HasChargingHistory(ctx context.Context, id int64) (bool, error) {
	const q = `
SELECT EXISTS (
	SELECT 1 FROM charging_sessions WHERE geofence_id = $1
	UNION ALL
	SELECT 1 FROM geofence_rates WHERE geofence_id = $1
	UNION ALL
	SELECT 1 FROM drives WHERE start_geofence_id = $1 OR end_geofence_id = $1
)`
	var exists bool
	if err := r.pool.QueryRow(ctx, q, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("geofences has_charging_history %d: %w", id, err)
	}
	return exists, nil
}
