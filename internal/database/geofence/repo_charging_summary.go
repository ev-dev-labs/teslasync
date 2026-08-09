package geofence

import (
	"context"
	"fmt"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// =============================================================================
// repo_charging_summary.go — read-only charging-activity summaries plus the
// explicit preview/apply repricing flow for the charging-place pricing
// feature (migration 000228_geofence_charging_place_pricing).
//
// Cost precedence (highest to lowest): manual actual > Tesla-reported actual
// > geofence tariff > default/global estimate > unknown. PreviewApplyRate /
// ApplyRate never touch manual/Tesla-actual costs or an existing cost whose
// provenance is NULL/unknown.
// =============================================================================

// repriceEligibleCostSources lists sources that may be considered for
// repricing. NULL/unknown remain eligible only when cost_decimal is NULL;
// classifyRepriceCandidates protects an existing value with either source.
// "manual" and "tesla_actual" never appear here.
var repriceEligibleCostSources = map[string]bool{
	"":                                    true, // NULL scanned into "" via COALESCE below
	systemmodel.CostSourceGeofenceTariff:  true,
	systemmodel.CostSourceDefaultEstimate: true,
	systemmodel.CostSourceUnknown:         true,
}

// ChargingSummaryByCurrency aggregates a geofence's PRICED charging activity
// (cost_decimal IS NOT NULL), grouped by currency. Different currencies are
// NEVER summed into a single total — a place that has seen both USD and EUR
// sessions (e.g. after a currency correction) returns two rows.
func (r *GeofenceRepo) ChargingSummaryByCurrency(ctx context.Context, geofenceID int64) ([]*systemmodel.GeofenceChargingSummary, error) {
	const q = `
SELECT cost_currency,
       COUNT(*),
       COALESCE(SUM(total_energy_added_wh), 0),
       COALESCE(SUM(cost_decimal), 0)
FROM charging_sessions
WHERE geofence_id = $1 AND cost_decimal IS NOT NULL AND cost_currency IS NOT NULL
GROUP BY cost_currency
ORDER BY cost_currency`
	rows, err := r.pool.Query(ctx, q, geofenceID)
	if err != nil {
		return nil, fmt.Errorf("geofence charging summary query: %w", err)
	}
	defer rows.Close()

	var out []*systemmodel.GeofenceChargingSummary
	for rows.Next() {
		s := &systemmodel.GeofenceChargingSummary{GeofenceID: geofenceID}
		if err := rows.Scan(&s.Currency, &s.SessionCount, &s.TotalEnergyWh, &s.TotalCostDecimal); err != nil {
			return nil, fmt.Errorf("geofence charging summary scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence charging summary iter: %w", err)
	}
	return out, nil
}

// ChargingActivity lists a geofence's charging sessions (any pricing state),
// newest first — the feed backing the rate-history / affected-sessions UI
// panels. limit is clamped to [1, 200]; offset floors at 0.
func (r *GeofenceRepo) ChargingActivity(ctx context.Context, geofenceID int64, limit, offset int) ([]*systemmodel.GeofenceChargingActivity, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	const q = `
SELECT id, vehicle_id, started_at, ended_at, total_energy_added_wh, cost_decimal, cost_currency, cost_source, rate_id
FROM charging_sessions
WHERE geofence_id = $1
ORDER BY started_at DESC
LIMIT $2 OFFSET $3`
	rows, err := r.pool.Query(ctx, q, geofenceID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("geofence charging activity query: %w", err)
	}
	defer rows.Close()

	var out []*systemmodel.GeofenceChargingActivity
	for rows.Next() {
		a := &systemmodel.GeofenceChargingActivity{}
		if err := rows.Scan(&a.SessionID, &a.VehicleID, &a.StartedAt, &a.EndedAt, &a.EnergyWh, &a.CostDecimal, &a.CostCurrency, &a.CostSource, &a.RateID); err != nil {
			return nil, fmt.Errorf("geofence charging activity scan: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence charging activity iter: %w", err)
	}
	return out, nil
}

// repriceCandidate is the minimal projection needed to decide whether a
// charging session is in scope for a geofence rate preview/apply operation.
type repriceCandidate struct {
	id          int64
	geofenceID  *int64
	startLat    *float64
	startLng    *float64
	energyWh    *float64
	costDecimal *float64
	costSource  *string
}

// loadRepriceCandidates loads every charging session started within
// [from, to) that is either already attributed to geofenceID or has no
// geofence attribution yet (geofence_id IS NULL — the historical-backfill
// case for sessions that predate this feature or predate this place's
// discovery). Spatial membership for the NULL-geofence_id rows is decided
// by the caller in Go (see classifyRepriceCandidates) since this codebase
// has no PostGIS geometry types, only WKT text + Go Haversine math.
func (r *GeofenceRepo) loadRepriceCandidates(ctx context.Context, geofenceID int64, from time.Time, to *time.Time) ([]repriceCandidate, error) {
	query := `
SELECT id, geofence_id, start_lat, start_lng, total_energy_added_wh, cost_decimal, cost_source
FROM charging_sessions
WHERE (geofence_id = $1 OR geofence_id IS NULL)
  AND started_at >= $2`
	args := []any{geofenceID, from}
	if to != nil {
		query += ` AND started_at < $3`
		args = append(args, *to)
	}
	rows, err := r.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("geofence reprice candidates query: %w", err)
	}
	defer rows.Close()

	var out []repriceCandidate
	for rows.Next() {
		var c repriceCandidate
		if err := rows.Scan(
			&c.id,
			&c.geofenceID,
			&c.startLat,
			&c.startLng,
			&c.energyWh,
			&c.costDecimal,
			&c.costSource,
		); err != nil {
			return nil, fmt.Errorf("geofence reprice candidates scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence reprice candidates iter: %w", err)
	}
	return out, nil
}

// classifyRepriceCandidates partitions loadRepriceCandidates' output into
// (matched, eligible, protected) against one geofence's circle:
//   - matched: already attributed to this geofence, OR unattributed but
//     spatially inside this geofence's circle.
//   - eligible (subset of matched): cost_source is geofence_tariff or
//     default_estimate, or it is empty/unknown with no existing cost, AND
//     total_energy_added_wh is known. These are the ids ApplyRate may write.
//   - protected (subset of matched): cost_source is manual/tesla_actual, or
//     an existing cost has empty/unknown provenance. They are surfaced
//     separately so the UI can explain a preview total smaller than matched.
//
// A matched session with unknown energy (still charging, or otherwise
// incomplete) is neither eligible nor protected — it simply is not
// priceable yet; MatchedSessions - EligibleSessions - ProtectedSessions
// in the preview DTO represents exactly this remainder.
func classifyRepriceCandidates(candidates []repriceCandidate, g *systemmodel.Geofence) (matched, eligible, protected []repriceCandidate) {
	cLat, cLon := g.Centroid()
	radius := g.Radius()
	for _, c := range candidates {
		inScope := false
		switch {
		case c.geofenceID != nil && *c.geofenceID == g.ID:
			inScope = true
		case c.geofenceID == nil && c.startLat != nil && c.startLng != nil && radius > 0:
			inScope = haversineMeters(*c.startLat, *c.startLng, cLat, cLon) <= radius
		}
		if !inScope {
			continue
		}
		matched = append(matched, c)

		source := ""
		if c.costSource != nil {
			source = *c.costSource
		}
		if source == systemmodel.CostSourceManual || source == systemmodel.CostSourceTeslaActual {
			protected = append(protected, c)
			continue
		}
		// Pre-feature rows can carry a real cost_decimal while cost_source is
		// NULL. Unknown provenance must be protected rather than treated as
		// unpriced, otherwise a historical backfill could overwrite an actual
		// bill imported before provenance existed.
		if c.costDecimal != nil &&
			(source == "" || source == systemmodel.CostSourceUnknown) {
			protected = append(protected, c)
			continue
		}
		if repriceEligibleCostSources[source] && c.energyWh != nil {
			eligible = append(eligible, c)
		}
	}
	return matched, eligible, protected
}

// resolveApplyWindow resolves a GeofenceRateApplyScope + the target rate
// into a concrete [from, to) window: the rate's own effective interval,
// narrowed by the scope's optional From/To bounds (the later lower bound
// and the earlier non-nil upper bound win) — "Applying must be bounded to
// the selected geofence and interval" per the design rules.
func resolveApplyWindow(scope systemmodel.GeofenceRateApplyScope, rate *systemmodel.GeofenceRate) (time.Time, *time.Time) {
	from := rate.EffectiveFrom
	if scope.From != nil && scope.From.After(from) {
		from = *scope.From
	}
	to := rate.EffectiveTo
	if scope.To != nil && (to == nil || scope.To.Before(*to)) {
		to = scope.To
	}
	return from, to
}

// PreviewApplyRate computes — WITHOUT writing anything — the effect of
// applying scope.RateID to scope.GeofenceID's charging sessions. See
// classifyRepriceCandidates for exactly which sessions are matched/
// eligible/protected.
func (r *GeofenceRepo) PreviewApplyRate(ctx context.Context, scope systemmodel.GeofenceRateApplyScope) (*systemmodel.GeofenceRateImpactPreview, error) {
	g, rate, err := r.loadGeofenceAndRate(ctx, scope.GeofenceID, scope.RateID)
	if err != nil {
		return nil, err
	}

	from, to := resolveApplyWindow(scope, rate)
	candidates, err := r.loadRepriceCandidates(ctx, scope.GeofenceID, from, to)
	if err != nil {
		return nil, err
	}
	matched, eligible, protected := classifyRepriceCandidates(candidates, g)

	preview := &systemmodel.GeofenceRateImpactPreview{
		GeofenceID:        scope.GeofenceID,
		RateID:            scope.RateID,
		Currency:          rate.Currency,
		MatchedSessions:   int64(len(matched)),
		EligibleSessions:  int64(len(eligible)),
		ProtectedSessions: int64(len(protected)),
	}
	if len(eligible) == 0 {
		return preview, nil
	}

	ids := candidateIDs(eligible)
	const q = `
SELECT COALESCE(SUM(total_energy_added_wh), 0),
       COALESCE(SUM(ROUND(total_energy_added_wh::numeric * $2::numeric, 6)), 0)
FROM charging_sessions
WHERE id = ANY($1)`
	if err := r.pool.QueryRow(ctx, q, ids, rate.RatePerWh).Scan(&preview.TotalEnergyWh, &preview.EstimatedCostDecimal); err != nil {
		return nil, fmt.Errorf("geofence rate preview aggregate: %w", err)
	}
	return preview, nil
}

// ApplyRate is the write-performing counterpart of PreviewApplyRate. It
// (re)prices exactly the eligible session ids classifyRepriceCandidates
// selects, via one bounded UPDATE using PostgreSQL NUMERIC arithmetic
// (never Go float64 multiplication). Matched historical sessions without a
// geofence_id are attributed to the place in the same statement even when
// their manual, Tesla-actual, or unknown-provenance cost is protected.
// Re-running after a rate correction converges every eligible session to the
// current rate while protected monetary fields remain unchanged.
func (r *GeofenceRepo) ApplyRate(ctx context.Context, scope systemmodel.GeofenceRateApplyScope) (*systemmodel.GeofenceRateApplyResult, error) {
	g, rate, err := r.loadGeofenceAndRate(ctx, scope.GeofenceID, scope.RateID)
	if err != nil {
		return nil, err
	}

	from, to := resolveApplyWindow(scope, rate)
	candidates, err := r.loadRepriceCandidates(ctx, scope.GeofenceID, from, to)
	if err != nil {
		return nil, err
	}
	matched, eligible, _ := classifyRepriceCandidates(candidates, g)

	result := &systemmodel.GeofenceRateApplyResult{
		GeofenceID:      scope.GeofenceID,
		RateID:          scope.RateID,
		Currency:        rate.Currency,
		MatchedSessions: int64(len(matched)),
		SkippedSessions: int64(len(matched) - len(eligible)),
	}
	needsAttribution := false
	for _, candidate := range matched {
		if candidate.geofenceID == nil {
			needsAttribution = true
			break
		}
	}
	if len(eligible) == 0 && !needsAttribution {
		return result, nil
	}

	matchedIDs := candidateIDs(matched)
	eligibleIDs := candidateIDs(eligible)
	const q = `
WITH scoped AS (
    SELECT id,
           total_energy_added_wh,
           id = ANY($3)
               AND total_energy_added_wh IS NOT NULL
               AND (
                   cost_source IN ('geofence_tariff', 'default_estimate')
                   OR (cost_source IS NULL AND cost_decimal IS NULL)
                   OR (cost_source = 'unknown' AND cost_decimal IS NULL)
               ) AS should_price
      FROM charging_sessions
     WHERE id = ANY($1)
       AND (geofence_id = $2 OR geofence_id IS NULL)
),
updated AS (
    UPDATE charging_sessions AS cs
       SET geofence_id = $2,
           cost_decimal = CASE
               WHEN scoped.should_price THEN ROUND(cs.total_energy_added_wh::numeric * $4::numeric, 6)
               ELSE cs.cost_decimal
           END,
           cost_currency = CASE WHEN scoped.should_price THEN $5 ELSE cs.cost_currency END,
           rate_id = CASE WHEN scoped.should_price THEN $6 ELSE cs.rate_id END,
           cost_source = CASE WHEN scoped.should_price THEN 'geofence_tariff' ELSE cs.cost_source END
      FROM scoped
     WHERE cs.id = scoped.id
    RETURNING scoped.should_price, cs.total_energy_added_wh, cs.cost_decimal
)
SELECT total_energy_added_wh, cost_decimal
  FROM updated
 WHERE should_price`
	rows, err := r.pool.Query(
		ctx,
		q,
		matchedIDs,
		scope.GeofenceID,
		eligibleIDs,
		rate.RatePerWh,
		rate.Currency,
		scope.RateID,
	)
	if err != nil {
		return nil, fmt.Errorf("geofence rate apply update: %w", err)
	}
	defer rows.Close()
	var priced int64
	for rows.Next() {
		var energyWh, cost float64
		if err := rows.Scan(&energyWh, &cost); err != nil {
			return nil, fmt.Errorf("geofence rate apply scan: %w", err)
		}
		priced++
		result.TotalEnergyWh += energyWh
		result.TotalCostDecimal += cost
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("geofence rate apply iter: %w", err)
	}
	result.PricedSessions = priced
	result.SkippedSessions = int64(len(matched)) - priced
	return result, nil
}

// loadGeofenceAndRate fetches and validates the (geofence, rate) pair a
// preview/apply scope refers to, returning a descriptive error when either
// side is missing or the rate does not belong to the geofence.
func (r *GeofenceRepo) loadGeofenceAndRate(ctx context.Context, geofenceID, rateID int64) (*systemmodel.Geofence, *systemmodel.GeofenceRate, error) {
	g, err := r.GetByID(ctx, geofenceID)
	if err != nil {
		return nil, nil, fmt.Errorf("load geofence %d: %w", geofenceID, err)
	}
	if g == nil {
		return nil, nil, fmt.Errorf("load geofence %d: %w", geofenceID, ErrGeofenceNotFound)
	}
	rate, err := r.GetRateByID(ctx, geofenceID, rateID)
	if err != nil {
		return nil, nil, fmt.Errorf("load geofence rate %d: %w", rateID, err)
	}
	if rate == nil {
		return nil, nil, fmt.Errorf("load geofence rate %d: %w", rateID, ErrRateNotFound)
	}
	return g, rate, nil
}

// candidateIDs projects a []repriceCandidate down to its []int64 ids for
// the ANY($1) bind in the aggregate/UPDATE queries above.
func candidateIDs(cs []repriceCandidate) []int64 {
	ids := make([]int64, len(cs))
	for i, c := range cs {
		ids[i] = c.id
	}
	return ids
}
