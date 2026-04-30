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

// newClimateRequest builds an *http.Request for the /climate handlers with
// vehicle_id pre-encoded.
func newClimateRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/climate?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestClimateHandler_History_CarriesForwardCabinTemp is the bug-fix proof
// for the phase-39 climate migration.
//
// Climate signals (cabin temp, HVAC mode, seat heaters) re-emit rarely —
// often once per day. The legacy raw-pivot implementation rendered every
// row whose bucket did not contain a fresh InsideTemp emission with NULL
// for inside_temp, producing sawtooth gaps in the climate history chart on
// the frontend.
//
// The migrated handler delegates to StateReader.Timeline, which
// forward-folds: every TimelineRow carries the most recent value of every
// projected signal. This test simulates that forward-folded output and
// asserts the handler does not strip, drop, or filter any row that has
// inside_temp populated. If a future refactor reintroduced a "skip rows
// without a fresh InsideTemp emission" filter, this test would fail.
func TestClimateHandler_History_CarriesForwardCabinTemp(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 8, 0, 0, 0, time.UTC)
	// Three rows, all carrying the same forward-folded inside_temp seed.
	// Other signals (hvac_power, fan_speed) shift across rows to mimic the
	// real change-feed shape, but inside_temp persists because StateReader
	// has already done the forward-fold.
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"inside_temp": 22.0,
			"hvac_power":  true,
		}},
		{Timestamp: t0.Add(30 * time.Minute), Fields: map[string]signal.SignalValue{
			"inside_temp": 22.0,
			"fan_speed":   3.0,
		}},
		{Timestamp: t0.Add(2 * time.Hour), Fields: map[string]signal.SignalValue{
			"inside_temp": 22.0,
			"hvac_power":  true,
			"fan_speed":   1.0,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewClimateHandler(fake)

	rec := httptest.NewRecorder()
	h.List(rec, newClimateRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes one
	// row. A non-empty CollapseBy would drop "still 22°C, still HVAC on"
	// rows and break the climate history chart's stepped-line rendering.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(climateMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(climateMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	// THE BUG-FIX ASSERTION: every row must carry inside_temp = 22.0,
	// even rows that did not have a fresh InsideTemp emission. In the old
	// pivot impl, rows[1] would have inside_temp=nil. With forward-folding
	// (now done by StateReader.Timeline upstream and faithfully preserved
	// by the handler), every row has the carried-forward value.
	for i, row := range got {
		v, ok := row["inside_temp"]
		if !ok {
			t.Fatalf("row[%d] missing inside_temp key; row=%v", i, row)
		}
		f, isFloat := v.(float64)
		if !isFloat || f != 22.0 {
			t.Fatalf("row[%d].inside_temp = %#v, want 22.0 (forward-folded carry-forward)", i, v)
		}
		// Legacy field-name aliases must also be present so the existing
		// frontend consuming created_at / timestamp / id keeps working.
		if _, ok := row["created_at"]; !ok {
			t.Fatalf("row[%d] missing created_at alias; row=%v", i, row)
		}
		if _, ok := row["timestamp"]; !ok {
			t.Fatalf("row[%d] missing timestamp alias; row=%v", i, row)
		}
		idVal, ok := row["id"].(float64)
		if !ok || int(idVal) != i+1 {
			t.Fatalf("row[%d].id = %#v, want %d", i, row["id"], i+1)
		}
	}
}

// TestClimateHandler_Latest_UsesNow verifies that Latest derives the
// current climate snapshot from StateReader.State(time.Now()) — not from a
// rolling-window or session-anchored timestamp. Latest projects each
// mapped signal under its JSON field name; absent signals are omitted.
func TestClimateHandler_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				"InsideTemp":      22.5,
				"OutsideTemp":     18.0,
				"HvacPower":       true,
				"HvacFanSpeed":    3.0,
				"SeatHeaterLeft":  2.0,
				"BatteryHeaterOn": false,
			}, nil
		},
	}
	h := NewClimateHandler(fake)

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newClimateRequest("42", "/climate/latest?vehicle_id=42"))
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
	if v, ok := got["inside_temp"].(float64); !ok || v != 22.5 {
		t.Fatalf("inside_temp = %#v, want 22.5", got["inside_temp"])
	}
	if v, ok := got["outside_temp"].(float64); !ok || v != 18.0 {
		t.Fatalf("outside_temp = %#v, want 18.0", got["outside_temp"])
	}
	if v, ok := got["hvac_power"].(bool); !ok || v != true {
		t.Fatalf("hvac_power = %#v, want true", got["hvac_power"])
	}
	if v, ok := got["fan_speed"].(float64); !ok || v != 3.0 {
		t.Fatalf("fan_speed = %#v, want 3.0", got["fan_speed"])
	}
	if v, ok := got["seat_heater_left"].(float64); !ok || v != 2.0 {
		t.Fatalf("seat_heater_left = %#v, want 2.0", got["seat_heater_left"])
	}
	if v, ok := got["battery_heater"].(bool); !ok || v != false {
		t.Fatalf("battery_heater = %#v, want false", got["battery_heater"])
	}
	// Signals not present in the State must NOT appear in the response.
	if _, present := got["defrost_mode"]; present {
		t.Fatalf("defrost_mode unexpectedly present in response; got=%v", got)
	}
}

// TestClimateHandler_History_PropagatesError verifies that a Timeline
// transport error (e.g. pgx connection drop) becomes a 500 to the client,
// never a silent 200 with an empty body.
func TestClimateHandler_History_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, wantErr
		},
	}
	h := NewClimateHandler(fake)

	rec := httptest.NewRecorder()
	h.List(rec, newClimateRequest("42", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestClimateHandler_Latest_PropagatesError verifies that a State transport
// error becomes a 500 to the client. The legacy handler also returned 500
// here; this test locks the contract for the migrated implementation so a
// future regression that swallows the error or returns an empty envelope
// is caught.
func TestClimateHandler_Latest_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost on State")
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return nil, wantErr
		},
	}
	h := NewClimateHandler(fake)

	rec := httptest.NewRecorder()
	h.Latest(rec, newClimateRequest("42", "/climate/latest?vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}
