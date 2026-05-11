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

// newSafetyRequest builds an *http.Request for the /safety handlers with
// vehicle_id pre-encoded.
func newSafetyRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/safety?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestSafetyHandler_History_CarriesForwardEnableFlags is the wire-up +
// carry-forward proof for the phase-39 safety-handler migration.
//
// ADAS / Autopilot enable flags (AutomaticEmergencyBrakingOff,
// LaneDepartureAvoidance, ForwardCollisionWarning, PinToDriveEnabled, …)
// are user-configured driver-assist toggles that VERY rarely change —
// often once at vehicle delivery and never again. Under the legacy
// raw-pivot implementation, every history row whose bucket did not contain
// a fresh emission for one of these flags rendered that column as NULL,
// leaving the safety-history table almost entirely blank for any vehicle
// with stable ADAS settings. This test simulates the forward-folded output
// StateReader.Timeline produces in chart mode (empty CollapseBy) — every
// row carries the most-recent value of every projected signal — and
// asserts:
//
//  1. The handler invokes Timeline exactly once with the full
//     safetyMappings field projection.
//  2. The handler asks for CHART MODE (empty CollapseBy) so every
//     change-feed emission becomes one row; a non-empty CollapseBy would
//     drop "still-enabled everywhere" rows and break the safety history
//     table's per-row reading of every ADAS flag.
//  3. The handler does NOT strip, drop, or filter rows that carry only
//     forward-folded values — every TimelineRow becomes one response row
//     with the legacy created_at / id aliases preserved.
//  4. Forward-folded ADAS enable flags (e.g. lane_departure_avoidance,
//     forward_collision_warning, pin_to_drive_enabled) MUST appear on
//     every row, never as a null/missing key — the absence of a recent
//     emission must NEVER be misread as the feature being disabled.
func TestSafetyHandler_History_CarriesForwardEnableFlags(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"automatic_emergency_braking_off":    false,
			"lane_departure_avoidance":           "WARN",
			"forward_collision_warning":          "MEDIUM",
			"pin_to_drive_enabled":               true,
			"cruise_follow_distance":             3.0,
			"miles_since_reset":                  1234.5,
			"self_driving_miles_since_reset":     500.0,
		}},
		{Timestamp: t0.Add(30 * time.Second), Fields: map[string]signal.SignalValue{
			"automatic_emergency_braking_off":    false,
			"lane_departure_avoidance":           "WARN",
			"forward_collision_warning":          "MEDIUM",
			"pin_to_drive_enabled":               true,
			"cruise_follow_distance":             3.0,
			"miles_since_reset":                  1240.0,
			"self_driving_miles_since_reset":     505.0,
		}},
		{Timestamp: t0.Add(60 * time.Second), Fields: map[string]signal.SignalValue{
			"automatic_emergency_braking_off":    false,
			"lane_departure_avoidance":           "WARN",
			"forward_collision_warning":          "MEDIUM",
			"pin_to_drive_enabled":               true,
			"cruise_follow_distance":             3.0,
			"miles_since_reset":                  1245.5,
			"self_driving_miles_since_reset":     510.0,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewSafetyHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newSafetyRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes one
	// row. A non-empty CollapseBy would collapse identical "still
	// enabled" runs into a single row and break the safety-history
	// table's per-row reading of every ADAS flag.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(safetyMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(safetyMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	for i, row := range got {
		// Every row must carry the forward-folded ADAS enable flags;
		// in the old pivot impl, only the row with a fresh emission
		// would have these populated, leaving the rest as NULL.
		if v, ok := row["lane_departure_avoidance"].(string); !ok || v != "WARN" {
			t.Fatalf("row[%d].lane_departure_avoidance = %#v, want \"WARN\" (forward-folded carry-forward)", i, row["lane_departure_avoidance"])
		}
		if v, ok := row["forward_collision_warning"].(string); !ok || v != "MEDIUM" {
			t.Fatalf("row[%d].forward_collision_warning = %#v, want \"MEDIUM\" (forward-folded carry-forward)", i, row["forward_collision_warning"])
		}
		if v, ok := row["pin_to_drive_enabled"].(bool); !ok || v != true {
			t.Fatalf("row[%d].pin_to_drive_enabled = %#v, want true (forward-folded carry-forward)", i, row["pin_to_drive_enabled"])
		}
		// CRITICAL safety contract: a "false" enable flag must round-trip
		// as a literal false, NOT be coerced to null/missing — the absence
		// of a key must NEVER be misread as the feature being disabled.
		v, present := row["automatic_emergency_braking_off"]
		if !present {
			t.Fatalf("row[%d] missing automatic_emergency_braking_off; row=%v", i, row)
		}
		if b, ok := v.(bool); !ok || b != false {
			t.Fatalf("row[%d].automatic_emergency_braking_off = %#v, want false", i, v)
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

// TestSafetyHandler_Latest_UsesNow verifies that Latest derives the
// current safety / ADAS snapshot from StateReader.State(time.Now()) —
// not from a rolling-window or session-anchored timestamp. Latest
// projects each mapped signal under its JSON field name; absent signals
// are omitted (e.g. a vehicle whose firmware has never reported
// SelfDrivingMilesSinceReset will not have that key in the response).
func TestSafetyHandler_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				"AutomaticEmergencyBrakingOff":    false,
				"LaneDepartureAvoidance":          "WARN",
				"ForwardCollisionWarning":         "MEDIUM",
				"PinToDriveEnabled":               true,
				"CruiseFollowDistance":            3.0,
				"SpeedLimitWarning":               "DISPLAY",
				"MilesSinceReset":                 1234.5,
				// SelfDrivingMilesSinceReset / AutomaticBlindSpotCamera /
				// BlindSpotCollisionWarningChime /
				// EmergencyLaneDepartureAvoidance intentionally absent
				// to confirm Latest omits unmapped-but-known signals.
			}, nil
		},
	}
	h := NewSafetyHandler(fake, newTestLiveStateReader(fake))

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newSafetyRequest("42", "/safety/latest?vehicle_id=42"))
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
	// name; the snake_case Field side of safetyMappings.
	if v, ok := got["lane_departure_avoidance"].(string); !ok || v != "WARN" {
		t.Fatalf("lane_departure_avoidance = %#v, want \"WARN\"", got["lane_departure_avoidance"])
	}
	if v, ok := got["forward_collision_warning"].(string); !ok || v != "MEDIUM" {
		t.Fatalf("forward_collision_warning = %#v, want \"MEDIUM\"", got["forward_collision_warning"])
	}
	if v, ok := got["pin_to_drive_enabled"].(bool); !ok || v != true {
		t.Fatalf("pin_to_drive_enabled = %#v, want true", got["pin_to_drive_enabled"])
	}
	if v, ok := got["speed_limit_warning"].(string); !ok || v != "DISPLAY" {
		t.Fatalf("speed_limit_warning = %#v, want \"DISPLAY\"", got["speed_limit_warning"])
	}
	if v, ok := got["cruise_follow_distance"].(float64); !ok || v != 3.0 {
		t.Fatalf("cruise_follow_distance = %#v, want 3.0", got["cruise_follow_distance"])
	}
	if v, ok := got["miles_since_reset"].(float64); !ok || v != 1234.5 {
		t.Fatalf("miles_since_reset = %#v, want 1234.5", got["miles_since_reset"])
	}
	// CRITICAL safety contract: a "false" enable flag must round-trip as
	// a literal false, NOT be coerced to null/missing — the absence of a
	// key must NEVER be misread as the feature being disabled.
	v, present := got["automatic_emergency_braking_off"]
	if !present {
		t.Fatalf("automatic_emergency_braking_off missing from response; got=%v", got)
	}
	if b, ok := v.(bool); !ok || b != false {
		t.Fatalf("automatic_emergency_braking_off = %#v, want false", v)
	}
	// Signals not present in the State must NOT appear in the response.
	if _, present := got["self_driving_miles_since_reset"]; present {
		t.Fatalf("self_driving_miles_since_reset unexpectedly present in response; got=%v", got)
	}
	if _, present := got["automatic_blind_spot_camera"]; present {
		t.Fatalf("automatic_blind_spot_camera unexpectedly present in response; got=%v", got)
	}
	if _, present := got["emergency_lane_departure_avoidance"]; present {
		t.Fatalf("emergency_lane_departure_avoidance unexpectedly present in response; got=%v", got)
	}
	// Raw signal names (the Signal side of safetyMappings) must NOT
	// leak into the response — only the projected Field names.
	if _, present := got["LaneDepartureAvoidance"]; present {
		t.Fatalf("raw signal LaneDepartureAvoidance unexpectedly present in response; got=%v", got)
	}
	if _, present := got["PinToDriveEnabled"]; present {
		t.Fatalf("raw signal PinToDriveEnabled unexpectedly present in response; got=%v", got)
	}
}

// TestSafetyHandler_PropagatesError verifies that BOTH endpoints surface
// upstream StateReader errors as HTTP 500, never as a silent 200 with an
// empty body. The legacy handler also returned 500 on Pivot/Snapshot
// failure; this test locks the contract for the migrated implementation.
func TestSafetyHandler_PropagatesError(t *testing.T) {
	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewSafetyHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.List(rec, newSafetyRequest("42", ""))

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
		h := NewSafetyHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.Latest(rec, newSafetyRequest("42", "/safety/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}
