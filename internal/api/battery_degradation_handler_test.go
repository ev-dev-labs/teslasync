package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// newBatteryDegradationRequest builds an *http.Request with vehicle_id
// wired onto the query string so BatteryDegradationHandler.Predict /
// .Health parse it via r.URL.Query().Get("vehicle_id"). Mirrors the
// pattern used in battery_cells_handler_test.go for the query-param
// driven endpoint.
func newBatteryDegradationRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, "/analytics/battery-degradation?vehicle_id="+vehicleID, nil)
}

// TestBatteryDegradation_AllSignalsCarryForward verifies that the Predict
// fallback branch (entered when no signal_log trace snapshots exist)
// resolves both EnergyRemaining and EstBatteryRange via
// signal.StateReader.SignalAt at time.Now(), and that those carried-
// forward values flow into the JSON response as current_capacity /
// current_range. Phase-39 migrated this handler off the legacy
// database.SignalLogReader.SignalAt helper. The fake returns last-known
// values for every signal name — emulating StateReader's forward-fold
// semantics where unchanged signals carry their prior emitted value
// rather than disappearing — and the test asserts every downstream
// projection field renders that carried-forward value. A future
// regression that re-points the per-signal lookups at signalLogReader
// (which would reintroduce the deleted helper), drops one of the two
// signal names, or anchors them to a stale "at" would zero the Battery
// Degradation panel and is caught here.
func TestBatteryDegradation_AllSignalsCarryForward(t *testing.T) {
	const (
		energyRemaining = 60.0  // capacity_kwh
		estBatteryRange = 410.5 // est_range_km
	)
	vid := int64(42)

	carried := map[string]float64{
		"EnergyRemaining": energyRemaining,
		"EstBatteryRange": estBatteryRange,
	}

	var calls []signalAtCallRecord
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, v int64, name string, at time.Time) (signal.SignalValue, error) {
			calls = append(calls, signalAtCallRecord{vehicleID: v, name: name, at: at})
			if val, ok := carried[name]; ok {
				return val, nil
			}
			return nil, nil
		},
	}
	// db: nil → the handler short-circuits lookupVehicleCapacity to
	// (75.0, "default"), the same fallback lookupVehicleCapacity itself
	// uses on lookup error; charging-habit / cycle-delta queries are
	// nil-guarded below. signalLogReader: nil → the SignalTrace path is
	// skipped, snapshots stay empty, and the Predict fallback enters
	// the state.SignalAt branch under test.
	h := &BatteryDegradationHandler{state: fake}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	wantNames := map[string]bool{
		"EnergyRemaining": false,
		"EstBatteryRange": false,
	}
	for _, c := range calls {
		if _, ok := wantNames[c.name]; !ok {
			continue
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

	// Verify the projected response carries the SignalAt-derived values.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got, _ := body["current_capacity"].(float64); got != energyRemaining {
		t.Fatalf("current_capacity = %#v, want %v (carried forward from EnergyRemaining)", body["current_capacity"], energyRemaining)
	}
	if got, _ := body["current_range"].(float64); got != estBatteryRange {
		t.Fatalf("current_range = %#v, want %v (carried forward from EstBatteryRange)", body["current_range"], estBatteryRange)
	}
}

// TestBatteryDegradation_DegradationCalc_UsesLatestValues verifies that
// the Predict fallback branch derives current_health and
// current_degradation from the StateReader-resolved EnergyRemaining
// signal divided by the looked-up battery capacity (75 kWh default
// when no vehicle row exists). With energy_remaining=60 kWh and the
// default capacity of 75 kWh, expected health = 60/75*100 = 80%, and
// expected degradation = 100 - 80 = 20%. A future regression that
// drops the divide-by-capacity step (and degenerates current_health to
// raw kWh), inverts the degradation formula, or short-circuits the
// fallback derivation when no snapshots exist would silently break the
// Battery Degradation panel's headline metric and is caught here.
func TestBatteryDegradation_DegradationCalc_UsesLatestValues(t *testing.T) {
	const (
		nominalCapacity = 75.0 // default when h.db == nil
		energyRemaining = 60.0
		expectedHealth  = (energyRemaining / nominalCapacity) * 100 // 80
		expectedDegrad  = 100 - expectedHealth                      // 20
	)

	carried := map[string]float64{
		"EnergyRemaining": energyRemaining,
	}
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
			if v, ok := carried[name]; ok {
				return v, nil
			}
			return nil, nil
		},
	}
	h := &BatteryDegradationHandler{state: fake}

	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got, _ := body["current_health"].(float64); got != expectedHealth {
		t.Fatalf("current_health = %#v, want %v (= EnergyRemaining/%v*100)", body["current_health"], expectedHealth, nominalCapacity)
	}
	if got, _ := body["current_degradation"].(float64); got != expectedDegrad {
		t.Fatalf("current_degradation = %#v, want %v (= 100 - current_health)", body["current_degradation"], expectedDegrad)
	}
	// current_health_pct mirrors current_health on the new predictive shape.
	if got, _ := body["current_health_pct"].(float64); got != expectedHealth {
		t.Fatalf("current_health_pct = %#v, want %v (must mirror current_health)", body["current_health_pct"], expectedHealth)
	}
	// battery_capacity_kwh must surface the looked-up (default) capacity
	// — a regression that loses the projection would break the Battery
	// Degradation panel's "estimated capacity" tile.
	if got, _ := body["battery_capacity_kwh"].(float64); got != nominalCapacity {
		t.Fatalf("battery_capacity_kwh = %#v, want %v (default when no vehicle row)", body["battery_capacity_kwh"], nominalCapacity)
	}
}

// TestBatteryDegradation_PropagatesError verifies that a
// StateReader.SignalAt transport error (e.g. pgx connection drop) becomes
// a 500 to the client for the Predict endpoint. The legacy
// *database.SignalLogReader-backed handler silently swallowed SignalAt
// errors and returned a partial / zero-valued payload, which was
// indistinguishable on the frontend from "vehicle truly idle / brand-
// new vehicle with no signal_log history" and rendered the Battery
// Degradation panel as "battery looks dead" even when the underlying
// read had genuinely failed. This phase-39 migration tightens error
// handling so the frontend can surface the failure rather than silently
// rendering a dead-battery panel. A future regression that reverts to
// the silent-swallow behavior is caught here.
func TestBatteryDegradation_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &BatteryDegradationHandler{state: fake}

	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}
