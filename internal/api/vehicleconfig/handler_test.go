package vehicleconfig

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

// newVehicleConfigRequest builds an *http.Request for the
// /vehicle-config handlers with vehicle_id pre-encoded.
func newVehicleConfigRequest(vehicleID, target string) *http.Request {
	if target == "" {
		target = "/vehicle-config?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

// TestVehicleConfig_History_CarriesForwardModel is the carry-forward
// proof for the phase-39 vehicle_config_handler migration's List
// endpoint.
//
// VehicleConfig is a COMPOUND JSON signal (car_type, trim_badging,
// exterior_color, wheel_type, ...) emitted by Tesla Fleet Telemetry
// only when the configuration actually changes — practically never.
// A car delivered as a Model Y Long Range with 19" Geminis in Pearl
// White emits VehicleConfig once at delivery and then never again
// unless the owner repaints, retrofits new wheels, or applies a
// software-tier upgrade. The signal can sit unchanged for the entire
// vehicle lifetime.
//
// Under the legacy raw-pivot SignalTracePivotFlat, a /vehicle-config
// history call against such a vehicle would project NULL config on
// every row in the lookback window, even though the configuration is
// perfectly known. With StateReader.Timeline forward-folding the
// change feed, the most recent emission carries forward to every
// later row.
//
// This test asserts:
//
//  1. The handler invokes Timeline exactly once with the
//     vehicleConfigMappings projection (single VehicleConfig signal).
//  2. The handler asks for CHART MODE (empty CollapseBy) so every
//     change-feed emission becomes one row. A non-empty CollapseBy
//     would coalesce consecutive identical-config rows into a single
//     "still the same" row and break the per-emission resolution of
//     the config-history view.
//  3. The handler does NOT strip, drop, or filter rows that carry
//     forward-folded values — every TimelineRow becomes one response
//     row with the legacy created_at / id aliases preserved.
//  4. The compound JSON payload is FLATTENED to top-level keys
//     (car_type, trim_badging, exterior_color, wheel_type) on every
//     row — the intermediate "config" projection key MUST NOT leak
//     into the response, and forward-folded config values appear on
//     every row even when VehicleConfig did not re-emit in that bucket.
//     A row with NULL car_type would silently mislead the dashboard
//     about which model the car is, breaking every per-model spec
//     calculation downstream.
func TestVehicleConfig_History_CarriesForwardModel(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 9, 0, 0, 0, time.UTC)
	// The first row carries the originally-emitted VehicleConfig JSON
	// payload (delivery-time emission). The next two rows are
	// forward-folded: VehicleConfig did NOT re-emit, but Timeline
	// projects the carried-forward value so the wire row still has the
	// full compound payload.
	configPayload := map[string]interface{}{
		"car_type":       "modely",
		"trim_badging":   "74d",
		"exterior_color": "PearlWhite",
		"wheel_type":     "Gemini19",
	}
	folded := []signal.TimelineRow{
		{Timestamp: t0, Fields: map[string]signal.SignalValue{
			"config": configPayload,
		}},
		{Timestamp: t0.Add(60 * time.Second), Fields: map[string]signal.SignalValue{
			"config": configPayload,
		}},
		{Timestamp: t0.Add(120 * time.Second), Fields: map[string]signal.SignalValue{
			"config": configPayload,
		}},
	}
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return folded, nil
		},
	}
	h := NewHandler(fake, newTestLiveStateReader(fake))

	rec := httptest.NewRecorder()
	h.List(rec, newVehicleConfigRequest("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// Chart mode contract: empty CollapseBy so every emission becomes
	// one row. A non-empty CollapseBy would collapse identical
	// "still the same config" runs into a single row and break the
	// config-history view's per-emission resolution.
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if len(fake.gotTimelineFields) != len(vehicleConfigMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(vehicleConfigMappings))
	}
	if fake.gotTimelineFields[0].Signal != "VehicleConfig" {
		t.Fatalf("Timeline fields[0].Signal = %q, want \"VehicleConfig\"", fake.gotTimelineFields[0].Signal)
	}

	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != len(folded) {
		t.Fatalf("response row count = %d, want %d (forward-folded rows must NOT be dropped)", len(got), len(folded))
	}
	for i, row := range got {
		// Every row must carry the FLATTENED compound payload at top
		// level — under the old raw-pivot impl, only the row with a
		// fresh VehicleConfig emission would have these populated,
		// leaving the rest with NULL config and silently misleading
		// the dashboard about which model the car is.
		if v, ok := row["car_type"].(string); !ok || v != "modely" {
			t.Fatalf("row[%d].car_type = %#v, want \"modely\" (forward-folded carry-forward, flattened)", i, row["car_type"])
		}
		if v, ok := row["trim_badging"].(string); !ok || v != "74d" {
			t.Fatalf("row[%d].trim_badging = %#v, want \"74d\" (forward-folded carry-forward, flattened)", i, row["trim_badging"])
		}
		if v, ok := row["exterior_color"].(string); !ok || v != "PearlWhite" {
			t.Fatalf("row[%d].exterior_color = %#v, want \"PearlWhite\" (forward-folded carry-forward, flattened)", i, row["exterior_color"])
		}
		if v, ok := row["wheel_type"].(string); !ok || v != "Gemini19" {
			t.Fatalf("row[%d].wheel_type = %#v, want \"Gemini19\" (forward-folded carry-forward, flattened)", i, row["wheel_type"])
		}
		// The intermediate "config" projection key MUST NOT leak into
		// the response — it is an internal flattening pivot only.
		if _, present := row["config"]; present {
			t.Fatalf("row[%d] unexpectedly contains \"config\" key (must be flattened to top level); row=%v", i, row)
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

// TestVehicleConfig_Latest_UsesNow is the carry-forward proof for the
// vehicle-config Latest endpoint and the wire-up proof that Latest
// anchors on time.Now() rather than a rolling lookback window.
//
// The legacy SnapshotAt against a vehicle whose VehicleConfig last
// emitted at delivery (months or years ago) would return an EMPTY
// object, silently breaking every downstream per-model spec lookup
// (battery capacity, EPA range, tire size, motor topology). With
// StateReader.State forward-folding the change feed, the most recent
// VehicleConfig emission is carried forward to time.Now().
//
// This test:
//
//  1. Confirms Latest invokes State at ≈ time.Now() (NOT a rolling
//     window or session-anchored timestamp), with the supplied
//     vehicle_id. A rolling-window anchor would re-introduce the very
//     "no config known" bug this migration fixes.
//  2. Simulates a State response that contains a stable VehicleConfig
//     JSON payload forward-folded from a delivery emission years ago.
//  3. Asserts the response FLATTENS the compound payload to top-level
//     keys (car_type, trim_badging, exterior_color, wheel_type) and
//     does NOT leak the intermediate "config" projection key.
//  4. Confirms that the raw signal name "VehicleConfig" does NOT leak
//     into the response.
func TestVehicleConfig_Latest_UsesNow(t *testing.T) {
	var gotAt time.Time
	var gotVehicleID int64
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			stateCalls++
			gotAt = at
			gotVehicleID = vid
			return signal.State{
				// Stable compound config forward-folded from a
				// delivery-time emission years ago — the canonical
				// reason this migration matters.
				"VehicleConfig": map[string]interface{}{
					"car_type":       "models",
					"trim_badging":   "p100d",
					"exterior_color": "MidnightSilver",
					"wheel_type":     "Arachnid21",
				},
			}, nil
		},
	}
	h := NewHandler(fake, newTestLiveStateReader(fake))

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Latest(rec, newVehicleConfigRequest("42", "/vehicle-config/latest?vehicle_id=42"))
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
	// Allow a 1-second tolerance window around the wall-clock
	// observation. Latest MUST anchor on time.Now(), NOT a rolling
	// window — a rolling-window anchor would re-introduce the very
	// "no config known" bug this migration fixes.
	if gotAt.Before(before.Add(-time.Second)) || gotAt.After(after.Add(time.Second)) {
		t.Fatalf("State.at = %v, want within [%v, %v] (≈ time.Now())", gotAt, before, after)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	// CRITICAL config contract: the compound payload MUST be flattened
	// to top-level keys in the response — the frontend reads car_type
	// / trim_badging / exterior_color / wheel_type directly. A nested
	// "config" envelope here would silently break every per-model spec
	// calculation downstream.
	if v, ok := got["car_type"].(string); !ok || v != "models" {
		t.Fatalf("car_type = %#v, want \"models\" (flattened from forward-folded VehicleConfig)", got["car_type"])
	}
	if v, ok := got["trim_badging"].(string); !ok || v != "p100d" {
		t.Fatalf("trim_badging = %#v, want \"p100d\" (flattened from forward-folded VehicleConfig)", got["trim_badging"])
	}
	if v, ok := got["exterior_color"].(string); !ok || v != "MidnightSilver" {
		t.Fatalf("exterior_color = %#v, want \"MidnightSilver\" (flattened from forward-folded VehicleConfig)", got["exterior_color"])
	}
	if v, ok := got["wheel_type"].(string); !ok || v != "Arachnid21" {
		t.Fatalf("wheel_type = %#v, want \"Arachnid21\" (flattened from forward-folded VehicleConfig)", got["wheel_type"])
	}
	// The intermediate "config" projection key MUST NOT leak into the
	// response — it is an internal flattening pivot only.
	if _, present := got["config"]; present {
		t.Fatalf("\"config\" envelope unexpectedly present in response (must be flattened); got=%v", got)
	}
	// Raw signal name "VehicleConfig" must NOT leak into the response —
	// only the flattened payload keys.
	if _, present := got["VehicleConfig"]; present {
		t.Fatalf("raw signal VehicleConfig unexpectedly present in response; got=%v", got)
	}
}

// TestVehicleConfig_PropagatesError verifies that BOTH endpoints
// surface upstream StateReader errors as HTTP 500, never as a silent
// 200 with an empty body. The legacy handler also returned 500 on
// Pivot / Snapshot failure; this test locks the contract for the
// migrated implementation. A silent-empty 200 here would render every
// per-model spec calculation downstream with default values on every
// transient pgx blip — silently mislabeling the car's model and being
// indistinguishable from a real "we have no config" condition.
func TestVehicleConfig_PropagatesError(t *testing.T) {
	t.Run("List_TimelineError", func(t *testing.T) {
		wantErr := errors.New("simulated pgx connection lost on Timeline")
		fake := &fakeStateReader{
			timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
				return nil, wantErr
			},
		}
		h := NewHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.List(rec, newVehicleConfigRequest("42", ""))

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
		h := NewHandler(fake, newTestLiveStateReader(fake))

		rec := httptest.NewRecorder()
		h.Latest(rec, newVehicleConfigRequest("42", "/vehicle-config/latest?vehicle_id=42"))

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
		}
	})
}

// fakeStateReader / newTestLiveStateReader are duplicated from
// internal/api/media_handler_test.go for the duration of Phase R2;
// subpackage tests can't import parent test fixtures. The full version
// (captured Timeline opts + fields) is required by the chart-mode
// assertions below.
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
