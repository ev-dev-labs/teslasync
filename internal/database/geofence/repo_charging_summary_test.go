package geofence

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// ChargingSummaryByCurrency — multiple currencies must never be summed into
// one total: a place seen in both USD and EUR returns two independent rows.
// ---------------------------------------------------------------------------

func TestChargingSummaryByCurrency(t *testing.T) {
	t.Run("groups by currency, never sums across currencies", func(t *testing.T) {
		rows := newFakeRows([][]any{
			{"USD", int64(10), 50_000.0, 12.5},
			{"EUR", int64(3), 9_000.0, 3.75},
		})
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}

		got, err := newRepo(pool).ChargingSummaryByCurrency(context.Background(), 1)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("want 2 currency groups, got %d: %+v", len(got), got)
		}
		if got[0].Currency != "USD" || got[0].SessionCount != 10 || got[0].TotalEnergyWh != 50_000.0 || got[0].TotalCostDecimal != 12.5 {
			t.Errorf("USD row mismatch: %+v", got[0])
		}
		if got[1].Currency != "EUR" || got[1].SessionCount != 3 {
			t.Errorf("EUR row mismatch: %+v", got[1])
		}
		// Every row must carry the geofence id the caller asked about.
		for _, s := range got {
			if s.GeofenceID != 1 {
				t.Errorf("GeofenceID not stamped: %+v", s)
			}
		}
		call := pool.queryCalls[0]
		for _, sub := range []string{"cost_decimal IS NOT NULL", "cost_currency IS NOT NULL", "GROUP BY cost_currency"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).ChargingSummaryByCurrency(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})

	t.Run("scan error wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{{"USD", int64(1), 1.0, 1.0}})
		rows.scanErrAt = 0
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).ChargingSummaryByCurrency(context.Background(), 1)
		if err == nil || !strings.Contains(err.Error(), "scan") {
			t.Fatalf("err=%v, want scan error", err)
		}
	})
}

// ---------------------------------------------------------------------------
// ChargingActivity — pagination clamping
// ---------------------------------------------------------------------------

func TestChargingActivity(t *testing.T) {
	t.Run("passes through valid limit/offset", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		_, err := newRepo(pool).ChargingActivity(context.Background(), 1, 25, 10)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := pool.queryCalls[0]
		if call.args[1] != 25 || call.args[2] != 10 {
			t.Errorf("args: want [1 25 10], got %v", call.args)
		}
	})

	t.Run("non-positive limit clamps to default 50", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		_, _ = newRepo(pool).ChargingActivity(context.Background(), 1, 0, 0)
		if pool.queryCalls[0].args[1] != 50 {
			t.Errorf("limit not clamped to 50: %v", pool.queryCalls[0].args[1])
		}
	})

	t.Run("over-cap limit clamps to default 50", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		_, _ = newRepo(pool).ChargingActivity(context.Background(), 1, 500, 0)
		if pool.queryCalls[0].args[1] != 50 {
			t.Errorf("over-cap limit not clamped to 50: %v", pool.queryCalls[0].args[1])
		}
	})

	t.Run("negative offset floors at 0", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		_, _ = newRepo(pool).ChargingActivity(context.Background(), 1, 10, -5)
		if pool.queryCalls[0].args[2] != 0 {
			t.Errorf("negative offset not floored: %v", pool.queryCalls[0].args[2])
		}
	})

	t.Run("scans full activity row shape", func(t *testing.T) {
		ended := fixedTime.Add(time.Hour)
		energy := 12_000.0
		cost := 1.25
		currency := "USD"
		source := systemmodel.CostSourceGeofenceTariff
		rateID := int64(9)
		rows := newFakeRows([][]any{
			{int64(100), int64(1), fixedTime, &ended, &energy, &cost, &currency, &source, &rateID},
		})
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		got, err := newRepo(pool).ChargingActivity(context.Background(), 1, 10, 0)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 1 || got[0].SessionID != 100 || got[0].CostSource == nil || *got[0].CostSource != systemmodel.CostSourceGeofenceTariff {
			t.Fatalf("unexpected activity row: %+v", got)
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).ChargingActivity(context.Background(), 1, 10, 0)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// resolveApplyWindow
// ---------------------------------------------------------------------------

func TestResolveApplyWindow(t *testing.T) {
	rateFrom := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rateTo := time.Date(2026, 12, 31, 0, 0, 0, 0, time.UTC)

	t.Run("no scope bounds uses the rate's own interval", func(t *testing.T) {
		rate := &systemmodel.GeofenceRate{EffectiveFrom: rateFrom, EffectiveTo: &rateTo}
		from, to := resolveApplyWindow(systemmodel.GeofenceRateApplyScope{}, rate)
		if !from.Equal(rateFrom) || to == nil || !to.Equal(rateTo) {
			t.Fatalf("from=%v to=%v, want rate's own interval", from, to)
		}
	})

	t.Run("scope.From earlier than rate.EffectiveFrom is ignored (later lower bound wins)", func(t *testing.T) {
		earlier := rateFrom.Add(-24 * time.Hour)
		rate := &systemmodel.GeofenceRate{EffectiveFrom: rateFrom}
		from, _ := resolveApplyWindow(systemmodel.GeofenceRateApplyScope{From: &earlier}, rate)
		if !from.Equal(rateFrom) {
			t.Fatalf("from=%v, want rate.EffectiveFrom (later bound) to win", from)
		}
	})

	t.Run("scope.From later than rate.EffectiveFrom narrows the window", func(t *testing.T) {
		later := rateFrom.Add(24 * time.Hour)
		rate := &systemmodel.GeofenceRate{EffectiveFrom: rateFrom}
		from, _ := resolveApplyWindow(systemmodel.GeofenceRateApplyScope{From: &later}, rate)
		if !from.Equal(later) {
			t.Fatalf("from=%v, want scope.From (narrower) to win", from)
		}
	})

	t.Run("open rate + scope.To narrows to scope.To", func(t *testing.T) {
		rate := &systemmodel.GeofenceRate{EffectiveFrom: rateFrom} // EffectiveTo nil (open)
		bound := rateFrom.Add(48 * time.Hour)
		_, to := resolveApplyWindow(systemmodel.GeofenceRateApplyScope{To: &bound}, rate)
		if to == nil || !to.Equal(bound) {
			t.Fatalf("to=%v, want scope.To since the rate itself is open", to)
		}
	})

	t.Run("scope.To earlier than rate.EffectiveTo narrows the window", func(t *testing.T) {
		earlier := rateTo.Add(-24 * time.Hour)
		rate := &systemmodel.GeofenceRate{EffectiveFrom: rateFrom, EffectiveTo: &rateTo}
		_, to := resolveApplyWindow(systemmodel.GeofenceRateApplyScope{To: &earlier}, rate)
		if to == nil || !to.Equal(earlier) {
			t.Fatalf("to=%v, want the earlier scope.To to win", to)
		}
	})

	t.Run("scope.To later than rate.EffectiveTo is ignored (earlier upper bound wins)", func(t *testing.T) {
		later := rateTo.Add(24 * time.Hour)
		rate := &systemmodel.GeofenceRate{EffectiveFrom: rateFrom, EffectiveTo: &rateTo}
		_, to := resolveApplyWindow(systemmodel.GeofenceRateApplyScope{To: &later}, rate)
		if to == nil || !to.Equal(rateTo) {
			t.Fatalf("to=%v, want rate.EffectiveTo (earlier bound) to win", to)
		}
	})
}

// ---------------------------------------------------------------------------
// classifyRepriceCandidates — the core matched/eligible/protected split that
// guarantees a manual or Tesla-actual cost is NEVER touched by repricing,
// and an out-of-scope session is never even considered.
// ---------------------------------------------------------------------------

func testGeofenceAt(id int64, lat, lon float64) *systemmodel.Geofence {
	return &systemmodel.Geofence{ID: id, Name: "Test Place", PolygonWKT: squareWKT(lat, lon)}
}

func f64ptr(v float64) *float64 { return &v }
func strptr(v string) *string   { return &v }
func TestClassifyRepriceCandidates(t *testing.T) {
	g := testGeofenceAt(1, 37.7749, -122.4194)
	cLat, cLon := g.Centroid()

	candidates := []repriceCandidate{
		// 1: already attributed to this geofence, no cost yet, has energy -> eligible.
		{id: 1, geofenceID: int64Ptr(1), energyWh: f64ptr(5000)},
		// 2: unattributed but spatially inside -> matched + eligible (default_estimate).
		{id: 2, startLat: f64ptr(cLat), startLng: f64ptr(cLon), energyWh: f64ptr(3000), costSource: strptr(systemmodel.CostSourceDefaultEstimate)},
		// 3: unattributed and spatially far away (~1 degree ~111km) -> never matched.
		{id: 3, startLat: f64ptr(cLat + 1), startLng: f64ptr(cLon), energyWh: f64ptr(1000)},
		// 4: attributed to this geofence but manual cost -> matched + protected, never eligible.
		{id: 4, geofenceID: int64Ptr(1), energyWh: f64ptr(2000), costSource: strptr(systemmodel.CostSourceManual)},
		// 5: attributed to this geofence but tesla_actual cost -> matched + protected.
		{id: 5, geofenceID: int64Ptr(1), energyWh: f64ptr(2000), costSource: strptr(systemmodel.CostSourceTeslaActual)},
		// 6: attributed to this geofence, eligible cost_source, but NO energy yet
		//    (still charging / incomplete) -> matched, but neither eligible nor protected.
		{id: 6, geofenceID: int64Ptr(1), costSource: strptr(systemmodel.CostSourceUnknown)},
		// 7: attributed to a DIFFERENT geofence -> never matched, even though it's "in the list".
		{id: 7, geofenceID: int64Ptr(2), energyWh: f64ptr(4000)},
		// 8: unattributed, no lat/lng at all -> never matched (can't spatially resolve).
		{id: 8, energyWh: f64ptr(1000)},
		// 9: already attributed to this geofence, previously geofence_tariff-priced -> eligible (repriced again).
		{id: 9, geofenceID: int64Ptr(1), energyWh: f64ptr(6000), costSource: strptr(systemmodel.CostSourceGeofenceTariff)},
		// 10: pre-feature row with a real cost but no provenance -> protected.
		{id: 10, geofenceID: int64Ptr(1), energyWh: f64ptr(6000), costDecimal: f64ptr(7.25)},
		// 11: legacy unattributed row without coordinates but with an exact saved place name -> eligible.
		{id: 11, startPlace: strptr("  test PLACE  "), energyWh: f64ptr(2500)},
		// 12: a different legacy place name must not match.
		{id: 12, startPlace: strptr("Different Place"), energyWh: f64ptr(2500)},
		// 13: placeholder (0,0) coordinates are unusable, so the exact-name fallback applies.
		{id: 13, startLat: f64ptr(0), startLng: f64ptr(0), startPlace: strptr("Test Place"), energyWh: f64ptr(1500)},
	}

	matched, eligible, protected := classifyRepriceCandidates(candidates, g)

	assertIDs := func(t *testing.T, label string, got []repriceCandidate, want []int64) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("%s: got %d ids, want %d (got=%v want=%v)", label, len(got), len(want), idsOf(got), want)
		}
		for i, c := range got {
			if c.id != want[i] {
				t.Fatalf("%s[%d]=%d, want %d (full got=%v)", label, i, c.id, want[i], idsOf(got))
			}
		}
	}

	assertIDs(t, "matched", matched, []int64{1, 2, 4, 5, 6, 9, 10, 11, 13})
	assertIDs(t, "eligible", eligible, []int64{1, 2, 9, 11, 13})
	assertIDs(t, "protected", protected, []int64{4, 5, 10})

	// The remainder (matched - eligible - protected) must be exactly {6}:
	// in-scope by place, but not yet priceable because energy is unknown.
	remainder := len(matched) - len(eligible) - len(protected)
	if remainder != 1 {
		t.Fatalf("remainder = %d, want 1 (session #6, matched but not priceable yet)", remainder)
	}
}

func idsOf(cs []repriceCandidate) []int64 {
	ids := make([]int64, len(cs))
	for i, c := range cs {
		ids[i] = c.id
	}
	return ids
}

func int64Ptr(v int64) *int64 { return &v }

// ---------------------------------------------------------------------------
// loadRepriceCandidates — query shape
// ---------------------------------------------------------------------------

func TestLoadRepriceCandidates(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	t.Run("open window omits the upper bound clause", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		_, err := newRepo(pool).loadRepriceCandidates(context.Background(), 1, from, nil)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := pool.queryCalls[0]
		if strings.Contains(call.sql, "started_at < $3") {
			t.Errorf("open window must not bind an upper bound: %s", call.sql)
		}
		if len(call.args) != 2 {
			t.Fatalf("want 2 args for an open window, got %v", call.args)
		}
	})

	t.Run("closed window adds the upper bound clause", func(t *testing.T) {
		to := from.Add(30 * 24 * time.Hour)
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		_, err := newRepo(pool).loadRepriceCandidates(context.Background(), 1, from, &to)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := pool.queryCalls[0]
		if !strings.Contains(call.sql, "started_at < $3") {
			t.Errorf("closed window must bind an upper bound: %s", call.sql)
		}
		if len(call.args) != 3 || call.args[2] != to {
			t.Fatalf("args mismatch: %v", call.args)
		}
	})

	t.Run("matches unattributed OR this geofence", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows(nil)}}}
		_, _ = newRepo(pool).loadRepriceCandidates(context.Background(), 1, from, nil)
		if !strings.Contains(pool.queryCalls[0].sql, "geofence_id = $1 OR geofence_id IS NULL") {
			t.Errorf("unexpected SQL: %s", pool.queryCalls[0].sql)
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).loadRepriceCandidates(context.Background(), 1, from, nil)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})

	t.Run("scan error wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{{int64(1), (*int64)(nil), (*float64)(nil), (*float64)(nil), (*string)(nil), (*float64)(nil), (*float64)(nil), (*string)(nil)}})
		rows.scanErrAt = 0
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).loadRepriceCandidates(context.Background(), 1, from, nil)
		if err == nil || !strings.Contains(err.Error(), "scan") {
			t.Fatalf("err=%v, want scan error", err)
		}
	})
}

// ---------------------------------------------------------------------------
// candidateIDs
// ---------------------------------------------------------------------------

func TestCandidateIDs(t *testing.T) {
	got := candidateIDs([]repriceCandidate{{id: 3}, {id: 1}, {id: 2}})
	want := []int64{3, 1, 2}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// ---------------------------------------------------------------------------
// loadGeofenceAndRate
// ---------------------------------------------------------------------------

func TestLoadGeofenceAndRate(t *testing.T) {
	g := &systemmodel.Geofence{ID: 1, Name: "Home", PolygonWKT: squareWKT(1, 1), CreatedAt: fixedTime, UpdatedAt: fixedTime}
	rt := &systemmodel.GeofenceRate{ID: 9, GeofenceID: 1, RatePerWh: 0.0001, Currency: "USD", EffectiveFrom: fixedTime, CreatedAt: fixedTime}

	t.Run("success", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, fakeRow{vals: geofenceRateRowVals(rt)}}}
		gotG, gotR, err := newRepo(pool).loadGeofenceAndRate(context.Background(), 1, 9)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if gotG.ID != 1 || gotR.ID != 9 {
			t.Fatalf("got g=%+v r=%+v", gotG, gotR)
		}
	})

	t.Run("missing geofence", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{noRow()}}
		_, _, err := newRepo(pool).loadGeofenceAndRate(context.Background(), 999, 9)
		if !errors.Is(err, ErrGeofenceNotFound) {
			t.Fatalf("err=%v, want ErrGeofenceNotFound", err)
		}
	})

	t.Run("missing rate", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, noRow()}}
		_, _, err := newRepo(pool).loadGeofenceAndRate(context.Background(), 1, 999)
		if !errors.Is(err, ErrRateNotFound) {
			t.Fatalf("err=%v, want ErrRateNotFound", err)
		}
	})
}

// ---------------------------------------------------------------------------
// PreviewApplyRate / ApplyRate — end-to-end through the fake pool.
// ---------------------------------------------------------------------------

// scenarioCandidatesRows builds the loadRepriceCandidates row shape for one
// eligible, in-scope session (id=10, unattributed-but-inside, no prior cost)
// plus one protected session (id=11, manual cost) so Preview/Apply must
// report MatchedSessions=2, EligibleSessions/PricedSessions=1,
// ProtectedSessions=1/SkippedSessions=1.
func scenarioCandidatesRows(g *systemmodel.Geofence) [][]any {
	cLat, cLon := g.Centroid()
	manual := systemmodel.CostSourceManual
	return [][]any{
		{int64(10), (*int64)(nil), &cLat, &cLon, (*string)(nil), f64ptr(10_000), (*float64)(nil), (*string)(nil)},
		{int64(11), int64Ptr(g.ID), (*float64)(nil), (*float64)(nil), (*string)(nil), f64ptr(5_000), f64ptr(4.25), &manual},
	}
}

func TestPreviewApplyRate(t *testing.T) {
	g := &systemmodel.Geofence{ID: 1, Name: "Home", PolygonWKT: squareWKT(37.7749, -122.4194), CreatedAt: fixedTime, UpdatedAt: fixedTime}
	rt := &systemmodel.GeofenceRate{ID: 9, GeofenceID: 1, RatePerWh: 0.0001005, Currency: "USD", EffectiveFrom: fixedTime, CreatedAt: fixedTime}

	t.Run("aggregates only the eligible subset", func(t *testing.T) {
		pool := &fakePool{
			queryRowQueue: []pgx.Row{
				fakeRow{vals: geofenceRowVals(g)},      // loadGeofenceAndRate: GetByID
				fakeRow{vals: geofenceRateRowVals(rt)}, // loadGeofenceAndRate: GetRateByID
				fakeRow{vals: []any{10_000.0, 1.005}},  // aggregate SUM
			},
			queryQueue: []queryResult{{rows: newFakeRows(scenarioCandidatesRows(g))}},
		}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 1, RateID: 9}
		preview, err := newRepo(pool).PreviewApplyRate(context.Background(), scope)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if preview.MatchedSessions != 2 {
			t.Errorf("MatchedSessions=%d, want 2", preview.MatchedSessions)
		}
		if preview.EligibleSessions != 1 {
			t.Errorf("EligibleSessions=%d, want 1", preview.EligibleSessions)
		}
		if preview.ProtectedSessions != 1 {
			t.Errorf("ProtectedSessions=%d, want 1", preview.ProtectedSessions)
		}
		if preview.Currency != "USD" {
			t.Errorf("Currency=%q, want USD", preview.Currency)
		}
		if preview.TotalEnergyWh != 10_000.0 || preview.EstimatedCostDecimal != 1.005 {
			t.Errorf("aggregate mismatch: %+v", preview)
		}
		// The aggregate query must scope to exactly the eligible ids (10),
		// never the protected one (11).
		aggCall := pool.queryRowCalls[2]
		ids, ok := aggCall.args[0].([]int64)
		if !ok || len(ids) != 1 || ids[0] != 10 {
			t.Errorf("aggregate ids: want [10], got %v", aggCall.args[0])
		}
	})

	t.Run("zero eligible sessions skips the aggregate round trip", func(t *testing.T) {
		manual := systemmodel.CostSourceManual
		onlyProtected := [][]any{{int64(11), int64Ptr(g.ID), (*float64)(nil), (*float64)(nil), (*string)(nil), f64ptr(5_000), f64ptr(4.25), &manual}}
		pool := &fakePool{
			queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, fakeRow{vals: geofenceRateRowVals(rt)}},
			queryQueue:    []queryResult{{rows: newFakeRows(onlyProtected)}},
		}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 1, RateID: 9}
		preview, err := newRepo(pool).PreviewApplyRate(context.Background(), scope)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if preview.EligibleSessions != 0 || preview.EstimatedCostDecimal != 0 {
			t.Fatalf("want zero eligible/cost, got %+v", preview)
		}
		if len(pool.queryRowCalls) != 2 {
			t.Fatalf("must skip the aggregate QueryRow when nothing is eligible, got %d calls", len(pool.queryRowCalls))
		}
	})

	t.Run("missing geofence propagates ErrGeofenceNotFound", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{noRow()}}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 999, RateID: 9}
		_, err := newRepo(pool).PreviewApplyRate(context.Background(), scope)
		if !errors.Is(err, ErrGeofenceNotFound) {
			t.Fatalf("err=%v, want ErrGeofenceNotFound", err)
		}
	})
}

func TestApplyRate(t *testing.T) {
	g := &systemmodel.Geofence{ID: 1, Name: "Home", PolygonWKT: squareWKT(37.7749, -122.4194), CreatedAt: fixedTime, UpdatedAt: fixedTime}
	rt := &systemmodel.GeofenceRate{ID: 9, GeofenceID: 1, RatePerWh: 0.0001005, Currency: "USD", EffectiveFrom: fixedTime, CreatedAt: fixedTime}

	t.Run("prices only the eligible subset, never the protected one", func(t *testing.T) {
		updateRows := newFakeRows([][]any{{10_000.0, 1.005}}) // one UPDATE...RETURNING row (session 10 only)
		pool := &fakePool{
			queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, fakeRow{vals: geofenceRateRowVals(rt)}},
			queryQueue: []queryResult{
				{rows: newFakeRows(scenarioCandidatesRows(g))}, // loadRepriceCandidates
				{rows: updateRows}, // UPDATE ... RETURNING
			},
		}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 1, RateID: 9}
		result, err := newRepo(pool).ApplyRate(context.Background(), scope)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if result.MatchedSessions != 2 {
			t.Errorf("MatchedSessions=%d, want 2", result.MatchedSessions)
		}
		if result.PricedSessions != 1 {
			t.Errorf("PricedSessions=%d, want 1", result.PricedSessions)
		}
		if result.SkippedSessions != 1 {
			t.Errorf("SkippedSessions=%d, want 1 (the protected manual-cost session)", result.SkippedSessions)
		}
		if result.TotalEnergyWh != 10_000.0 || result.TotalCostDecimal != 1.005 {
			t.Errorf("totals mismatch: %+v", result)
		}
		updateCall := pool.queryCalls[1]
		for _, sub := range []string{
			"UPDATE charging_sessions",
			"cost_source = CASE WHEN scoped.should_price THEN 'geofence_tariff' ELSE cs.cost_source END",
			"cost_source IS NULL AND cost_decimal IS NULL",
		} {
			if !strings.Contains(updateCall.sql, sub) {
				t.Errorf("UPDATE SQL missing %q:\n%s", sub, updateCall.sql)
			}
		}
		matchedIDs, ok := updateCall.args[0].([]int64)
		if !ok || len(matchedIDs) != 2 || matchedIDs[0] != 10 || matchedIDs[1] != 11 {
			t.Errorf("matched UPDATE ids: want [10 11], got %v", updateCall.args[0])
		}
		eligibleIDs, ok := updateCall.args[2].([]int64)
		if !ok || len(eligibleIDs) != 1 || eligibleIDs[0] != 10 {
			t.Errorf("eligible UPDATE ids: want [10] (never reprice protected id 11), got %v", updateCall.args[2])
		}
	})

	t.Run("zero eligible sessions skips the UPDATE round trip", func(t *testing.T) {
		manual := systemmodel.CostSourceManual
		onlyProtected := [][]any{{int64(11), int64Ptr(g.ID), (*float64)(nil), (*float64)(nil), (*string)(nil), f64ptr(5_000), f64ptr(4.25), &manual}}
		pool := &fakePool{
			queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, fakeRow{vals: geofenceRateRowVals(rt)}},
			queryQueue:    []queryResult{{rows: newFakeRows(onlyProtected)}},
		}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 1, RateID: 9}
		result, err := newRepo(pool).ApplyRate(context.Background(), scope)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if result.PricedSessions != 0 || result.SkippedSessions != 1 {
			t.Fatalf("want 0 priced / 1 skipped, got %+v", result)
		}
		if len(pool.queryCalls) != 1 {
			t.Fatalf("must skip the UPDATE when nothing is eligible, got %d Query calls", len(pool.queryCalls))
		}
	})

	t.Run("attributes an unattributed protected session without repricing it", func(t *testing.T) {
		cLat, cLon := g.Centroid()
		manual := systemmodel.CostSourceManual
		unattributedProtected := [][]any{
			{int64(11), (*int64)(nil), &cLat, &cLon, (*string)(nil), f64ptr(5_000), f64ptr(4.25), &manual},
		}
		pool := &fakePool{
			queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, fakeRow{vals: geofenceRateRowVals(rt)}},
			queryQueue: []queryResult{
				{rows: newFakeRows(unattributedProtected)},
				{rows: newFakeRows(nil)},
			},
		}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 1, RateID: 9}
		result, err := newRepo(pool).ApplyRate(context.Background(), scope)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if result.PricedSessions != 0 || result.SkippedSessions != 1 {
			t.Fatalf("want protected cost skipped while place is attributed, got %+v", result)
		}
		if len(pool.queryCalls) != 2 {
			t.Fatalf("want candidate SELECT plus attribution UPDATE, got %d Query calls", len(pool.queryCalls))
		}
		updateCall := pool.queryCalls[1]
		if !strings.Contains(updateCall.sql, "SET geofence_id = $2") {
			t.Fatalf("UPDATE must attach the historical session to the place:\n%s", updateCall.sql)
		}
		eligibleIDs, ok := updateCall.args[2].([]int64)
		if !ok || len(eligibleIDs) != 0 {
			t.Fatalf("protected session must not be eligible for repricing, got %v", updateCall.args[2])
		}
	})

	t.Run("idempotent: re-running after all sessions already priced prices zero more", func(t *testing.T) {
		// Second run: the UPDATE's own WHERE guard (cost_source already
		// geofence_tariff is still eligible, so this models a scenario
		// where nothing further changes) returns zero rows because the
		// classifier decided there was nothing new to do — modeled here by
		// an eligible candidate set that yields an UPDATE returning zero
		// rows (e.g. concurrent apply already converged it to a manual
		// cost between classification and the UPDATE).
		alreadyDone := [][]any{{int64(10), int64Ptr(g.ID), (*float64)(nil), (*float64)(nil), (*string)(nil), f64ptr(10_000), f64ptr(1.005), strptr(systemmodel.CostSourceGeofenceTariff)}}
		pool := &fakePool{
			queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, fakeRow{vals: geofenceRateRowVals(rt)}},
			queryQueue: []queryResult{
				{rows: newFakeRows(alreadyDone)},
				{rows: newFakeRows(nil)}, // UPDATE matched 0 rows this time
			},
		}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 1, RateID: 9}
		result, err := newRepo(pool).ApplyRate(context.Background(), scope)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if result.PricedSessions != 0 {
			t.Fatalf("want 0 priced, got %d", result.PricedSessions)
		}
	})

	t.Run("missing rate propagates ErrRateNotFound", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRowVals(g)}, noRow()}}
		scope := systemmodel.GeofenceRateApplyScope{GeofenceID: 1, RateID: 999}
		_, err := newRepo(pool).ApplyRate(context.Background(), scope)
		if !errors.Is(err, ErrRateNotFound) {
			t.Fatalf("err=%v, want ErrRateNotFound", err)
		}
	})
}
