package api

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

// TestChargePlanner_UsesCurrentSOC verifies that ChargePlannerHandler.Optimize
// resolves the seeding "current SOC" via signal.StateReader.SignalAt with
// signal name "BatteryLevel" anchored at time.Now() — the lookup that
// determines how much energy the optimizer must schedule. A future
// regression that re-points the lookup at the deleted
// database.SignalLogReader.SignalAt helper, drops the "BatteryLevel"
// signal name, anchors the read to a stale "at", or queries a different
// vehicle would silently misderive the kWh-needed projection (and
// therefore the entire schedule + cost comparison) without surfacing any
// error and is caught here.
//
// The test seeds the fake reader with currentSOC = 60 and requests
// target_soc = 50, which exercises the early-return path
//
//	if currentSOC >= req.TargetSOC { writeError(... 400 ...) }
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
	// database.NewChargePlanRepo call. teslaClient/cfg: nil for the
	// same reason.
	h := &ChargePlannerHandler{state: fake}

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
// for the Optimize endpoint. The legacy database.SignalLogReader-backed
// handler silently swallowed SignalAt errors and defaulted currentSOC to
// 0 — which made every optimize request appear to need a full charge
// from empty, masking real signal-store / pgx outages behind plausible-
// looking (but wrong) charge windows and inflated cost estimates. This
// phase-39 migration tightens error handling so the frontend can surface
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
	h := &ChargePlannerHandler{state: fake}

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
