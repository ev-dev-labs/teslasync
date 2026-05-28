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

// newDrivetrainHealthRequest builds a GET /drivetrain/health request
// with the supplied vehicle_id query parameter. The handler reads the
// vehicle ID via r.URL.Query().Get("vehicle_id") + parseInt64, so this
// mirrors the production transport.
func newDrivetrainHealthRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, "/drivetrain/health?vehicle_id="+vehicleID, nil)
}

// TestDrivetrainHealth_AllSignalsCarryForward verifies that the handler
// derives all four projected drivetrain temperatures
// (front_motor_temp_c, rear_motor_temp_c, inverter_temp_c,
// battery_temp_c) from forward-folded SignalAt reads of ModuleTempMax /
// ModuleTempMin. The fake returns last-known values for both signals
// (emulating StateReader's forward-fold semantics where unchanged
// signals carry their prior emitted value rather than disappearing —
// motor module temps are exactly the kind of signal that change rarely
// while parked). The test asserts every downstream projection field
// renders the carried-forward value: rear_motor_temp_c == ModuleTempMax,
// front_motor_temp_c == ModuleTempMin, inverter_temp_c == ModuleTempMax
// + 7 (the handler's "inverter runs ~7°C above battery module" heuristic),
// and battery_temp_c == mean(ModuleTempMax, ModuleTempMin).
//
// The legacy raw-snapshot path returned zero for any signal that had no
// fresh emission inside the window; this contract test pins the new
// behavior so a regression that re-introduces a "fresh-only" filter
// (and freezes the Drivetrain Health panel at zero on a parked vehicle)
// is caught immediately. The test also pins both expected signal names
// (ModuleTempMax, ModuleTempMin) and the at-anchor (≈ time.Now()) so a
// regression that drops a signal name, queries a different signal, or
// anchors the read to a stale timestamp is also caught.
func TestDrivetrainHealth_AllSignalsCarryForward(t *testing.T) {
	const (
		vid           = int64(42)
		moduleTempMax = 24.0
		moduleTempMin = 20.0
	)
	carried := map[string]float64{
		"ModuleTempMax": moduleTempMax,
		"ModuleTempMin": moduleTempMin,
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
	// db: nil — the handler's recent-drives query is nil-guarded post
	// migration so the test does not need a real *database.DB. The
	// drive-count branch only flips motorStatus to "Idle" when
	// recentDrives == 0 AND the temperature-derived health is "good",
	// which is what we expect here (all temps below 60°C threshold).
	h := &DrivetrainHealthHandler{state: fake}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Get(rec, newDrivetrainHealthRequest(t, "42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}

	// Rear motor temp = ModuleTempMax (handler rounds to 1 decimal place).
	if got, _ := body["rear_motor_temp_c"].(float64); got != moduleTempMax {
		t.Fatalf("rear_motor_temp_c = %#v, want %v (carried forward from ModuleTempMax)", body["rear_motor_temp_c"], moduleTempMax)
	}
	// Front motor temp = ModuleTempMin.
	if got, _ := body["front_motor_temp_c"].(float64); got != moduleTempMin {
		t.Fatalf("front_motor_temp_c = %#v, want %v (carried forward from ModuleTempMin)", body["front_motor_temp_c"], moduleTempMin)
	}
	// Inverter temp = ModuleTempMax + 7 (handler's "inverter runs ~7°C
	// above battery module" heuristic).
	if want := moduleTempMax + 7; body["inverter_temp_c"] == nil {
		t.Fatalf("inverter_temp_c = nil, want %v (ModuleTempMax + 7°C)", want)
	} else if got, _ := body["inverter_temp_c"].(float64); got != want {
		t.Fatalf("inverter_temp_c = %#v, want %v (ModuleTempMax + 7°C heuristic)", body["inverter_temp_c"], want)
	}
	// Battery temp = mean(ModuleTempMax, ModuleTempMin).
	if want := (moduleTempMax + moduleTempMin) / 2; body["battery_temp_c"] == nil {
		t.Fatalf("battery_temp_c = nil, want %v (mean of ModuleTempMax/Min)", want)
	} else if got, _ := body["battery_temp_c"].(float64); got != want {
		t.Fatalf("battery_temp_c = %#v, want %v (mean of ModuleTempMax/Min)", body["battery_temp_c"], want)
	}

	// Pin both expected signal names + the at-anchor.
	wantNames := map[string]bool{
		"ModuleTempMax": false,
		"ModuleTempMin": false,
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
}

// TestDrivetrainHealth_PropagatesError verifies that a
// StateReader.SignalAt transport error (e.g. pgx connection drop)
// becomes a 500 to the client. The legacy
// *signaldb.SignalLogReader-backed handler silently swallowed SignalAt
// errors and returned a partial payload with zero-valued temps, which
// is indistinguishable on the frontend from "vehicle truly idle /
// brand-new vehicle with no signal_log history". This phase-39
// migration tightens error handling so the frontend can surface the
// failure rather than silently rendering a "drivetrain looks dead"
// panel. A future regression that reverts to the silent-swallow
// behavior is caught here.
func TestDrivetrainHealth_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &DrivetrainHealthHandler{state: fake}

	rec := httptest.NewRecorder()
	h.Get(rec, newDrivetrainHealthRequest(t, "42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}
