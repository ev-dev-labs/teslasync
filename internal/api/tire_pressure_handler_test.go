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

// newTirePressureRequest builds an *http.Request for the /tire-pressure
// handlers with vehicle_id pre-encoded.
func newTirePressureRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/tire-pressure?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestTirePressure_History_CarriesForwardPressures is the headline
// bug-fix proof for the phase-39 tire-pressure migration.
//
// TPMS pressures change VERY rarely — Tesla Fleet Telemetry typically
// re-emits TpmsPressureFl/Fr/Rl/Rr only once per week, sometimes longer
// for a parked vehicle. The legacy raw-pivot implementation rendered every
// row whose bucket did not contain a fresh pressure emission with NULL for
// front_left / front_right / rear_left / rear_right, producing the
// well-known "blank tire pressure dial" bug across long stable runs.
//
// The migrated handler delegates to StateReader.Timeline, which
// forward-folds: every TimelineRow carries the most recent value of every
// projected signal. This test simulates that forward-folded output —
// front_left appears in the seed row only, but the StateReader has already
// carried it forward — and asserts the handler does NOT strip, drop, or
// filter rows that carry a forward-folded TpmsPressureFl. If a future
// refactor reintroduced a "skip rows without a fresh TpmsPressureFl
// emission" filter, this test would fail and the blank-dial bug would
// regress.
func TestTirePressure_History_CarriesForwardPressures(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 8, 0, 0, 0, time.UTC)
	// Three rows. Every row carries the same forward-folded front_left
	// pressure (35.2 psi) because the StateReader has already applied
	// carry-forward upstream. Other signals (front_right, rear_left)
	// shift across rows to mimic the real change-feed shape, but
	// front_left persists across all three.
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"front_left":  35.2,
			"front_right": 35.1,
			"rear_left":   34.9,
			"rear_right":  35.0,
		}},
		{Timestamp: t0.Add(24 * time.Hour), Fields: map[string]signal.SignalValue{
			"front_left":  35.2,
			"front_right": 35.0,
		}},
		{Timestamp: t0.Add(72 * time.Hour), Fields: map[string]signal.SignalValue{
			"front_left": 35.2,
			"rear_left":  34.8,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewTirePressureHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newTirePressureRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes one
	// row. A non-empty CollapseBy would drop "still 35.2 psi everywhere"
	// rows and break the TPMS history chart's stepped-line rendering.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(tirePressureMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(tirePressureMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	// THE BUG-FIX ASSERTION: every row must carry front_left = 35.2,
	// even rows that did not have a fresh TpmsPressureFl emission. In the
	// old pivot impl, rows[1] and rows[2] would have front_left=nil. With
	// forward-folding (now done by StateReader.Timeline upstream and
	// faithfully preserved by the handler), every row has the
	// carried-forward value.
	for i, row := range got {
		v, ok := row["front_left"]
		if !ok {
			t.Fatalf("row[%d] missing front_left key; row=%v", i, row)
		}
		f, isFloat := v.(float64)
		if !isFloat || f != 35.2 {
			t.Fatalf("row[%d].front_left = %#v, want 35.2 (forward-folded carry-forward)", i, v)
		}
		// Legacy field-name aliases must also be present so the existing
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

// TestTirePressure_Latest_UsesNow verifies that Latest derives the current
// TPMS snapshot from StateReader.State(time.Now()) — not from a
// rolling-window or session-anchored timestamp. Latest projects each
// mapped signal under its JSON field name; absent signals are omitted.
func TestTirePressure_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				"TpmsPressureFl": 35.2,
				"TpmsPressureFr": 35.1,
				"TpmsPressureRl": 34.9,
				"TpmsPressureRr": 35.0,
				// TpmsLastSeenPressureTime* intentionally absent to
				// confirm Latest omits unmapped-but-known signals.
			}, nil
		},
	}
	h := NewTirePressureHandler(fake, newTestLiveStateReader(fake))

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newTirePressureRequest("42", "/tire-pressure/latest?vehicle_id=42"))
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
	if v, ok := got["front_left"].(float64); !ok || v != 35.2 {
		t.Fatalf("front_left = %#v, want 35.2", got["front_left"])
	}
	if v, ok := got["front_right"].(float64); !ok || v != 35.1 {
		t.Fatalf("front_right = %#v, want 35.1", got["front_right"])
	}
	if v, ok := got["rear_left"].(float64); !ok || v != 34.9 {
		t.Fatalf("rear_left = %#v, want 34.9", got["rear_left"])
	}
	if v, ok := got["rear_right"].(float64); !ok || v != 35.0 {
		t.Fatalf("rear_right = %#v, want 35.0", got["rear_right"])
	}
	// Signals not present in the State must NOT appear in the response.
	if _, present := got["last_seen_fl"]; present {
		t.Fatalf("last_seen_fl unexpectedly present in response; got=%v", got)
	}
}

// TestTirePressure_PropagatesError verifies that BOTH endpoints surface
// upstream StateReader errors as HTTP 500, never as a silent 200 with an
// empty body. The legacy handler also returned 500 on Pivot/Snapshot
// failure; this test locks the contract for the migrated implementation.
func TestTirePressure_PropagatesError(t *testing.T) {
	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewTirePressureHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.List(rec, newTirePressureRequest("42", ""))

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
		h := NewTirePressureHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.Latest(rec, newTirePressureRequest("42", "/tire-pressure/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}
