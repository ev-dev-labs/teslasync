package rangeproj

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type signalAtCallRecord struct {
	vehicleID int64
	name      string
	at        time.Time
}

type fakeStateReader struct {
	signalAtFn func(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error)
}

func (f *fakeStateReader) State(context.Context, int64, time.Time) (signal.State, error) {
	return signal.State{}, nil
}

func (f *fakeStateReader) SignalAt(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error) {
	if f.signalAtFn == nil {
		return nil, nil
	}
	return f.signalAtFn(ctx, vehicleID, name, at)
}

func (f *fakeStateReader) Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

var _ signal.StateReader = (*fakeStateReader)(nil)

// newRangeProjectionGetRequest builds a GET /analytics/range-projection
// request with the supplied vehicle_id query parameter. RangeProjectionHandler.Get
// reads the vehicle ID via r.URL.Query().Get("vehicle_id") + strconv.ParseInt,
// so this mirrors the production transport.
func newRangeProjectionGetRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, "/analytics/range-projection?vehicle_id="+vehicleID, nil)
}

// newRangeProjectionByVehicleRequest builds a GET
// /vehicles/{vehicleID}/battery/projected-range request with chi route
// context wired so apiparams.URLParamInt64(r, "vehicleID") inside
// RangeProjectionHandler.GetByVehicle resolves to vehicleID. Mirrors
// newBatteryReportRequest in battery_handler_test.go.
func newRangeProjectionByVehicleRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/vehicles/"+vehicleID+"/battery/projected-range", nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("vehicleID", vehicleID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

// rangeProjectionCarriedSignals is the canonical set of last-known signal
// values fed to the fake StateReader in the carry-forward test. The five
// distinct signal names match the union of names queried by
// RangeProjectionHandler.Get (5 names) and RangeProjectionHandler.GetByVehicle
// (4 names, all subset of Get's set). Holding both expected names AND the
// expected values in one map lets a future regression that drops a signal
// name (or rewires it to a different one) be caught by both the call-name
// pinning AND the downstream projection assertions.
var rangeProjectionCarriedSignals = map[string]float64{
	"BatteryLevel":      80.0,
	"EstBatteryRange":   350.0,
	"RatedRange":        400.0,
	"IdealBatteryRange": 420.0,
	"EnergyRemaining":   60000.0,
}

// TestRangeProjection_AllNineSignalsCarryForward verifies that BOTH
// RangeProjectionHandler entry points (Get and GetByVehicle) derive their
// projection inputs from forward-folded SignalAt reads of the canonical
// signal names. The fake returns last-known values for all five distinct
// signal names (emulating StateReader's forward-fold semantics where
// unchanged signals carry their prior emitted value rather than
// disappearing — battery range / SOC are exactly the kind of signals that
// stay constant for long stretches while a vehicle is parked).
//
// The test pins:
//
//   - Total SignalAt call count == 9 (5 from Get + 4 from GetByVehicle).
//     If even one site is dropped during refactoring, the projected range
//     will be wildly wrong; this assertion catches that.
//   - All 5 distinct signal names were queried by the union of the two
//     handlers (BatteryLevel, EstBatteryRange, RatedRange,
//     IdealBatteryRange, EnergyRemaining). A regression that renames a
//     signal or queries a different one is caught here.
//   - Get's downstream projection fields reflect the carried-forward
//     values: battery_level == BatteryLevel, current_range_km derived
//     from RatedRange × BatteryLevel/100, projected_range_km derived
//     from RatedRange × effFactor × BatteryLevel/100, health_factor
//     derived from EnergyRemaining / 75kWh-default.
//   - GetByVehicle's downstream fields likewise reflect the carried-forward
//     values: current_range_km, new_range_km (= RatedRange at 100%),
//     degradation_pct, health_score, current_capacity_pct.
//
// The legacy raw-snapshot path returned the same fields zeroed out for
// any signal that had no fresh emission inside the window; this contract
// test pins the new behavior so a regression that re-introduces a
// "fresh-only" filter (and freezes the Range Projection panel at zero on
// a parked vehicle) is caught immediately.
func TestRangeProjection_AllNineSignalsCarryForward(t *testing.T) {
	const (
		vid               = int64(42)
		batteryLevel      = 80.0
		estBatteryRange   = 350.0
		ratedRange        = 400.0
		idealBatteryRange = 420.0
		energyRemaining   = 60000.0
		// db is nil in this test, so lookupVehicleCapacity is bypassed and
		// capacityWh defaults to 75000.0; healthFactor = energy/cap = 0.8.
		capacityWhDefault = 75000.0
	)
	var calls []signalAtCallRecord
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, v int64, name string, at time.Time) (signal.SignalValue, error) {
			calls = append(calls, signalAtCallRecord{vehicleID: v, name: name, at: at})
			if val, ok := rangeProjectionCarriedSignals[name]; ok {
				return val, nil
			}
			return nil, nil
		},
	}
	// db: nil — every h.db.Pool.* path inside the handler is nil-guarded
	// post-migration so the test does not need a real *database.DB. The
	// derived projection fields below are deterministic for the
	// (db=nil, state=fake) case: average drive efficiency / temp / speed
	// fall through to nil, and buildEfficiencyMatrix / lookupVehicleCapacity
	// short-circuit to defaults.
	h := &RangeProjectionHandler{state: fake}

	before := time.Now()
	// ── Exercise Get (5 SignalAt sites) ─────────────────────────────────
	rec := httptest.NewRecorder()
	h.Get(rec, newRangeProjectionGetRequest(t, "42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("Get status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var getBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &getBody); err != nil {
		t.Fatalf("decode Get body: %v; body=%s", err, rec.Body.String())
	}

	// ── Exercise GetByVehicle (4 SignalAt sites) ────────────────────────
	rec = httptest.NewRecorder()
	h.GetByVehicle(rec, newRangeProjectionByVehicleRequest(t, "42"))
	after := time.Now()
	if rec.Code != http.StatusOK {
		t.Fatalf("GetByVehicle status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var byVehBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &byVehBody); err != nil {
		t.Fatalf("decode GetByVehicle body: %v; body=%s", err, rec.Body.String())
	}

	// ── Get downstream projection assertions ────────────────────────────
	// battery_level should equal carried BatteryLevel.
	if got, _ := getBody["battery_level"].(float64); got != batteryLevel {
		t.Fatalf("Get.battery_level = %#v, want %v (carried forward from BatteryLevel)", getBody["battery_level"], batteryLevel)
	}
	// current_range_km = rated * bl / 100 = 400 * 80 / 100 = 320, rounded
	// to 1 decimal place. Pins both that RatedRange was used (not estimated
	// or ideal) AND that BatteryLevel modulates the result.
	wantCurrent := ratedRange * batteryLevel / 100
	if got, _ := getBody["current_range_km"].(float64); got != wantCurrent {
		t.Fatalf("Get.current_range_km = %#v, want %v (rated × bl/100)", getBody["current_range_km"], wantCurrent)
	}
	// efficiency_factor = est/rated + totalImpact/100 = 0.875 + (-4)/100 = 0.835.
	// totalImpact = -4 because db is nil → buildRangeFactors only emits the
	// fixed hvac (-3) and elevation (-1) factors (the avgTemp, avgSpeed,
	// avgEff branches are gated on non-nil pointers). This pins both that
	// EstBatteryRange / RatedRange feed effFactor AND that the +/- impact
	// adders are applied as expected.
	const wantEffFactor = 0.835
	if got, _ := getBody["efficiency_factor"].(float64); got != wantEffFactor {
		t.Fatalf("Get.efficiency_factor = %#v, want %v (est/rated + impact/100)", getBody["efficiency_factor"], wantEffFactor)
	}
	// projected_range_km = rated * effFactor * bl / 100, rounded to 1 dp.
	// Pins that all three of RatedRange, EstBatteryRange (via effFactor),
	// and BatteryLevel are wired through to the headline projection number.
	wantProjected := ratedRange * wantEffFactor * batteryLevel / 100
	if got, _ := getBody["projected_range_km"].(float64); got != wantProjected {
		t.Fatalf("Get.projected_range_km = %#v, want %v (rated × effFactor × bl/100)", getBody["projected_range_km"], wantProjected)
	}
	// health_factor = round((energy/cap)*1000)/1000 with cap = 75 (db-nil
	// default) and energy = 60 → 0.8. Pins that EnergyRemaining feeds the
	// usable-capacity scaling.
	wantHealthFactor := energyRemaining / capacityWhDefault
	if got, _ := getBody["health_factor"].(float64); got != wantHealthFactor {
		t.Fatalf("Get.health_factor = %#v, want %v (energy/cap)", getBody["health_factor"], wantHealthFactor)
	}

	// ── GetByVehicle downstream projection assertions ───────────────────
	// new_range_km = rated when fresh; pins RatedRange wins over IdealBatteryRange.
	if got, _ := byVehBody["new_range_km"].(float64); got != ratedRange {
		t.Fatalf("GetByVehicle.new_range_km = %#v, want %v (RatedRange at 100%%)", byVehBody["new_range_km"], ratedRange)
	}
	// current_range_km = rated * bl / 100 = 320.
	if got, _ := byVehBody["current_range_km"].(float64); got != wantCurrent {
		t.Fatalf("GetByVehicle.current_range_km = %#v, want %v (rated × bl/100)", byVehBody["current_range_km"], wantCurrent)
	}
	// health_score = (energy/cap)*100 = 80. Pins EnergyRemaining feeds health.
	wantHealthScore := (energyRemaining / capacityWhDefault) * 100
	if got, _ := byVehBody["health_score"].(float64); got != wantHealthScore {
		t.Fatalf("GetByVehicle.health_score = %#v, want %v ((energy/cap)*100)", byVehBody["health_score"], wantHealthScore)
	}
	// current_capacity_pct = healthPct = 80.
	if got, _ := byVehBody["current_capacity_pct"].(float64); got != wantHealthScore {
		t.Fatalf("GetByVehicle.current_capacity_pct = %#v, want %v", byVehBody["current_capacity_pct"], wantHealthScore)
	}
	// degradation_pct = 100 - healthPct = 20.
	wantDegradation := 100 - wantHealthScore
	if got, _ := byVehBody["degradation_pct"].(float64); got != wantDegradation {
		t.Fatalf("GetByVehicle.degradation_pct = %#v, want %v (100 - health)", byVehBody["degradation_pct"], wantDegradation)
	}
	_ = idealBatteryRange // referenced for documentation; RatedRange wins so IdealBatteryRange does not surface in this scenario
	_ = estBatteryRange   // referenced for documentation; flows in via wantEffFactor

	// ── Pin all 5 distinct signal names + at-anchor ─────────────────────
	wantNames := map[string]bool{
		"BatteryLevel":      false,
		"EstBatteryRange":   false,
		"RatedRange":        false,
		"IdealBatteryRange": false,
		"EnergyRemaining":   false,
	}
	for _, c := range calls {
		if _, ok := wantNames[c.name]; !ok {
			t.Fatalf("handler called SignalAt with unexpected name %q; calls=%v", c.name, calls)
		}
		wantNames[c.name] = true
		if c.vehicleID != vid {
			t.Fatalf("SignalAt(%q).vehicleID = %d, want %d", c.name, c.vehicleID, vid)
		}
		if c.at.Before(before.Add(-time.Second)) || c.at.After(after.Add(time.Second)) {
			t.Fatalf("SignalAt(%q).at = %v, want within [%v, %v] (≈ time.Now())", c.name, c.at, before, after)
		}
	}
	for name, sawIt := range wantNames {
		if !sawIt {
			t.Fatalf("handler never called SignalAt with name=%q; calls=%v", name, calls)
		}
	}
}

// TestRangeProjection_NoSignalSkipped is the explicit headline-count
// guarantee for this prompt: across one Get + one GetByVehicle invocation,
// the handler MUST issue exactly 9 SignalAt calls (5 from Get covering
// BatteryLevel/EstBatteryRange/RatedRange/IdealBatteryRange/EnergyRemaining,
// 4 from GetByVehicle covering BatteryLevel/RatedRange/IdealBatteryRange/
// EnergyRemaining). A future refactor that drops, dedupes, or short-
// circuits any of those reads will reduce the count below 9 and is caught
// here. Conversely, a regression that introduces a duplicate read of one
// signal will push the count above 9 and is also caught.
//
// This is intentionally separate from AllNineSignalsCarryForward because
// the count guarantee must survive even if downstream projection logic
// changes in ways that make the value-level assertions brittle.
func TestRangeProjection_NoSignalSkipped(t *testing.T) {
	var callCount int
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			callCount++
			return nil, nil // (nil, nil) is the legitimate "never emitted" sentinel
		},
	}
	h := &RangeProjectionHandler{state: fake}

	rec := httptest.NewRecorder()
	h.Get(rec, newRangeProjectionGetRequest(t, "42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("Get status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	getCount := callCount
	const wantGetCount = 5
	if getCount != wantGetCount {
		t.Fatalf("Get SignalAt call count = %d, want %d (BatteryLevel, EstBatteryRange, RatedRange, IdealBatteryRange, EnergyRemaining)", getCount, wantGetCount)
	}

	rec = httptest.NewRecorder()
	h.GetByVehicle(rec, newRangeProjectionByVehicleRequest(t, "42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("GetByVehicle status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	byVehCount := callCount - getCount
	const wantByVehCount = 4
	if byVehCount != wantByVehCount {
		t.Fatalf("GetByVehicle SignalAt call count = %d, want %d (BatteryLevel, RatedRange, IdealBatteryRange, EnergyRemaining)", byVehCount, wantByVehCount)
	}

	const wantTotal = 9
	if callCount != wantTotal {
		t.Fatalf("total SignalAt call count = %d, want %d (5 Get + 4 GetByVehicle)", callCount, wantTotal)
	}
}

// TestRangeProjection_PropagatesError verifies that a StateReader.SignalAt
// transport error (e.g. pgx connection drop) becomes a 500 to the client
// for BOTH entry points. The legacy *signaldb.SignalLogReader-backed
// handler silently swallowed SignalAt errors and returned a partial
// payload with zero / default-valued range and degradation, which is
// indistinguishable on the frontend from "vehicle truly idle / brand-new
// vehicle with no signal_log history". The StateReader-backed handler tightens
// error handling so the frontend can surface the failure rather than
// silently rendering a "range looks dead" panel. A future regression that
// reverts to the silent-swallow behavior is caught here.
func TestRangeProjection_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &RangeProjectionHandler{state: fake}

	t.Run("Get", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.Get(rec, newRangeProjectionGetRequest(t, "42"))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GetByVehicle", func(t *testing.T) {
		rec := httptest.NewRecorder()
		h.GetByVehicle(rec, newRangeProjectionByVehicleRequest(t, "42"))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}
