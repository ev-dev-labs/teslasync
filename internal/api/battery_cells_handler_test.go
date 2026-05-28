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

// newBatteryCellsRequest builds an *http.Request with vehicle_id wired
// onto the query string so BatteryCellsHandler.Get parses it via
// r.URL.Query().Get("vehicle_id"). Mirrors the pattern used in
// battery_handler_test.go but for the query-param-driven endpoint.
func newBatteryCellsRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, "/analytics/battery-cells?vehicle_id="+vehicleID, nil)
}

// TestBatteryCells_LatestVoltage_UsesSignalAt verifies that the handler
// resolves BrickVoltageMax / BrickVoltageMin / NumBrickVoltageMax /
// NumBrickVoltageMin / PackVoltage / ModuleTempMax / ModuleTempMin via
// signal.StateReader.SignalAt at time.Now() and that those values flow
// into the JSON response. Phase-39 migrated this handler off the legacy
// signaldb.SignalLogReader.SignalAt helper; a future regression that
// re-points the per-signal lookups at signalLogReader (which would
// reintroduce the deleted helper) or anchors them to a stale "at" would
// freeze or zero the Battery Cells panel and is caught here. The test
// also pins the seven expected signal names so a regression that drops
// one of the per-signal projections (and, e.g., loses pack_voltage in
// the response) is also caught.
func TestBatteryCells_LatestVoltage_UsesSignalAt(t *testing.T) {
	const (
		brickMax    = 4.20
		brickMin    = 4.18
		numMax      = 1.0
		numMin      = 2.0
		packVoltage = 402.0
		tempMax     = 24.0
		tempMin     = 20.0
	)
	vid := int64(42)

	carried := map[string]float64{
		"BrickVoltageMax":    brickMax,
		"BrickVoltageMin":    brickMin,
		"NumBrickVoltageMax": numMax,
		"NumBrickVoltageMin": numMin,
		"PackVoltage":        packVoltage,
		"ModuleTempMax":      tempMax,
		"ModuleTempMin":      tempMin,
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
	// liveSignals: nil → handler falls through to state.SignalAt.
	// signalLogReader: nil → getHistory short-circuits to empty slice.
	h := &BatteryCellsHandler{state: fake}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Get(rec, newBatteryCellsRequest(t, "42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	wantNames := map[string]bool{
		"BrickVoltageMax":    false,
		"BrickVoltageMin":    false,
		"NumBrickVoltageMax": false,
		"NumBrickVoltageMin": false,
		"PackVoltage":        false,
		"ModuleTempMax":      false,
		"ModuleTempMin":      false,
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
	if got, _ := body["min_voltage"].(float64); got != brickMin {
		t.Fatalf("min_voltage = %#v, want %v (carried from BrickVoltageMin)", body["min_voltage"], brickMin)
	}
	if got, _ := body["max_voltage"].(float64); got != brickMax {
		t.Fatalf("max_voltage = %#v, want %v (carried from BrickVoltageMax)", body["max_voltage"], brickMax)
	}
	if got, _ := body["pack_voltage"].(float64); got != packVoltage {
		t.Fatalf("pack_voltage = %#v, want %v (carried from PackVoltage)", body["pack_voltage"], packVoltage)
	}
	if got, _ := body["min_temperature"].(float64); got != tempMin {
		t.Fatalf("min_temperature = %#v, want %v (carried from ModuleTempMin)", body["min_temperature"], tempMin)
	}
	if got, _ := body["max_temperature"].(float64); got != tempMax {
		t.Fatalf("max_temperature = %#v, want %v (carried from ModuleTempMax)", body["max_temperature"], tempMax)
	}
}

// TestBatteryCells_PropagatesError verifies that a StateReader.SignalAt
// transport error (e.g. pgx connection drop) becomes a 500 to the
// client. The legacy *signaldb.SignalLogReader-backed handler silently
// swallowed SignalAt errors and returned a "no_data" payload, which is
// indistinguishable on the frontend from "vehicle truly idle / no brick
// voltage history" and rendered the Battery Cells panel empty even when
// the underlying read had genuinely failed. This phase-39 migration
// tightens error handling so the frontend can surface the failure
// rather than silently rendering a "battery looks dead" panel. A future
// regression that reverts to the silent-swallow behavior is caught here.
func TestBatteryCells_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &BatteryCellsHandler{state: fake}

	rec := httptest.NewRecorder()
	h.Get(rec, newBatteryCellsRequest(t, "42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}
