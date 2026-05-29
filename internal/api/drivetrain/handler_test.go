package drivetrain

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

// newDrivetrainHealthRequest builds a GET /drivetrain/health request
// with the supplied vehicle_id query parameter. The handler reads the
// vehicle ID via r.URL.Query().Get("vehicle_id") + strconv.ParseInt, so this
// mirrors the production transport.
func newDrivetrainHealthRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, "/drivetrain/health?vehicle_id="+vehicleID, nil)
}

// TestDrivetrainHealth_AllSignalsCarryForward pins StateReader's forward-fold
// semantics: stale-but-current ModuleTempMax/Min values still drive every
// projected temperature. It also pins the signal names and near-now anchor so a
// fresh-only or stale-anchor regression is caught.
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

// TestDrivetrainHealth_PropagatesError pins SignalAt transport errors surfacing
// as a 500 instead of being silently swallowed, avoiding misleading
// zero-temperature health panels.
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
