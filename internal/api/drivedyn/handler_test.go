package drivedyn

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

// newDriveDynamicsRequest builds an *http.Request for the
// /drive-dynamics handlers with vehicle_id pre-encoded.
func newDriveDynamicsRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/drive-dynamics?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestDriveDynamicsHandler_Latest_ReturnsLiveState pins the contract that
// the handler:
//
//  1. Calls LiveStateReader.LiveState exactly once with the requested
//     vehicle_id (NOT StateReader.State — this is the live-layer path,
//     not a wall-clock signal_log lookup).
//  2. Projects every driveDynamicsMappings signal present in the State
//     under its mapped Field name (lateral_acceleration,
//     longitudinal_acceleration, pedal_position, brake_pedal_position,
//     brake_pedal_active).
//  3. Omits signals NOT present in the State (so a vehicle whose
//     BrakePedal has never emitted has no `brake_pedal_active` key).
//  4. Does NOT leak the raw Tesla signal names into the response body —
//     only the snake_case Field side of the mapping appears.
//
// This is the bug-fix regression: pre-fix, GForcePanel + PedalUsage
// called /signals/observations which returns 404 (table dropped),
// painting a permanent "No telemetry received yet" empty state even
// when LiveState had all 5 signals.
func TestDriveDynamicsHandler_Latest_ReturnsLiveState(t *testing.T) {
	var gotVehicleID int64
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, _ time.Time) (signal.State, error) {
			gotVehicleID = vid
			return signal.State{
				"LateralAcceleration":      0.12,
				"LongitudinalAcceleration": -0.04,
				"PedalPosition":            42.5,
				"BrakePedalPos":            7.25,
				"BrakePedal":               true,
				// Extra signals NOT in driveDynamicsMappings — these
				// must be filtered out so the wire payload stays a
				// driving-dynamics surface, not a kitchen-sink
				// passthrough of every Tesla signal in LiveState.
				"DiStateF": "DRIVE",
				"Gear":     "D",
			}, nil
		},
	}
	h := NewDriveDynamicsHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.Latest(rec, newDriveDynamicsRequest("42", "/drive-dynamics/latest?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if gotVehicleID != 42 {
		t.Fatalf("LiveState vehicleID = %d, want 42", gotVehicleID)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}

	// All 5 mapped signals present must be projected under their
	// snake_case Field name.
	if v, ok := got["lateral_acceleration"].(float64); !ok || v != 0.12 {
		t.Fatalf("lateral_acceleration = %#v, want 0.12", got["lateral_acceleration"])
	}
	if v, ok := got["longitudinal_acceleration"].(float64); !ok || v != -0.04 {
		t.Fatalf("longitudinal_acceleration = %#v, want -0.04", got["longitudinal_acceleration"])
	}
	if v, ok := got["pedal_position"].(float64); !ok || v != 42.5 {
		t.Fatalf("pedal_position = %#v, want 42.5", got["pedal_position"])
	}
	if v, ok := got["brake_pedal_position"].(float64); !ok || v != 7.25 {
		t.Fatalf("brake_pedal_position = %#v, want 7.25", got["brake_pedal_position"])
	}
	if v, ok := got["brake_pedal_active"].(bool); !ok || v != true {
		t.Fatalf("brake_pedal_active = %#v, want true", got["brake_pedal_active"])
	}

	// Extra signals from LiveState that are NOT in driveDynamicsMappings
	// must be filtered out — the response body is a driving-dynamics
	// surface, not a passthrough of every signal in the live cache.
	if _, present := got["DiStateF"]; present {
		t.Fatalf("raw signal DiStateF leaked into response; got=%v", got)
	}
	if _, present := got["state_front"]; present {
		t.Fatalf("motor field state_front leaked into response; got=%v", got)
	}
	if _, present := got["Gear"]; present {
		t.Fatalf("raw signal Gear leaked into response; got=%v", got)
	}
	if _, present := got["shift_state"]; present {
		t.Fatalf("motor field shift_state leaked into response; got=%v", got)
	}

	// Raw Tesla signal names must NEVER leak into the response — only
	// the projected Field names (snake_case driving-dynamics keys).
	for _, raw := range []string{"LateralAcceleration", "LongitudinalAcceleration", "PedalPosition", "BrakePedalPos", "BrakePedal"} {
		if _, present := got[raw]; present {
			t.Fatalf("raw signal %s leaked into response; got=%v", raw, got)
		}
	}
}

// TestDriveDynamicsHandler_Latest_OmitsAbsentSignals locks the contract
// that signals not present in LiveState are silently omitted from the
// response, NOT projected as null / 0 / false. This matters because
// the frontend distinguishes "no observation yet" (omit / undefined,
// rendered as "—" or "Brake Inactive" badge) from "explicit zero
// observation" (rendered as "0.00 g" / "0%" with the live colour).
func TestDriveDynamicsHandler_Latest_OmitsAbsentSignals(t *testing.T) {
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			// Only 2 of the 5 driving-dynamics signals are present
			// — simulates a vehicle that has emitted G-force but
			// has never sent a pedal payload.
			return signal.State{
				"LateralAcceleration":      0.05,
				"LongitudinalAcceleration": -0.10,
			}, nil
		},
	}
	h := NewDriveDynamicsHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.Latest(rec, newDriveDynamicsRequest("42", "/drive-dynamics/latest?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}

	// G-force present.
	if _, ok := got["lateral_acceleration"]; !ok {
		t.Fatalf("lateral_acceleration missing; got=%v", got)
	}
	if _, ok := got["longitudinal_acceleration"]; !ok {
		t.Fatalf("longitudinal_acceleration missing; got=%v", got)
	}

	// Pedal absent — keys must NOT be present at all (no null, no zero).
	for _, k := range []string{"pedal_position", "brake_pedal_position", "brake_pedal_active"} {
		if _, present := got[k]; present {
			t.Fatalf("absent signal projected as %s=%#v (want key omitted); got=%v", k, got[k], got)
		}
	}
}

// TestDriveDynamicsHandler_Latest_BadRequest pins the input-validation
// contract: missing vehicle_id, vehicle_id=0, and non-integer values
// all fail with HTTP 400 and never invoke the LiveStateReader. This
// matches the input contract used by every other per-subsystem
// handler (motor, tire-pressure, climate, …).
func TestDriveDynamicsHandler_Latest_BadRequest(t *testing.T) {
	tests := []struct {
		name   string
		target string
	}{
		{"missing", "/drive-dynamics/latest"},
		{"zero", "/drive-dynamics/latest?vehicle_id=0"},
		{"non-integer", "/drive-dynamics/latest?vehicle_id=abc"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var stateCalls int
			fake := &fakeStateReader{
				stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
					stateCalls++
					return signal.State{}, nil
				},
			}
			h := NewDriveDynamicsHandler(fake, newTestLiveStateReader(fake))

			rec := httptest.NewRecorder()
			h.Latest(rec, httptest.NewRequest(http.MethodGet, tt.target, nil))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if stateCalls != 0 {
				t.Fatalf("LiveState called %d times on bad request, want 0", stateCalls)
			}
		})
	}
}

// TestDriveDynamicsHandler_PropagatesError pins the 500-on-upstream-error
// contract for both endpoints. Mirrors motor_handler_test.go's
// TestMotorHandler_PropagatesError — a transient pgx connection loss
// in the live cache fallback path must surface as HTTP 500, never as
// a silent 200 with an empty body that would paint the panel as
// "no telemetry yet".
func TestDriveDynamicsHandler_PropagatesError(t *testing.T) {
	t.Run("Latest_LiveStateError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on LiveState fallback")
		fake := &fakeStateReader{
			stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
				return nil, wantErr
			},
		}
		h := NewDriveDynamicsHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.Latest(rec, newDriveDynamicsRequest("42", "/drive-dynamics/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewDriveDynamicsHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.List(rec, newDriveDynamicsRequest("42", ""))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}

// TestDriveDynamicsHandler_List_ChartMode is the wire-up + carry-forward
// proof for the History endpoint. Mirrors the motor / tire-pressure
// chart-mode contract:
//
//  1. Timeline is invoked exactly once with the full
//     driveDynamicsMappings projection.
//  2. Chart mode is requested (empty CollapseBy) so every
//     change-feed emission becomes one row — a non-empty CollapseBy
//     would drop "still inactive everywhere" rows for the rarely-
//     re-emitted BrakePedal flag and break the panel's stepped chart.
//  3. Forward-folded rows are NOT dropped — every TimelineRow becomes
//     a response row, and the legacy created_at / id aliases are
//     injected on the wire.
func TestDriveDynamicsHandler_List_ChartMode(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"lateral_acceleration":      0.05,
			"longitudinal_acceleration": -0.10,
			"pedal_position":            30.0,
			"brake_pedal_active":        false,
		}},
		{Timestamp: t0.Add(15 * time.Second), Fields: map[string]signal.SignalValue{
			"lateral_acceleration":      0.07,
			"longitudinal_acceleration": -0.20,
			"pedal_position":            45.0,
			"brake_pedal_active":        false,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewDriveDynamicsHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newDriveDynamicsRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(driveDynamicsMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(driveDynamicsMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	for i, row := range got {
		if _, ok := row["created_at"]; !ok {
			t.Fatalf("row[%d] missing created_at alias; row=%v", i, row)
		}
		idVal, ok := row["id"].(float64)
		if !ok || int(idVal) != i+1 {
			t.Fatalf("row[%d].id = %#v, want %d", i, row["id"], i+1)
		}
	}
}

// fakeStateReader / newTestLiveStateReader are duplicated from
// internal/api/media_handler_test.go for the duration of Phase R2;
// subpackage tests can't import parent test fixtures. The full version
// (captured Timeline opts + fields) is required by the chart-mode
// assertions above.
type fakeStateReader struct {
	stateFn    func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	signalAtFn func(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error)
	timelineFn func(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error)

	gotTimelineOpts   signal.TimelineOptions
	gotTimelineFields []signal.FieldMapping
	gotTimelineCalls  int
}

func (f *fakeStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *fakeStateReader) SignalAt(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error) {
	if f.signalAtFn == nil {
		return nil, nil
	}
	return f.signalAtFn(ctx, vehicleID, name, at)
}

func (f *fakeStateReader) Timeline(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error) {
	f.gotTimelineCalls++
	f.gotTimelineOpts = opts
	f.gotTimelineFields = fields
	if f.timelineFn == nil {
		return nil, nil
	}
	return f.timelineFn(ctx, vehicleID, fields, from, to, opts)
}

var _ signal.StateReader = (*fakeStateReader)(nil)

// newTestLiveStateReader wraps a fakeStateReader as a signal.LiveStateReader
// suitable for /latest handler tests. The L1+L2 layer is a no-op, so the
// handler's LiveState() call falls through to the wrapped StateReader's
// State() — letting tests continue to drive responses via fake.stateFn.
func newTestLiveStateReader(state signal.StateReader) signal.LiveStateReader {
	return signal.MustNewLiveStateReader(signal.NewNoopLiveSignalStore(), state)
}
