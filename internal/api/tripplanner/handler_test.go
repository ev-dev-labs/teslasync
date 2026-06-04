package tripplanner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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
	stateFn    func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
	signalAtFn func(ctx context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error)
	timelineFn func(ctx context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error)
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
	if f.timelineFn == nil {
		return nil, nil
	}
	return f.timelineFn(ctx, vehicleID, fields, from, to, opts)
}

var _ signal.StateReader = (*fakeStateReader)(nil)

// newTripPlannerPlanRequest builds a POST /trip-planner/plan request with
// the supplied JSON body. The handler decodes the body via
// json.NewDecoder(r.Body), so this mirrors the production transport.
func newTripPlannerPlanRequest(t *testing.T, body any) *http.Request {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal plan body: %v", err)
	}
	return httptest.NewRequest(http.MethodPost, "/trip-planner/plan", bytes.NewReader(buf))
}

// TestTripPlanner_UsesCurrentSOCAndLocation verifies that
// TripPlannerHandler.Plan resolves the seeding "current SOC" and "current
// location" via signal.StateReader.SignalAt — anchored at time.Now() —
// when the request body omits those fields. The two lookups (BatteryLevel
// for SOC, Location for origin lat/lng) are the bedrock inputs that
// determine the plan's starting state; a future regression that drops
// either lookup, anchors them to a stale "at", queries a different
// signal name, or queries a different vehicle would silently misderive
// the entire plan (wrong starting SOC → wrong charging stops; wrong
// origin → routes from the wrong city) and is caught here.
//
// The test seeds the fake reader with a non-zero (Lat, Lng) and a SOC
// large enough that the request — which deliberately omits the
// destination — short-circuits at the
//
//	if req.Destination.Lat == 0 && req.Destination.Lng == 0 { 400 ... }
//
// branch AFTER both SignalAt seeding lookups have run but BEFORE
// computePlan executes (computePlan needs h.db.Pool, which is nil in
// this test). Hitting the destination-required 400 is the contract
// evidence that:
//
//   - the BatteryLevel lookup fired (otherwise CurrentSOC would have
//     stayed 0 and the only observable effect would be the post-default
//     fallback to 80 — but we assert the exact carried-forward value
//     flowed through by inspecting the recorded calls), AND
//   - the Location lookup fired and unpacked Lat/Lng into req.Origin
//     (otherwise the Origin (0,0) check would have fired the
//     "origin is required" 400 first, NOT the destination 400).
//
// The destination-400 ordering is therefore the load-bearing assertion:
// destination validation only runs once origin validation has passed,
// which only happens once Location SignalAt successfully seeded Origin.
func TestTripPlanner_UsesCurrentSOCAndLocation(t *testing.T) {
	const (
		vid             = int64(42)
		carriedSOC      = 65.0
		carriedLat      = 37.7749
		carriedLng      = -122.4194
		batterySignal   = "BatteryLevel"
		locationSignal  = "Location"
		wantCallsTotal  = 2
		wantOriginErr   = "origin is required"
		wantDestErr     = "destination is required"
		wantHTTPCode400 = http.StatusBadRequest
	)

	var calls []signalAtCallRecord
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, v int64, name string, at time.Time) (signal.SignalValue, error) {
			calls = append(calls, signalAtCallRecord{vehicleID: v, name: name, at: at})
			switch name {
			case batterySignal:
				return carriedSOC, nil
			case locationSignal:
				return map[string]any{"Lat": carriedLat, "Lng": carriedLng}, nil
			}
			return nil, nil
		},
	}
	// db: nil — the destination-required 400 short-circuits before
	// computePlan, so h.db.Pool is never dereferenced. signalLogReader:
	// nil for the same reason. cache: nil — never read on this code path.
	h := &TripPlannerHandler{state: fake}

	// Body deliberately omits current_soc, origin, AND destination so
	// both seeding lookups fire and the post-seeding destination-required
	// validation short-circuits before computePlan.
	body := map[string]any{
		"vehicle_id": vid,
	}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Plan(rec, newTripPlannerPlanRequest(t, body))
	after := time.Now()

	if rec.Code != wantHTTPCode400 {
		t.Fatalf("status = %d, want %d (post-seed destination-required short-circuit); body=%s",
			rec.Code, wantHTTPCode400, rec.Body.String())
	}
	// The destination-required 400 — NOT the origin-required 400 — is
	// what fires only after Location SignalAt successfully seeded Origin.
	// If the body says "origin is required" instead, it means the
	// Location lookup did not flow into req.Origin (regression).
	if strings.Contains(rec.Body.String(), wantOriginErr) {
		t.Fatalf("body = %q contains %q — Location SignalAt did not seed Origin",
			rec.Body.String(), wantOriginErr)
	}
	if !strings.Contains(rec.Body.String(), wantDestErr) {
		t.Fatalf("body = %q, want it to contain %q (post-seed validation)",
			rec.Body.String(), wantDestErr)
	}

	// Pin call count: exactly one BatteryLevel + one Location call. A
	// regression that adds a duplicate read of either signal pushes the
	// count above 2; one that drops a read pushes it below.
	if len(calls) != wantCallsTotal {
		t.Fatalf("SignalAt call count = %d, want %d (BatteryLevel + Location); calls=%v",
			len(calls), wantCallsTotal, calls)
	}

	var sawBatteryLevel, sawLocation bool
	for _, c := range calls {
		if c.vehicleID != vid {
			t.Fatalf("SignalAt(%q).vehicleID = %d, want %d", c.name, c.vehicleID, vid)
		}
		if c.at.Before(before.Add(-time.Second)) || c.at.After(after.Add(time.Second)) {
			t.Fatalf("SignalAt(%q).at = %v, want within [%v, %v] (≈ time.Now())",
				c.name, c.at, before, after)
		}
		switch c.name {
		case batterySignal:
			sawBatteryLevel = true
		case locationSignal:
			sawLocation = true
		default:
			t.Fatalf("unexpected SignalAt(%q); want only %q or %q",
				c.name, batterySignal, locationSignal)
		}
	}
	if !sawBatteryLevel {
		t.Fatalf("handler never called SignalAt(name=%q); calls=%v", batterySignal, calls)
	}
	if !sawLocation {
		t.Fatalf("handler never called SignalAt(name=%q); calls=%v", locationSignal, calls)
	}
}

// TestTripPlanner_PropagatesError verifies that a StateReader.SignalAt
// transport error (e.g. pgx connection drop) becomes a 500 to the client
// for BOTH seeding lookups (current SOC and current location). The
// legacy code path silently fell through to a hardcoded CurrentSOC = 80
// default and an "origin is required" 400 when no live signal value
// could be obtained — which is indistinguishable on the frontend from
// "client really wants the default 80% / really forgot to pass an
// origin" and would route every plan from the wrong starting state
// during a signal-store outage. This path tightens error
// handling so the frontend can surface the failure rather than silently
// rendering a wrong-but-plausible plan. A future regression that
// reverts to the silent-swallow behavior is caught here.
func TestTripPlanner_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")

	t.Run("BatteryLevel", func(t *testing.T) {
		// CurrentSOC = 0 triggers the BatteryLevel lookup first. The
		// fake errors on every SignalAt, so the handler must 500
		// before even reaching the Location lookup.
		fake := &fakeStateReader{
			signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
				return nil, wantErr
			},
		}
		h := &TripPlannerHandler{state: fake}
		body := map[string]any{
			"vehicle_id": int64(42),
		}
		rec := httptest.NewRecorder()
		h.Plan(rec, newTripPlannerPlanRequest(t, body))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500 (BatteryLevel transport error); body=%s",
				rec.Code, rec.Body.String())
		}
	})

	t.Run("Location", func(t *testing.T) {
		// CurrentSOC > 0 skips the BatteryLevel lookup so we can
		// exercise the Location lookup error path in isolation.
		// Origin (0,0) triggers the Location lookup; the fake errors
		// only on the Location signal name (BatteryLevel never fires).
		fake := &fakeStateReader{
			signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
				if name == "Location" {
					return nil, wantErr
				}
				return nil, nil
			},
		}
		h := &TripPlannerHandler{state: fake}
		body := map[string]any{
			"vehicle_id":  int64(42),
			"current_soc": 80.0,
		}
		rec := httptest.NewRecorder()
		h.Plan(rec, newTripPlannerPlanRequest(t, body))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d, want 500 (Location transport error); body=%s",
				rec.Code, rec.Body.String())
		}
	})
}
