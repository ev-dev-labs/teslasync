package geofence

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// =============================================================================
// repo_discovery.go — auto-discovery of charging-place geofences from
// confirmed charging sessions (migration
// 000228_geofence_charging_place_pricing).
//
// This file is invoked from the async post-commit telemetry leg and the
// one-shot startup legacy-history backfill — never from the MQTT/SignalStore
// hot path — so discovery latency or a transient DB failure cannot trigger
// telemetry redelivery or block ingest.
// =============================================================================

// DiscoveryRadiusMeters is the fixed radius (in meters) of a provisional
// geofence synthesized by FindOrCreateForCharging. 75m comfortably covers a
// Supercharger stall's or driveway's GPS jitter without swallowing an
// unrelated nearby place, and matches the business requirement exactly.
const DiscoveryRadiusMeters = 75.0

// geofenceDiscoveryLockKey is the single global PostgreSQL advisory-lock
// key serializing "match-or-create a provisional charging-place geofence"
// across all concurrent callers (e.g. two vehicles finishing a charge at
// the same moment, or a retried async attempt). Charge-completion discovery
// is inherently low-frequency (bounded by concurrently-completing charge
// sessions, not by telemetry tick volume), so a single global lock is
// simpler and strictly more correct than a coordinate-grid-bucketed lock
// (which has boundary edge cases where two nearby points hash to different
// cells and race each other). The lock is transaction-scoped
// (pg_advisory_xact_lock) so it always releases at commit/rollback/crash —
// it can never be leaked or require manual cleanup.
const geofenceDiscoveryLockKey = "geofence:discovery"

// ListChargingPlaceBackfillCandidates returns one cursor-paginated batch of
// completed legacy charging sessions that have usable start coordinates but
// no geofence attribution yet. The ID cursor ensures a bad row cannot make a
// startup pass spin forever; failed rows remain eligible for the next boot.
func (r *GeofenceRepo) ListChargingPlaceBackfillCandidates(ctx context.Context, afterID int64, limit int) ([]*systemmodel.ChargingPlaceBackfillCandidate, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const query = `
SELECT id, vehicle_id, started_at, start_lat, start_lng, start_place
FROM charging_sessions
WHERE id > $1
  AND geofence_id IS NULL
  AND ended_at IS NOT NULL
  AND start_lat IS NOT NULL
  AND start_lng IS NOT NULL
  AND start_lat BETWEEN -90 AND 90
  AND start_lng BETWEEN -180 AND 180
  AND NOT (start_lat = 0 AND start_lng = 0)
ORDER BY id
LIMIT $2`
	rows, err := r.pool.Query(ctx, query, afterID, limit)
	if err != nil {
		return nil, fmt.Errorf("geofence charging backfill candidates query: %w", err)
	}
	defer rows.Close()

	var out []*systemmodel.ChargingPlaceBackfillCandidate
	for rows.Next() {
		candidate := &systemmodel.ChargingPlaceBackfillCandidate{}
		if err := rows.Scan(
			&candidate.SessionID,
			&candidate.VehicleID,
			&candidate.StartedAt,
			&candidate.StartLat,
			&candidate.StartLng,
			&candidate.StartPlace,
		); err != nil {
			return nil, fmt.Errorf("geofence charging backfill candidates scan: %w", err)
		}
		out = append(out, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence charging backfill candidates iter: %w", err)
	}
	return out, nil
}

// ApplyCurrentRateEstimate prices one completed legacy session with the rate
// active at `at` only when no configured rate covers the session's started_at.
// The provenance is default_estimate rather than geofence_tariff so a later
// explicit historical-rate apply can replace it. Actual/manual/unknown costs
// and estimates already pinned to another rate remain untouched.
func (r *GeofenceRepo) ApplyCurrentRateEstimate(ctx context.Context, sessionID, geofenceID, rateID int64, at time.Time) (bool, error) {
	const query = `
UPDATE charging_sessions AS cs
   SET cost_decimal  = ROUND(cs.total_energy_added_wh::numeric * rate.rate_per_wh, 6),
       cost_currency = rate.currency,
       rate_id       = rate.id,
       cost_source   = 'default_estimate'
  FROM geofence_rates AS rate
 WHERE cs.id = $1
   AND cs.geofence_id = $2
   AND cs.ended_at IS NOT NULL
   AND cs.total_energy_added_wh IS NOT NULL
   AND rate.id = $3
   AND rate.geofence_id = $2
   AND rate.effective_from <= $4
   AND (rate.effective_to IS NULL OR rate.effective_to > $4)
   AND NOT EXISTS (
       SELECT 1
         FROM geofence_rates AS historical
        WHERE historical.geofence_id = cs.geofence_id
          AND historical.effective_from <= cs.started_at
          AND (historical.effective_to IS NULL OR historical.effective_to > cs.started_at)
   )
   AND (
       (cs.cost_source IS NULL AND cs.cost_decimal IS NULL)
       OR (cs.cost_source = 'unknown' AND cs.cost_decimal IS NULL)
       OR (
           cs.cost_source = 'default_estimate'
           AND (cs.rate_id IS NULL OR cs.rate_id = rate.id)
       )
   )`
	tag, err := r.pool.Exec(ctx, query, sessionID, geofenceID, rateID, at.UTC())
	if err != nil {
		return false, fmt.Errorf("geofence current-rate legacy estimate: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// validCoordinate reports whether (lat, lon) is usable for geofence
// discovery: finite, in-range, and not the (0,0) null-island sentinel that
// signals "no GPS fix yet" on most trackers. Coordinate freshness is a caller
// concern: the telemetry tracker verifies the timestamped L1 value before it
// invokes discovery and never passes an unverified forward-folded location.
func validCoordinate(lat, lon float64) bool {
	if math.IsNaN(lat) || math.IsNaN(lon) || math.IsInf(lat, 0) || math.IsInf(lon, 0) {
		return false
	}
	if lat == 0 && lon == 0 {
		return false
	}
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

// FindOrCreateForCharging resolves the charging-place geofence for a
// confirmed charging session at (lat, lon). It first matches an existing
// active geofence containing the point (of either origin — a
// manually-created "Home" geofence is matched just as readily as a
// previously auto-discovered one); if none matches, it idempotently creates
// one provisional 75m-radius circle with:
//   - Origin = charging_discovery
//   - NeedsReview = true
//   - Enabled = false, AlertOnEntry = false, AlertOnExit = false (safe
//     defaults — no surprise entry/exit notifications until a human
//     reviews/configures the place)
//   - Name = suggestedName (already reverse-geocoded by the caller) or a
//     neutral fallback when empty/unavailable
//
// Returns an error without creating anything when the coordinates are
// missing, zero, or out of range — this method NEVER creates a (0,0) or
// out-of-range geofence.
//
// Concurrency / dedup: the whole match-or-create sequence runs inside one
// DB transaction holding a single global advisory lock
// (geofenceDiscoveryLockKey), and the match check is repeated INSIDE the
// lock/tx immediately before any insert. This makes the method safe to call
// concurrently and repeatedly (e.g. on retry after a transient failure)
// without ever creating more than one place per physical location: any
// caller that loses the race to acquire the lock will, upon acquiring it
// afterward, find the winner's newly-committed geofence via the re-check
// and return it instead of creating a duplicate.
//
// Returns (geofence, created, error) where created reports whether a new
// provisional geofence was inserted (false when an existing place already
// matched).
func (r *GeofenceRepo) FindOrCreateForCharging(ctx context.Context, lat, lon float64, suggestedName string) (*systemmodel.Geofence, bool, error) {
	if !validCoordinate(lat, lon) {
		return nil, false, fmt.Errorf("geofence discovery: invalid, missing, or (0,0) coordinates (%v, %v)", lat, lon)
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("geofence discovery begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, geofenceDiscoveryLockKey); err != nil {
		return nil, false, fmt.Errorf("geofence discovery lock: %w", err)
	}

	// Re-check for a match INSIDE the lock — a concurrent caller may have
	// just committed a new geofence for this exact neighborhood while we
	// were waiting for the lock.
	existing, err := findActiveGeofencesNear(ctx, tx, lat, lon)
	if err != nil {
		return nil, false, fmt.Errorf("geofence discovery match: %w", err)
	}
	if len(existing) > 0 {
		if err := tx.Commit(ctx); err != nil {
			return nil, false, fmt.Errorf("geofence discovery commit (matched): %w", err)
		}
		return existing[0], false, nil
	}

	name := strings.TrimSpace(suggestedName)
	if name == "" {
		name = "Unnamed Charging Place"
	}
	g := &systemmodel.Geofence{
		Name:         name,
		PolygonWKT:   systemmodel.CircleToPolygonWKT(lat, lon, DiscoveryRadiusMeters),
		Enabled:      false,
		AlertOnEntry: false,
		AlertOnExit:  false,
		Origin:       systemmodel.GeofenceOriginChargingDiscovery,
		NeedsReview:  true,
	}
	now := time.Now().UTC()
	const insertSQL = `
INSERT INTO geofences (name, polygon_wkt, category, enabled, alert_on_entry, alert_on_exit, created_at, updated_at, origin, needs_review)
VALUES ($1, $2, NULL, $3, $4, $5, $6, $6, $7, $8)
RETURNING id`
	if err := tx.QueryRow(ctx, insertSQL,
		g.Name, g.PolygonWKT, g.Enabled, g.AlertOnEntry, g.AlertOnExit, now, g.Origin, g.NeedsReview,
	).Scan(&g.ID); err != nil {
		return nil, false, fmt.Errorf("geofence discovery insert: %w", err)
	}
	g.CreatedAt, g.UpdatedAt = now, now

	if err := tx.Commit(ctx); err != nil {
		return nil, false, fmt.Errorf("geofence discovery commit (created): %w", err)
	}
	return g, true, nil
}

// ListNeedsReview returns active geofences awaiting human review — the
// "Needs Setup" queue surfaced by the Charging Places UI. Ordered oldest
// first so the longest-neglected provisional places surface at the top.
func (r *GeofenceRepo) ListNeedsReview(ctx context.Context) ([]*systemmodel.Geofence, error) {
	query := `SELECT ` + geofenceColumns + ` FROM geofences WHERE needs_review = true AND archived_at IS NULL ORDER BY created_at ASC`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("geofences list_needs_review query: %w", err)
	}
	defer rows.Close()

	var out []*systemmodel.Geofence
	for rows.Next() {
		g := &systemmodel.Geofence{}
		if err := scanGeofence(rows, g); err != nil {
			return nil, fmt.Errorf("geofences list_needs_review scan: %w", err)
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofences list_needs_review iter: %w", err)
	}
	return out, nil
}

// MarkReviewed clears the NeedsReview flag for a geofence — called once a
// human has confirmed/edited an auto-discovered place's name, type, or
// location. It intentionally does not touch any other column (in particular
// never Origin, which stays "charging_discovery" forever as a provenance
// record even after review).
func (r *GeofenceRepo) MarkReviewed(ctx context.Context, id int64) error {
	tag, err := r.pool.Exec(ctx, `UPDATE geofences SET needs_review = false, updated_at = now() WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("geofences mark_reviewed %d: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("geofences mark_reviewed %d: %w", id, ErrGeofenceNotFound)
	}
	return nil
}
