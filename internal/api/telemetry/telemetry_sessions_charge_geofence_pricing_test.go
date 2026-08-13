package telemetry

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	dto "github.com/prometheus/client_model/go"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// =============================================================================
// telemetry_sessions_charge_geofence_pricing_test.go — tracker-layer tests for
// applyGeofencePricingAsync (migration 000228_geofence_charging_place_pricing).
//
// Two contracts are pinned here, per the feature's non-negotiable design:
//
//  1. Rate attribution keys off the session's STARTED_AT, never "now" — a
//     session that began before a rate's cutover must retain the OLD rate
//     forever, even though "now" (when this async leg actually runs, which
//     may be seconds after the session started, and is always long after
//     any historical cutover in these fixtures) falls inside a newer rate's
//     window.
//  2. Discovery/pricing failures — including a fully unreachable database —
//     are logged/counted and NEVER propagated to the caller: the function
//     has no return value, cannot block indefinitely (its context carries a
//     15s deadline), and (via the safeGo wrapper installed at its only call
//     site in telemetry_sessions_charge_tracking.go) cannot crash the
//     process even if something inside it were to panic.
//  3. An automatic retry can reapply the same pinned rate, but cannot replace
//     an existing geofence-tariff cost with a different rate version.
//     Historical repricing remains exclusive to the explicit preview/apply
//     endpoint.
//
// TelemetrySessionTracker's repo fields (chargeRepo, geofenceRepo, ...) are
// concrete *xxxdb.XxxRepo types, not interfaces — there is no fake-pool test
// seam for this package (see place_label_repair_test.go's identical
// rationale). These tests reuse that file's DATABASE_URL/TESLASYNC_TEST_DSN
// gating (repairDSNOrSkip) and skip cleanly wherever no reachable database
// with migration 000228 applied is configured, mirroring
// database/energy/roundtrip_test.go and place_label_repair_test.go.
// =============================================================================

// openGeofencePricingDB mirrors openRepairDB but asserts on the columns this
// feature's migration (000228) adds instead of place_label_version.
func openGeofencePricingDB(t *testing.T) *database.DB {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), repairDSNOrSkip(t))
	if err != nil {
		t.Skipf("cannot open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot reach database: %v", err)
	}
	db := &database.DB{Pool: pool}
	if _, err := pool.Exec(ctx, `SELECT geofence_id, rate_id, cost_source FROM charging_sessions LIMIT 0`); err != nil {
		t.Skipf("charging_sessions geofence-pricing columns missing; migration 000228 not applied: %v", err)
	}
	if _, err := pool.Exec(ctx, `SELECT rate_per_wh, currency, effective_from, effective_to FROM geofence_rates LIMIT 0`); err != nil {
		t.Skipf("geofence_rates table missing; migration 000228 not applied: %v", err)
	}
	return db
}

// counterValue reads the current scalar value of a prometheus Counter without
// pulling in the prometheus/client_golang/prometheus/testutil package. Local
// copy of the identically-named helper in internal/api/api_call_log_middleware_test.go
// (that package is not importable from this subpackage's test binary).
func counterValue(c interface {
	Write(*dto.Metric) error
}) float64 {
	pb := &dto.Metric{}
	if err := c.Write(pb); err != nil {
		return 0
	}
	return pb.GetCounter().GetValue()
}

// seedPricingGeofence inserts one geofence centered at (lat, lon) with a 75m
// circle (the same radius FindOrCreateForCharging uses), removed via
// t.Cleanup. FindByCoordinates has no spatial index — it scans every
// non-archived geofence row and filters in Go — so distinct, deliberately
// improbable test coordinates keep concurrently-run tests in this file from
// ever matching each other's fixtures.
func seedPricingGeofence(t *testing.T, db *database.DB, lat, lon float64, name string) int64 {
	t.Helper()
	ctx := context.Background()
	wkt := systemmodel.CircleToPolygonWKT(lat, lon, 75)
	var id int64
	err := db.Pool.QueryRow(ctx, `
INSERT INTO geofences (name, polygon_wkt, category, enabled, origin, needs_review)
VALUES ($1, $2, 'custom', true, 'manual', false)
RETURNING id`, name, wkt).Scan(&id)
	if err != nil {
		t.Fatalf("seed geofence: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM geofences WHERE id = $1`, id)
	})
	return id
}

// seedPricingRate inserts one geofence_rates version, removed via t.Cleanup.
// effectiveTo may be zero-value (time.Time{}) to mean "open-ended" (NULL).
func seedPricingRate(t *testing.T, db *database.DB, geofenceID int64, ratePerWh float64, currency string, effectiveFrom, effectiveTo time.Time) int64 {
	t.Helper()
	ctx := context.Background()
	var effTo *time.Time
	if !effectiveTo.IsZero() {
		effTo = &effectiveTo
	}
	var id int64
	err := db.Pool.QueryRow(ctx, `
INSERT INTO geofence_rates (geofence_id, rate_per_wh, currency, effective_from, effective_to)
VALUES ($1, $2, $3, $4, $5)
RETURNING id`, geofenceID, ratePerWh, currency, effectiveFrom, effTo).Scan(&id)
	if err != nil {
		t.Fatalf("seed rate: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM geofence_rates WHERE id = $1`, id)
	})
	return id
}

// seedPricingSession inserts one charging_sessions row started at startedAt
// with the given energy (nil for "no energy yet"), removed via t.Cleanup.
func seedPricingSession(t *testing.T, db *database.DB, vehicleID int64, startedAt time.Time, energyWh *float64) int64 {
	t.Helper()
	ctx := context.Background()
	var id int64
	err := db.Pool.QueryRow(ctx, `
INSERT INTO charging_sessions (vehicle_id, started_at, total_energy_added_wh)
VALUES ($1, $2, $3)
RETURNING id`, vehicleID, startedAt, energyWh).Scan(&id)
	if err != nil {
		t.Fatalf("seed charging session: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM charging_sessions WHERE id = $1`, id)
	})
	return id
}

func seedCompletedLegacyPricingSession(
	t *testing.T,
	db *database.DB,
	vehicleID int64,
	startedAt time.Time,
	lat, lon float64,
	startPlace string,
	energyWh float64,
) int64 {
	t.Helper()
	var id int64
	err := db.Pool.QueryRow(context.Background(), `
INSERT INTO charging_sessions (
    vehicle_id, started_at, ended_at, start_lat, start_lng,
    start_place, total_energy_added_wh
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id`,
		vehicleID,
		startedAt,
		startedAt.Add(time.Hour),
		lat,
		lon,
		startPlace,
		energyWh,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seed completed legacy charging session: %v", err)
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM charging_sessions WHERE id = $1`, id)
	})
	return id
}

// pricingSessionRow is what the tests read back from charging_sessions after
// calling applyGeofencePricingAsync.
type pricingSessionRow struct {
	geofenceID  *int64
	rateID      *int64
	costSource  *string
	costDecimal *string // read as text to assert exact NUMERIC output, no float parsing
	costCurr    *string
}

func readPricingSession(t *testing.T, db *database.DB, sessionID int64) pricingSessionRow {
	t.Helper()
	var row pricingSessionRow
	err := db.Pool.QueryRow(context.Background(), `
SELECT geofence_id, rate_id, cost_source, cost_decimal::text, cost_currency
  FROM charging_sessions WHERE id = $1`, sessionID).
		Scan(&row.geofenceID, &row.rateID, &row.costSource, &row.costDecimal, &row.costCurr)
	if err != nil {
		t.Fatalf("read charging session %d: %v", sessionID, err)
	}
	return row
}

func countGeofences(t *testing.T, db *database.DB) int {
	t.Helper()
	var n int
	if err := db.Pool.QueryRow(context.Background(), `SELECT count(*) FROM geofences`).Scan(&n); err != nil {
		t.Fatalf("count geofences: %v", err)
	}
	return n
}

// Deliberately-improbable, far-apart fixture coordinates so this file's
// tests (and any concurrent geofence created by a genuinely different
// process on a shared dev database) cannot spatially collide with one
// another. Each constant is used by exactly one test below.
const (
	pricingLatBeforeCutover = 12.1000
	pricingLonBeforeCutover = -45.1000
	pricingLatNoRate        = 13.2000
	pricingLonNoRate        = -46.2000
	pricingLatDiscover      = 14.3000
	pricingLonDiscover      = -47.3000
	pricingLatPinnedRate    = 15.4000
	pricingLonPinnedRate    = -48.4000
	pricingLatLegacyCurrent = 16.5000
	pricingLonLegacyCurrent = -49.5000
	pricingLatLegacyHistory = 17.6000
	pricingLonLegacyHistory = -50.6000
	pricingLatLegacyActual  = 18.7000
	pricingLonLegacyActual  = -51.7000
)

// TestApplyGeofencePricingAsync_UsesStartedAt_NotNow is the central proof
// required by this feature: a session that STARTED before a rate cutover
// must be priced with the OLD rate, even though the async pricing leg
// always actually executes well after that historical cutover (i.e. "now"
// falls inside the newer, open-ended rate's window in every one of these
// fixtures). A regression that swapped GetActiveRateAt's instant argument
// for time.Now() would silently apply the NEW rate/rate_id instead — this
// test fails loudly if that happens.
func TestApplyGeofencePricingAsync_UsesStartedAt_NotNow(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(t, db, pricingLatBeforeCutover, pricingLonBeforeCutover, "Old Rate Fixture Place")

	cutover := time.Date(2021, 6, 15, 0, 0, 0, 0, time.UTC)
	rateOldID := seedPricingRate(t, db, geofenceID, 0.0001, "USD", time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), cutover)
	rateNewID := seedPricingRate(t, db, geofenceID, 0.00012, "USD", cutover, time.Time{})
	if rateOldID == rateNewID {
		t.Fatalf("fixture bug: old and new rate ids must differ")
	}

	startedAt := time.Date(2020, 6, 1, 0, 0, 0, 0, time.UTC) // squarely inside the OLD rate's window
	sessionID := seedPricingSession(t, db, 810001, startedAt, floatPtr(10000))

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	tracker.applyGeofencePricingAsync(sessionID, 810001, pricingLatBeforeCutover, pricingLonBeforeCutover, startedAt, map[string]interface{}{})

	row := readPricingSession(t, db, sessionID)
	if row.rateID == nil || *row.rateID != rateOldID {
		t.Fatalf("rate_id = %v, want the OLD rate %d (session started before the cutover)", row.rateID, rateOldID)
	}
	if row.geofenceID == nil || *row.geofenceID != geofenceID {
		t.Fatalf("geofence_id = %v, want %d", row.geofenceID, geofenceID)
	}
	if row.costSource == nil || *row.costSource != "geofence_tariff" {
		t.Fatalf("cost_source = %v, want geofence_tariff", row.costSource)
	}
	// 10000 Wh * 0.0001 currency/Wh = 1.0000 exactly.
	if row.costDecimal == nil || *row.costDecimal != "1.0000" {
		t.Fatalf("cost_decimal = %v, want 1.0000 (10000 Wh at the OLD 0.0001/Wh rate)", row.costDecimal)
	}
	if row.costCurr == nil || *row.costCurr != "USD" {
		t.Fatalf("cost_currency = %v, want USD", row.costCurr)
	}
}

// TestApplyGeofencePricingAsync_UsesStartedAt_AtAndAfterCutover is the
// companion boundary case: a session starting exactly AT (or after) the
// cutover instant must get the NEW rate — pinning the half-open
// [effective_from, effective_to) semantics end-to-end through the tracker,
// not just at the repository layer (already covered by
// internal/database/geofence's own rate tests).
func TestApplyGeofencePricingAsync_UsesStartedAt_AtAndAfterCutover(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(t, db, pricingLatBeforeCutover+0.5, pricingLonBeforeCutover-0.5, "New Rate Fixture Place")

	cutover := time.Date(2021, 6, 15, 0, 0, 0, 0, time.UTC)
	_ = seedPricingRate(t, db, geofenceID, 0.0001, "USD", time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), cutover)
	rateNewID := seedPricingRate(t, db, geofenceID, 0.00012, "USD", cutover, time.Time{})

	sessionID := seedPricingSession(t, db, 810002, cutover, floatPtr(10000)) // exactly at the boundary

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	tracker.applyGeofencePricingAsync(sessionID, 810002, pricingLatBeforeCutover+0.5, pricingLonBeforeCutover-0.5, cutover, map[string]interface{}{})

	row := readPricingSession(t, db, sessionID)
	if row.rateID == nil || *row.rateID != rateNewID {
		t.Fatalf("rate_id = %v, want the NEW rate %d (session started exactly at the cutover, which is inclusive of the new period)", row.rateID, rateNewID)
	}
	// 10000 Wh * 0.00012 currency/Wh = 1.2000 exactly.
	if row.costDecimal == nil || *row.costDecimal != "1.2000" {
		t.Fatalf("cost_decimal = %v, want 1.2000 (10000 Wh at the NEW 0.00012/Wh rate)", row.costDecimal)
	}
}

func TestApplyGeofencePricingAsync_DifferentPinnedRateRequiresExplicitApply(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(t, db, pricingLatPinnedRate, pricingLonPinnedRate, "Pinned Rate Fixture Place")
	startedAt := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	activeRateID := seedPricingRate(t, db, geofenceID, 0.00012, "USD", time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), time.Time{})
	sessionID := seedPricingSession(t, db, 810006, startedAt, floatPtr(10000))
	pinnedRateID := activeRateID + 1_000_000

	if _, err := db.Pool.Exec(context.Background(), `
UPDATE charging_sessions
SET geofence_id = $2,
    rate_id = $3,
    cost_source = 'geofence_tariff',
    cost_decimal = 9.99,
    cost_currency = 'USD'
WHERE id = $1`, sessionID, geofenceID, pinnedRateID); err != nil {
		t.Fatalf("seed pinned tariff: %v", err)
	}

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	tracker.applyGeofencePricingAsync(
		sessionID,
		810006,
		pricingLatPinnedRate,
		pricingLonPinnedRate,
		startedAt,
		map[string]interface{}{},
	)

	row := readPricingSession(t, db, sessionID)
	if row.rateID == nil || *row.rateID != pinnedRateID {
		t.Fatalf("rate_id = %v, want pinned historical rate %d", row.rateID, pinnedRateID)
	}
	if row.costDecimal == nil || *row.costDecimal != "9.9900" {
		t.Fatalf("cost_decimal = %v, want protected historical cost 9.9900", row.costDecimal)
	}
}

func TestBackfillChargingPlace_UsesCurrentRateAsLegacyEstimate(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(
		t,
		db,
		pricingLatLegacyCurrent,
		pricingLonLegacyCurrent,
		"Legacy Current-Rate Place",
	)
	now := time.Now().UTC().Truncate(time.Second)
	currentRateID := seedPricingRate(t, db, geofenceID, 0.00012, "USD", now.Add(-24*time.Hour), time.Time{})
	startedAt := time.Date(2020, 4, 1, 0, 0, 0, 0, time.UTC)
	sessionID := seedCompletedLegacyPricingSession(
		t,
		db,
		810007,
		startedAt,
		pricingLatLegacyCurrent,
		pricingLonLegacyCurrent,
		"Old Garage Label",
		10000,
	)

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	outcome, err := tracker.backfillChargingPlace(context.Background(), &systemmodel.ChargingPlaceBackfillCandidate{
		SessionID:  sessionID,
		VehicleID:  810007,
		StartedAt:  startedAt,
		StartLat:   pricingLatLegacyCurrent,
		StartLng:   pricingLonLegacyCurrent,
		StartPlace: strPtr("Old Garage Label"),
	}, now)
	if err != nil {
		t.Fatalf("backfillChargingPlace: %v", err)
	}
	if outcome != "current_estimate" {
		t.Fatalf("outcome=%q, want current_estimate", outcome)
	}

	row := readPricingSession(t, db, sessionID)
	if row.geofenceID == nil || *row.geofenceID != geofenceID {
		t.Fatalf("geofence_id=%v, want %d", row.geofenceID, geofenceID)
	}
	if row.rateID == nil || *row.rateID != currentRateID {
		t.Fatalf("rate_id=%v, want today's rate %d", row.rateID, currentRateID)
	}
	if row.costSource == nil || *row.costSource != systemmodel.CostSourceDefaultEstimate {
		t.Fatalf("cost_source=%v, want default_estimate", row.costSource)
	}
	if row.costDecimal == nil || *row.costDecimal != "1.2000" {
		t.Fatalf("cost_decimal=%v, want 1.2000", row.costDecimal)
	}
}

func TestBackfillChargingPlace_HistoricalRateWinsOverCurrentEstimate(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(
		t,
		db,
		pricingLatLegacyHistory,
		pricingLonLegacyHistory,
		"Legacy Historical-Rate Place",
	)
	cutover := time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC)
	historicalRateID := seedPricingRate(
		t,
		db,
		geofenceID,
		0.00010,
		"USD",
		time.Date(2019, 1, 1, 0, 0, 0, 0, time.UTC),
		cutover,
	)
	_ = seedPricingRate(t, db, geofenceID, 0.00020, "USD", cutover, time.Time{})
	startedAt := time.Date(2020, 4, 1, 0, 0, 0, 0, time.UTC)
	sessionID := seedCompletedLegacyPricingSession(
		t,
		db,
		810008,
		startedAt,
		pricingLatLegacyHistory,
		pricingLonLegacyHistory,
		"Historical Garage",
		10000,
	)

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	outcome, err := tracker.backfillChargingPlace(context.Background(), &systemmodel.ChargingPlaceBackfillCandidate{
		SessionID:  sessionID,
		VehicleID:  810008,
		StartedAt:  startedAt,
		StartLat:   pricingLatLegacyHistory,
		StartLng:   pricingLonLegacyHistory,
		StartPlace: strPtr("Historical Garage"),
	}, time.Now().UTC())
	if err != nil {
		t.Fatalf("backfillChargingPlace: %v", err)
	}
	if outcome != "historical_rate" {
		t.Fatalf("outcome=%q, want historical_rate", outcome)
	}

	row := readPricingSession(t, db, sessionID)
	if row.rateID == nil || *row.rateID != historicalRateID {
		t.Fatalf("rate_id=%v, want historical rate %d", row.rateID, historicalRateID)
	}
	if row.costSource == nil || *row.costSource != systemmodel.CostSourceGeofenceTariff {
		t.Fatalf("cost_source=%v, want geofence_tariff", row.costSource)
	}
	if row.costDecimal == nil || *row.costDecimal != "1.0000" {
		t.Fatalf("cost_decimal=%v, want 1.0000", row.costDecimal)
	}
}

func TestBackfillChargingPlace_PreservesActualCostWhileAttachingPlace(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(
		t,
		db,
		pricingLatLegacyActual,
		pricingLonLegacyActual,
		"Legacy Actual-Cost Place",
	)
	now := time.Now().UTC().Truncate(time.Second)
	_ = seedPricingRate(t, db, geofenceID, 0.00012, "USD", now.Add(-24*time.Hour), time.Time{})
	startedAt := time.Date(2020, 4, 1, 0, 0, 0, 0, time.UTC)
	sessionID := seedCompletedLegacyPricingSession(
		t,
		db,
		810009,
		startedAt,
		pricingLatLegacyActual,
		pricingLonLegacyActual,
		"Actual Cost Garage",
		10000,
	)
	if _, err := db.Pool.Exec(context.Background(), `
UPDATE charging_sessions
SET cost_decimal = 7.25,
    cost_currency = 'USD',
    cost_source = 'manual'
WHERE id = $1`, sessionID); err != nil {
		t.Fatalf("seed manual cost: %v", err)
	}

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	outcome, err := tracker.backfillChargingPlace(context.Background(), &systemmodel.ChargingPlaceBackfillCandidate{
		SessionID:  sessionID,
		VehicleID:  810009,
		StartedAt:  startedAt,
		StartLat:   pricingLatLegacyActual,
		StartLng:   pricingLonLegacyActual,
		StartPlace: strPtr("Actual Cost Garage"),
	}, now)
	if err != nil {
		t.Fatalf("backfillChargingPlace: %v", err)
	}
	if outcome != "skipped" {
		t.Fatalf("outcome=%q, want skipped", outcome)
	}

	row := readPricingSession(t, db, sessionID)
	if row.geofenceID == nil || *row.geofenceID != geofenceID {
		t.Fatalf("geofence_id=%v, want %d", row.geofenceID, geofenceID)
	}
	if row.rateID != nil {
		t.Fatalf("rate_id=%v, want nil for protected actual cost", row.rateID)
	}
	if row.costSource == nil || *row.costSource != systemmodel.CostSourceManual {
		t.Fatalf("cost_source=%v, want manual", row.costSource)
	}
	if row.costDecimal == nil || *row.costDecimal != "7.2500" {
		t.Fatalf("cost_decimal=%v, want protected 7.2500", row.costDecimal)
	}
}

// TestApplyGeofencePricingAsync_NoRateConfigured_LeavesSessionUnpriced
// proves a matched geofence with no rate at all leaves the session's cost
// fields untouched (implicitly "unknown", not an error) and is observable
// via the no_rate metrics outcome — the Charging Places UI's "needs rate
// setup" signal depends on this being silent, not a thrown error.
func TestApplyGeofencePricingAsync_NoRateConfigured_LeavesSessionUnpriced(t *testing.T) {
	db := openGeofencePricingDB(t)
	geofenceID := seedPricingGeofence(t, db, pricingLatNoRate, pricingLonNoRate, "No Rate Fixture Place")
	sessionID := seedPricingSession(t, db, 810003, time.Now().UTC(), floatPtr(5000))

	before := counterValue(metrics.GeofenceRateApplyTotal.WithLabelValues("no_rate"))

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	tracker.applyGeofencePricingAsync(sessionID, 810003, pricingLatNoRate, pricingLonNoRate, time.Now().UTC(), map[string]interface{}{})

	after := counterValue(metrics.GeofenceRateApplyTotal.WithLabelValues("no_rate"))
	if after != before+1 {
		t.Fatalf("GeofenceRateApplyTotal{no_rate} = %v -> %v, want +1", before, after)
	}

	row := readPricingSession(t, db, sessionID)
	if row.costSource != nil {
		t.Fatalf("cost_source = %v, want nil/unset (no rate configured)", row.costSource)
	}
	if row.geofenceID == nil || *row.geofenceID != geofenceID {
		t.Fatalf("geofence_id = %v, want %d (geofence still attaches even without a rate)", row.geofenceID, geofenceID)
	}
}

// TestApplyGeofencePricingAsync_DiscoversNewGeofenceWhenNoneMatches proves
// the tracker's full match-or-discover pipeline: with no existing geofence
// at these coordinates, a provisional charging-place geofence is created
// (origin=charging_discovery, needs_review=true) and attached to the
// session, exercising the "auto-create" half of "match vs auto-create".
func TestApplyGeofencePricingAsync_DiscoversNewGeofenceWhenNoneMatches(t *testing.T) {
	db := openGeofencePricingDB(t)
	sessionID := seedPricingSession(t, db, 810004, time.Now().UTC(), floatPtr(5000))

	before := countGeofences(t, db)
	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	tracker.applyGeofencePricingAsync(sessionID, 810004, pricingLatDiscover, pricingLonDiscover, time.Now().UTC(), map[string]interface{}{})
	after := countGeofences(t, db)
	if after != before+1 {
		t.Fatalf("geofence count = %d -> %d, want +1 (exactly one provisional place created)", before, after)
	}

	row := readPricingSession(t, db, sessionID)
	if row.geofenceID == nil {
		t.Fatalf("geofence_id = nil, want the newly-discovered geofence attached")
	}
	t.Cleanup(func() {
		_, _ = db.Pool.Exec(context.Background(), `DELETE FROM geofences WHERE id = $1`, *row.geofenceID)
	})

	var origin string
	var needsReview bool
	if err := db.Pool.QueryRow(context.Background(),
		`SELECT origin, needs_review FROM geofences WHERE id = $1`, *row.geofenceID).Scan(&origin, &needsReview); err != nil {
		t.Fatalf("read discovered geofence: %v", err)
	}
	if origin != "charging_discovery" {
		t.Fatalf("origin = %q, want charging_discovery", origin)
	}
	if !needsReview {
		t.Fatalf("needs_review = false, want true for an auto-discovered place")
	}
}

// TestApplyGeofencePricingAsync_ZeroCoordinates_NeverCreatesGeofence proves
// the "no position behavior" requirement at the tracker layer: (0,0) (the
// null-island sentinel for "no GPS fix yet") must never create a geofence,
// and the resulting discovery failure must not prevent the session's other
// enhanced fields from being persisted or otherwise fail the caller.
func TestApplyGeofencePricingAsync_ZeroCoordinates_NeverCreatesGeofence(t *testing.T) {
	db := openGeofencePricingDB(t)
	sessionID := seedPricingSession(t, db, 810005, time.Now().UTC(), floatPtr(5000))

	beforeGeofences := countGeofences(t, db)
	beforeErrors := counterValue(metrics.GeofenceDiscoveryTotal.WithLabelValues("error"))

	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{}, nil)
	tracker.applyGeofencePricingAsync(sessionID, 810005, 0, 0, time.Now().UTC(), map[string]interface{}{"charger_type": "AC"})

	afterGeofences := countGeofences(t, db)
	if afterGeofences != beforeGeofences {
		t.Fatalf("geofence count = %d -> %d, want unchanged for (0,0) coordinates", beforeGeofences, afterGeofences)
	}
	afterErrors := counterValue(metrics.GeofenceDiscoveryTotal.WithLabelValues("error"))
	if afterErrors != beforeErrors+1 {
		t.Fatalf("GeofenceDiscoveryTotal{error} = %v -> %v, want +1", beforeErrors, afterErrors)
	}

	row := readPricingSession(t, db, sessionID)
	if row.geofenceID != nil {
		t.Fatalf("geofence_id = %v, want nil (discovery must fail closed for (0,0))", row.geofenceID)
	}
	// The other enhanced fields passed in by the caller must still make it
	// to the row even though geofence resolution failed — this is the
	// "discovery failure does not fail charge completion" contract: the
	// function falls back to persisting fields as-is instead of losing them.
	var chargerType *string
	if err := db.Pool.QueryRow(context.Background(), `SELECT charger_type FROM charging_sessions WHERE id = $1`, sessionID).Scan(&chargerType); err != nil {
		t.Fatalf("read charger_type: %v", err)
	}
	if chargerType == nil || *chargerType != "AC" {
		t.Fatalf("charger_type = %v, want AC (fields must still be persisted after a discovery failure)", chargerType)
	}
}

// TestApplyGeofencePricingAsync_BrokenDatabaseNeverPanics is the strongest
// form of "discovery/pricing failure does not fail charge completion": with
// every underlying database call failing (a closed connection pool), the
// function must still return normally — no panic, no propagated error (it
// has no return value to propagate one through), and no indefinite block.
// Needs no reachable database at all — pgxpool.New connects lazily, so a
// pool pointed at a deliberately-unused local port opens successfully and
// then fails fast on first use, letting this test run in any environment
// without DATABASE_URL/TESLASYNC_TEST_DSN configured.
func TestApplyGeofencePricingAsync_BrokenDatabaseNeverPanics(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://nope:nope@127.0.0.1:1/nonexistent?connect_timeout=1")
	if err != nil {
		t.Fatalf("pgxpool.New (lazy connect) unexpectedly failed: %v", err)
	}
	defer pool.Close()

	db := &database.DB{Pool: pool}
	tracker := NewTelemetrySessionTracker(db, nil, &stubGeocoder{err: context.DeadlineExceeded}, nil)

	beforeErrors := counterValue(metrics.GeofenceDiscoveryTotal.WithLabelValues("error"))

	panicked := callAndRecover(func() {
		tracker.applyGeofencePricingAsync(999999001, 999999001, 37.7749, -122.4194, time.Now().UTC(), map[string]interface{}{"charger_type": "DC"})
	})
	if panicked != nil {
		t.Fatalf("applyGeofencePricingAsync panicked with every DB call failing: %v", panicked)
	}

	afterErrors := counterValue(metrics.GeofenceDiscoveryTotal.WithLabelValues("error"))
	if afterErrors != beforeErrors+1 {
		t.Fatalf("GeofenceDiscoveryTotal{error} = %v -> %v, want +1 (failure must still be observable)", beforeErrors, afterErrors)
	}
}

// callAndRecover runs fn and returns the recovered panic value, or nil if fn
// returned normally. Used to make "this call must not panic" an explicit,
// readable assertion instead of relying on the test runner's own implicit
// panic-equals-failure behavior.
func callAndRecover(fn func()) (recovered interface{}) {
	defer func() {
		recovered = recover()
	}()
	fn()
	return nil
}

// TestSafeGo_RecoversPanicAndReturnsImmediately pins the panic-recovery
// wrapper installed around the real call site (completeChargeLocked's
// `safeGo("charge_geofence_pricing", func() { t.applyGeofencePricingAsync(...) })`
// in telemetry_sessions_charge_tracking.go): a panicking background
// goroutine must never crash the process, and the caller (standing in for
// completeChargeLocked, which must finish and release its lock regardless
// of what the fire-and-forget pricing leg does) must not block waiting for
// it.
func TestSafeGo_RecoversPanicAndReturnsImmediately(t *testing.T) {
	const label = "test_charge_geofence_pricing_panic"
	before := counterValue(metrics.PanicsRecovered.WithLabelValues(label))

	done := make(chan struct{})
	start := time.Now()
	safeGo(label, func() {
		defer close(done)
		panic("boom: simulated geofence pricing panic")
	})
	elapsed := time.Since(start)
	if elapsed > time.Second {
		t.Fatalf("safeGo blocked its caller for %v — it must return immediately", elapsed)
	}

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("panicking goroutine never completed its deferred cleanup — recover() did not run")
	}

	// Poll briefly: close(done) unwinds as part of fn's own deferred calls,
	// which run BEFORE the panic propagates up to safeGo's recover() (and
	// thus before the metrics increment) — so done closing only proves fn's
	// frame unwound, not that the outer recover has run yet.
	deadline := time.Now().Add(2 * time.Second)
	for {
		after := counterValue(metrics.PanicsRecovered.WithLabelValues(label))
		if after == before+1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("PanicsRecovered{%s} = %v -> %v, want +1", label, before, after)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
