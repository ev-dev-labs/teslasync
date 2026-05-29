package security

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

// fakeStateReader is a hand-rolled signal.StateReader for handler tests.
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

func newTestLiveStateReader(state signal.StateReader) signal.LiveStateReader {
	return signal.MustNewLiveStateReader(signal.NewNoopLiveSignalStore(), state)
}

// newSecurityRequest builds an *http.Request for the /security handlers with
// vehicle_id pre-encoded.
func newSecurityRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/security?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestSecurityHandler_History_CarriesForwardLockState is the wire-up +
// carry-forward proof for the phase-39 security-handler migration.
//
// Lock state, sentry mode, valet mode, service mode, guest mode and the
// per-door / per-window position flags are user-controlled or
// vehicle-state signals that change RARELY relative to the chart bucket
// cadence — a parked, locked car may emit Locked once at park and never
// again until the driver returns. Under the legacy raw-pivot
// implementation, every history row whose bucket did not contain a fresh
// emission for one of these signals rendered that column as NULL,
// leaving the security-history table almost entirely blank for any
// vehicle with stable lock / sentry / mode settings. This test simulates
// the forward-folded output StateReader.Timeline produces in chart mode
// (empty CollapseBy) — every row carries the most-recent value of every
// projected signal — and asserts:
//
//  1. The handler invokes Timeline exactly once with the full
//     securityMappings field projection.
//  2. The handler asks for CHART MODE (empty CollapseBy) so every
//     change-feed emission becomes one row; a non-empty CollapseBy would
//     drop "still-locked everywhere" rows and break the security history
//     table's per-row reading of every lock / sentry / window flag.
//  3. The handler does NOT strip, drop, or filter rows that carry only
//     forward-folded values — every TimelineRow becomes one response row
//     with the legacy created_at / id aliases preserved.
//  4. Forward-folded lock / sentry / valet / service flags (e.g.
//     locked, sentry_mode, valet_mode_enabled) MUST appear on every row,
//     never as a null/missing key — the absence of a recent emission
//     must NEVER be misread as the vehicle being unlocked, sentry off,
//     or valet disabled.
func TestSecurityHandler_History_CarriesForwardLockState(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"locked":              true,
			"sentry_mode":         "On",
			"door_state":          "Closed",
			"valet_mode_enabled":  false,
			"service_mode":        false,
			"guest_mode":          false,
			"driver_seat_belt":    true,
			"passenger_seat_belt": false,
		}},
		{Timestamp: t0.Add(30 * time.Second), Fields: map[string]signal.SignalValue{
			"locked":              true,
			"sentry_mode":         "On",
			"door_state":          "Closed",
			"valet_mode_enabled":  false,
			"service_mode":        false,
			"guest_mode":          false,
			"driver_seat_belt":    true,
			"passenger_seat_belt": false,
		}},
		{Timestamp: t0.Add(60 * time.Second), Fields: map[string]signal.SignalValue{
			"locked":              true,
			"sentry_mode":         "On",
			"door_state":          "Closed",
			"valet_mode_enabled":  false,
			"service_mode":        false,
			"guest_mode":          false,
			"driver_seat_belt":    true,
			"passenger_seat_belt": false,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewSecurityHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newSecurityRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes one
	// row. A non-empty CollapseBy would collapse identical "still
	// locked" runs into a single row and break the security-history
	// table's per-row reading of every lock / sentry / window flag.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(securityMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(securityMappings))
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	for i, row := range got {
		// Every row must carry the forward-folded lock / sentry flags;
		// in the old pivot impl, only the row with a fresh emission
		// would have these populated, leaving the rest as NULL.
		if v, ok := row["locked"].(bool); !ok || v != true {
			t.Fatalf("row[%d].locked = %#v, want true (forward-folded carry-forward)", i, row["locked"])
		}
		if v, ok := row["sentry_mode"].(string); !ok || v != "On" {
			t.Fatalf("row[%d].sentry_mode = %#v, want \"On\" (forward-folded carry-forward)", i, row["sentry_mode"])
		}
		if v, ok := row["door_state"].(string); !ok || v != "Closed" {
			t.Fatalf("row[%d].door_state = %#v, want \"Closed\" (forward-folded carry-forward)", i, row["door_state"])
		}
		// CRITICAL security contract: a "false" flag must round-trip
		// as a literal false, NOT be coerced to null/missing — the
		// absence of a key must NEVER be misread as the feature being
		// in some other state (e.g. valet disabled rendering as
		// "unknown" could mask an actual valet-mode toggle).
		v, present := row["valet_mode_enabled"]
		if !present {
			t.Fatalf("row[%d] missing valet_mode_enabled; row=%v", i, row)
		}
		if b, ok := v.(bool); !ok || b != false {
			t.Fatalf("row[%d].valet_mode_enabled = %#v, want false", i, v)
		}
		v, present = row["passenger_seat_belt"]
		if !present {
			t.Fatalf("row[%d] missing passenger_seat_belt; row=%v", i, row)
		}
		if b, ok := v.(bool); !ok || b != false {
			t.Fatalf("row[%d].passenger_seat_belt = %#v, want false", i, v)
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

// TestSecurityHandler_Latest_UsesNow verifies that Latest derives the
// current security / access snapshot from StateReader.State(time.Now())
// — not from a rolling-window or session-anchored timestamp. Latest
// projects each mapped signal under its JSON field name; absent signals
// are omitted (e.g. a vehicle whose firmware has never reported
// HomelinkDeviceCount will not have that key in the response).
func TestSecurityHandler_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				"Locked":            true,
				"SentryMode":        "On",
				"DoorState":         "Closed",
				"ValetModeEnabled":  false,
				"ServiceMode":       false,
				"GuestModeEnabled":  false,
				"DriverSeatBelt":    true,
				"PassengerSeatBelt": false,
				"CenterDisplay":     "Standby",
				// HomelinkDeviceCount, HomelinkNearby, FdWindow, FpWindow,
				// RdWindow, RpWindow intentionally absent to confirm
				// Latest omits unmapped-but-known signals.
			}, nil
		},
	}
	h := NewSecurityHandler(fake, newTestLiveStateReader(fake))

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newSecurityRequest("42", "/security/latest?vehicle_id=42"))
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
	// name; the snake_case Field side of securityMappings.
	if v, ok := got["locked"].(bool); !ok || v != true {
		t.Fatalf("locked = %#v, want true", got["locked"])
	}
	if v, ok := got["sentry_mode"].(string); !ok || v != "On" {
		t.Fatalf("sentry_mode = %#v, want \"On\"", got["sentry_mode"])
	}
	if v, ok := got["door_state"].(string); !ok || v != "Closed" {
		t.Fatalf("door_state = %#v, want \"Closed\"", got["door_state"])
	}
	if v, ok := got["center_display"].(string); !ok || v != "Standby" {
		t.Fatalf("center_display = %#v, want \"Standby\"", got["center_display"])
	}
	if v, ok := got["driver_seat_belt"].(bool); !ok || v != true {
		t.Fatalf("driver_seat_belt = %#v, want true", got["driver_seat_belt"])
	}
	// CRITICAL security contract: a "false" flag must round-trip as a
	// literal false, NOT be coerced to null/missing — the absence of a
	// key must NEVER be misread as some other state.
	v, present := got["valet_mode_enabled"]
	if !present {
		t.Fatalf("valet_mode_enabled missing from response; got=%v", got)
	}
	if b, ok := v.(bool); !ok || b != false {
		t.Fatalf("valet_mode_enabled = %#v, want false", v)
	}
	v, present = got["service_mode"]
	if !present {
		t.Fatalf("service_mode missing from response; got=%v", got)
	}
	if b, ok := v.(bool); !ok || b != false {
		t.Fatalf("service_mode = %#v, want false", v)
	}
	// Signals not present in the State must NOT appear in the response.
	if _, present := got["homelink_device_count"]; present {
		t.Fatalf("homelink_device_count unexpectedly present in response; got=%v", got)
	}
	if _, present := got["homelink_nearby"]; present {
		t.Fatalf("homelink_nearby unexpectedly present in response; got=%v", got)
	}
	if _, present := got["fd_window"]; present {
		t.Fatalf("fd_window unexpectedly present in response; got=%v", got)
	}
	// Raw signal names (the Signal side of securityMappings) must NOT
	// leak into the response — only the projected Field names.
	if _, present := got["Locked"]; present {
		t.Fatalf("raw signal Locked unexpectedly present in response; got=%v", got)
	}
	if _, present := got["SentryMode"]; present {
		t.Fatalf("raw signal SentryMode unexpectedly present in response; got=%v", got)
	}
}

// TestSecurityHandler_PropagatesError verifies that BOTH endpoints surface
// upstream StateReader errors as HTTP 500, never as a silent 200 with an
// empty body. The legacy handler also returned 500 on Pivot/Snapshot
// failure; this test locks the contract for the migrated implementation.
func TestSecurityHandler_PropagatesError(t *testing.T) {
	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewSecurityHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.List(rec, newSecurityRequest("42", ""))

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
		h := NewSecurityHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.Latest(rec, newSecurityRequest("42", "/security/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}
