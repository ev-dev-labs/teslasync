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

// newMotorRequest builds an *http.Request for the /motor handlers with
// vehicle_id pre-encoded.
func newMotorRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/motor?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestMotorHandler_History_ChartMode is the wire-up + carry-forward proof
// for the phase-39 motor-handler migration.
//
// Drive-state signals (DiStateF/R, Gear) emit only on transition; for a
// parked vehicle they may not re-emit for hours, leaving the legacy
// raw-pivot implementation with NULL state_front / state_rear / shift_state
// across long stable runs (the powertrain chart's well-known empty-cell
// gaps). This test simulates the forward-folded output StateReader.Timeline
// produces in chart mode (empty CollapseBy) — every row carries the
// most-recent value of every projected signal — and asserts:
//
//  1. The handler invokes Timeline exactly once with the full
//     motorMappings field projection.
//  2. The handler asks for CHART MODE (empty CollapseBy) so every
//     change-feed emission becomes one row; a non-empty CollapseBy would
//     drop "still in DRIVE everywhere" rows and break the powertrain
//     chart's stepped-line rendering.
//  3. The handler does NOT strip, drop, or filter rows that carry only
//     forward-folded values — every TimelineRow becomes one response row
//     with the legacy created_at / id aliases preserved.
func TestMotorHandler_History_ChartMode(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"state_front":      "DRIVE",
			"state_rear":       "DRIVE",
			"shift_state":      "D",
			"torque_nm_front":  120.0,
			"torque_nm_rear":   140.0,
			"motor_temp_c_front": 65.0,
			"inverter_temp_c":  55.0,
		}},
		{Timestamp: t0.Add(30 * time.Second), Fields: map[string]signal.SignalValue{
			"state_front":      "DRIVE",
			"state_rear":       "DRIVE",
			"shift_state":      "D",
			"torque_nm_front":  140.0,
			"torque_nm_rear":   160.0,
			"motor_temp_c_front": 66.0,
			"inverter_temp_c":  56.0,
		}},
		{Timestamp: t0.Add(60 * time.Second), Fields: map[string]signal.SignalValue{
			"state_front":      "DRIVE",
			"state_rear":       "DRIVE",
			"shift_state":      "D",
			"torque_nm_front":  155.0,
			"torque_nm_rear":   175.0,
			"motor_temp_c_front": 67.0,
			"inverter_temp_c":  57.0,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewMotorHandler(fake)

	rec := httptest.NewRecorder()
	h.List(rec, newMotorRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes one
	// row. A non-empty CollapseBy would collapse identical drive-state
	// runs into a single row and break the powertrain chart's stepped
	// rendering of motor temperature / torque over time.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(motorMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(motorMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	for i, row := range got {
		// Every row must carry the forward-folded drive-state value;
		// in the old pivot impl, only the row with a fresh DiStateF
		// emission would have state_front populated.
		if v, ok := row["state_front"].(string); !ok || v != "DRIVE" {
			t.Fatalf("row[%d].state_front = %#v, want \"DRIVE\" (forward-folded carry-forward)", i, row["state_front"])
		}
		if v, ok := row["shift_state"].(string); !ok || v != "D" {
			t.Fatalf("row[%d].shift_state = %#v, want \"D\"", i, row["shift_state"])
		}
		// Legacy field-name aliases must be present so the existing
		// frontend consuming created_at / id keeps working.
		if _, ok := row["created_at"]; !ok {
			t.Fatalf("row[%d] missing created_at alias; row=%v", i, row)
		}
		idVal, ok := row["id"].(float64)
		if !ok || int(idVal) != i+1 {
			t.Fatalf("row[%d].id = %#v, want %d", i, row["id"], i+1)
		}
	}
}

// TestMotorHandler_Latest_UsesNow verifies that Latest derives the current
// motor / powertrain snapshot from StateReader.State(time.Now()) — not
// from a rolling-window or session-anchored timestamp. Latest projects
// each mapped signal under its JSON field name; absent signals are
// omitted (e.g. a vehicle whose drive-inverter has never reported
// DiHeatsinkTR will not have a heatsink_temp_rear key in the response).
func TestMotorHandler_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				"DiStateF":        "DRIVE",
				"DiStateR":        "DRIVE",
				"Gear":            "D",
				"DiTorqueActualF": 120.5,
				"DiTorqueActualR": 140.7,
				"DiStatorTempF":   65.0,
				"DiInverterTF":    55.0,
				// DiHeatsinkTR / DiVBatF / DiVBatR / DiAxleSpeedF/R /
				// DiMotorCurrentF/R / DiTorquemotor intentionally
				// absent to confirm Latest omits unmapped-but-known
				// signals.
			}, nil
		},
	}
	h := NewMotorHandler(fake)

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newMotorRequest("42", "/motor/latest?vehicle_id=42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if stateCalls != 1 {
		t.Fatalf("State call count = %d, want 1", stateCalls)
	}
	if gotVehicleID != 42 {
		t.Fatalf("State.vehicleID = %d, want 42", gotVehicleID)
	}
	// Allow a 1-second tolerance window around the wall-clock observation.
	if gotAt.Before(before.Add(-time.Second)) || gotAt.After(after.Add(time.Second)) {
		t.Fatalf("State.at = %v, want within [%v, %v] (≈ time.Now())", gotAt, before, after)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	// Mapped signals present in State must appear under their JSON field
	// name; the snake_case Field side of motorMappings.
	if v, ok := got["state_front"].(string); !ok || v != "DRIVE" {
		t.Fatalf("state_front = %#v, want \"DRIVE\"", got["state_front"])
	}
	if v, ok := got["state_rear"].(string); !ok || v != "DRIVE" {
		t.Fatalf("state_rear = %#v, want \"DRIVE\"", got["state_rear"])
	}
	if v, ok := got["shift_state"].(string); !ok || v != "D" {
		t.Fatalf("shift_state = %#v, want \"D\"", got["shift_state"])
	}
	if v, ok := got["torque_nm_front"].(float64); !ok || v != 120.5 {
		t.Fatalf("torque_nm_front = %#v, want 120.5", got["torque_nm_front"])
	}
	if v, ok := got["torque_nm_rear"].(float64); !ok || v != 140.7 {
		t.Fatalf("torque_nm_rear = %#v, want 140.7", got["torque_nm_rear"])
	}
	if v, ok := got["inverter_temp_c"].(float64); !ok || v != 55.0 {
		t.Fatalf("inverter_temp_c = %#v, want 55.0", got["inverter_temp_c"])
	}
	// Signals not present in the State must NOT appear in the response.
	if _, present := got["heatsink_temp_rear"]; present {
		t.Fatalf("heatsink_temp_rear unexpectedly present in response; got=%v", got)
	}
	if _, present := got["motor_rpm_front"]; present {
		t.Fatalf("motor_rpm_front unexpectedly present in response; got=%v", got)
	}
	if _, present := got["vbat_front"]; present {
		t.Fatalf("vbat_front unexpectedly present in response; got=%v", got)
	}
	// Raw signal names (the Signal side of motorMappings) must NOT leak
	// into the response — only the projected Field names.
	if _, present := got["DiStateF"]; present {
		t.Fatalf("raw signal DiStateF unexpectedly present in response; got=%v", got)
	}
}

// TestMotorHandler_PropagatesError verifies that BOTH endpoints surface
// upstream StateReader errors as HTTP 500, never as a silent 200 with an
// empty body. The legacy handler also returned 500 on Pivot/Snapshot
// failure; this test locks the contract for the migrated implementation.
func TestMotorHandler_PropagatesError(t *testing.T) {
	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewMotorHandler(fake)

		rec := httptest.NewRecorder()
		h.List(rec, newMotorRequest("42", ""))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("Latest_StateError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on State")
		fake := &fakeStateReader{
			stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
				return nil, wantErr
			},
		}
		h := NewMotorHandler(fake)

		rec := httptest.NewRecorder()
		h.Latest(rec, newMotorRequest("42", "/motor/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}
