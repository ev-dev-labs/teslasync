package chargeplanner

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

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

// newChargePlannerOptimizeRequest builds a POST /charge-planner/optimize
// request with the supplied JSON body. The handler decodes the body via
// json.NewDecoder(r.Body), so this mirrors the production transport.
func newChargePlannerOptimizeRequest(t *testing.T, body any) *http.Request {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal optimize body: %v", err)
	}
	return httptest.NewRequest(http.MethodPost, "/charge-planner/optimize", bytes.NewReader(buf))
}

// TestChargePlanner_UsesCurrentSOC verifies that Handler.Optimize
// resolves the seeding "current SOC" via signal.StateReader.SignalAt with
// signal name "BatteryLevel" anchored at time.Now — the lookup that
// determines how much energy the optimizer must schedule. A future
// regression that re-points the lookup at the deleted
// signaldb.SignalLogReader.SignalAt helper, drops the "BatteryLevel"
// signal name, anchors the read to a stale "at", or queries a different
// vehicle would silently misderive the kWh-needed projection (and
// therefore the entire schedule + cost comparison) without surfacing any
// error and is caught here.
//
// The test seeds the fake reader with currentSOC = 60 and requests
// target_soc = 50, which exercises the early-return path
//
//	if currentSOC >= req.TargetSOC { httpx.WriteError(... 400 ...) }
//
// — that branch fires only when the SignalAt-derived currentSOC was
// actually plumbed into the comparison, so the 400 + the message text
// echoing the carried-forward "60%" is the contract evidence that the
// new state.SignalAt path produced the value.
func TestChargePlanner_UsesCurrentSOC(t *testing.T) {
	const (
		vid           = int64(42)
		carriedSOC    = 60.0
		targetSOC     = 50
		batterySignal = "BatteryLevel"
	)

	var calls []signalAtCallRecord
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, v int64, name string, at time.Time) (signal.SignalValue, error) {
			calls = append(calls, signalAtCallRecord{vehicleID: v, name: name, at: at})
			if name == batterySignal {
				return carriedSOC, nil
			}
			return nil, nil
		},
	}
	// db: nil — the carried-forward currentSOC (60) already exceeds the
	// requested target (50), so the handler short-circuits at the
	// "current SOC already meets target" branch before any
	// chargingdb.NewChargePlanRepo call. teslaClient/cfg: nil for the
	// same reason.
	h := &Handler{state: fake}

	body := optimizeRequest{
		VehicleID:  vid,
		TargetSOC:  targetSOC,
		DepartBy:   time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
		RatePlanID: "pge-ev2a",
	}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Optimize(rec, newChargePlannerOptimizeRequest(t, body))
	after := time.Now()

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (currentSOC %.0f >= targetSOC %d short-circuit); body=%s",
			rec.Code, carriedSOC, targetSOC, rec.Body.String())
	}
	// The error message echoes the SignalAt-derived currentSOC, proving
	// the value flowed from state.SignalAt into the comparison.
	if !strings.Contains(rec.Body.String(), "60%") {
		t.Fatalf("body = %q, want it to echo carried-forward currentSOC=60%%", rec.Body.String())
	}

	var sawBatteryLevel bool
	for _, c := range calls {
		if c.name != batterySignal {
			continue
		}
		sawBatteryLevel = true
		if c.vehicleID != vid {
			t.Fatalf("SignalAt(%q).vehicleID = %d, want %d", c.name, c.vehicleID, vid)
		}
		if c.at.Before(before.Add(-time.Second)) || c.at.After(after.Add(time.Second)) {
			t.Fatalf("SignalAt(%q).at = %v, want within [%v, %v] (≈ time.Now())", c.name, c.at, before, after)
		}
	}
	if !sawBatteryLevel {
		t.Fatalf("handler never called SignalAt(name=%q); calls=%v", batterySignal, calls)
	}
}

// TestChargePlanner_PropagatesError verifies that a StateReader.SignalAt
// transport error (e.g. pgx connection drop) becomes a 500 to the client
// for the Optimize endpoint. The legacy signaldb.SignalLogReader-backed
// handler silently swallowed SignalAt errors and defaulted currentSOC to
// 0 — which made every optimize request appear to need a full charge
// from empty, masking real signal-store / pgx outages behind plausible-
// looking (but wrong) charge windows and inflated cost estimates. This
// test locks in stricter error handling so the frontend can surface
// the failure rather than silently rendering a "charge from 0%" plan. A
// future regression that reverts to the silent-swallow behavior is
// caught here.
func TestChargePlanner_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &Handler{state: fake}

	body := optimizeRequest{
		VehicleID:  42,
		TargetSOC:  80,
		DepartBy:   time.Now().Add(8 * time.Hour).UTC().Format(time.RFC3339),
		RatePlanID: "pge-ev2a",
	}

	rec := httptest.NewRecorder()
	h.Optimize(rec, newChargePlannerOptimizeRequest(t, body))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestChargePlanner_ApplyWrapsSendCommandWithTimeout verifies that
// Handler.applyChargeScheduleToVehicle wraps each Tesla
// SendCommand call in its own context.WithTimeout — the project rule
// for external Tesla API calls (Tesla API: 30s). Without a per-call
// deadline a stalled Tesla API would hang the request goroutine for as
// long as the inbound HTTP client is willing to wait (forever, by
// default), starving the worker pool and any /charge-planner/apply
// request queueing behind it. The legacy bare-context calls
// (set_charge_limit and set_scheduled_charging at L347-364) inherited
// only the inbound request context, which carries no deadline, and a
// future regression that re-introduces the bare-context pattern is
// caught here.
//
// The test points a real *tesla.Client at a mock server that blocks
// indefinitely (until the request context cancels), then substitutes
// the package-level chargePlannerCommandTimeout for a small value to
// drive the deadline branch deterministically. The helper must return
// promptly (well under any reasonable production wait) with
// failedCmd="set_charge_limit" — proving the FIRST SendCommand call's
// context honored its private 50ms deadline rather than the parent's
// indefinite one. The parent context.Background carries no deadline,
// so any timeout that fires comes from the helper's own
// context.WithTimeout call.
func TestChargePlanner_ApplyWrapsSendCommandWithTimeout(t *testing.T) {
	// release unblocks any in-flight handler at test teardown so
	// httptest.Server.Close can drain its handler WaitGroup even if
	// the server-side detection of the client context cancellation
	// has not yet propagated. Without this backstop the test process
	// would hang in server.Close after the assertions pass.
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Block until EITHER the request's own context cancels —
		// which, with the per-call WithTimeout in place, fires
		// after chargePlannerCommandTimeout — or the test releases
		// us at teardown. The handler MUST drain on
		// r.Context.Done rather than time.Sleep — otherwise a
		// missing per-call timeout would not surface as a test
		// failure (the inbound conn would stay open until Sleep
		// elapses, masking the bug).
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	t.Cleanup(func() {
		close(release)
		server.Close()
	})

	client := tesla.NewClient(config.TeslaConfig{
		BaseURL:      server.URL,
		AuthURL:      server.URL,
		ClientID:     "test-client-id",
		ClientSecret: "test-client-secret",
		// Generous http.Client.Timeout so the failure path under
		// test cannot be masked by the transport-level timeout —
		// the only deadline that should ever fire here is the one
		// the helper installs via context.WithTimeout.
		Timeout: 30 * time.Second,
	})
	client.SetTokens("test-access-token", "test-refresh-token", time.Now().Add(1*time.Hour))

	prevTimeout := chargePlannerCommandTimeout
	chargePlannerCommandTimeout = 50 * time.Millisecond
	defer func() { chargePlannerCommandTimeout = prevTimeout }()

	h := &Handler{teslaClient: client}

	// Parent context with NO deadline — the timeout MUST come from
	// the helper's own context.WithTimeout, never from the caller.
	start := time.Now()
	failedCmd, err := h.applyChargeScheduleToVehicle(context.Background(), "TESTVIN", 80, 1320)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatalf("applyChargeScheduleToVehicle returned nil error; want context-deadline error (failedCmd=%q, elapsed=%v)", failedCmd, elapsed)
	}
	if failedCmd != "set_charge_limit" {
		t.Fatalf("failedCmd = %q, want %q (the FIRST SendCommand should hit its private deadline first)", failedCmd, "set_charge_limit")
	}
	// Generous upper bound — well under any reasonable production
	// Tesla timeout and well under the 30s http.Client.Timeout, but
	// accommodates CI scheduler jitter. Anything substantially over
	// chargePlannerCommandTimeout (50ms) means the per-call wrap is
	// not in place.
	if elapsed > 5*time.Second {
		t.Fatalf("applyChargeScheduleToVehicle took %v with chargePlannerCommandTimeout=50ms — context.WithTimeout wrap is missing or not honored", elapsed)
	}
}
