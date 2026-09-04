package main

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/tesla"
	teslaconfig "github.com/ev-dev-labs/teslasync/internal/tesla/config"
)

// stubLister implements vehicleLister with a fixed in-memory list.
// Returning a sentinel error covers the "list-vehicles failure" branch
// without needing a real database connection.
type stubLister struct {
	vehicles []*vehiclemodel.Vehicle
	err      error
}

func (s *stubLister) GetAll(_ context.Context) ([]*vehiclemodel.Vehicle, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.vehicles, nil
}

// stubPusher implements pusher and records every call so tests can
// assert call counts and per-call status. Default status is 200 unless
// failVINs / errVINs is populated.
type stubPusher struct {
	calls   atomic.Int64
	failVIN string // VIN that returns HTTP 500 (subscribe-rejected)
	errVIN  string // VIN that returns a transport error
}

func (s *stubPusher) SubscribeFleetTelemetry(_ context.Context, sub tesla.FleetTelemetrySubscription) ([]byte, int, error) {
	s.calls.Add(1)
	if len(sub.VINs) == 1 {
		switch sub.VINs[0] {
		case s.errVIN:
			return nil, 0, errors.New("transport boom")
		case s.failVIN:
			return []byte(`{"error":"rejected"}`), 500, nil
		}
	}
	return []byte(`{"ok":true}`), 200, nil
}

func sampleVehicles() []*vehiclemodel.Vehicle {
	return []*vehiclemodel.Vehicle{
		{ID: 1, VIN: "5YJ3E1EA0001"},
		{ID: 2, VIN: "5YJ3E1EA0002"},
		{ID: 3, VIN: "5YJ3E1EA0003"},
	}
}

func TestBuildFieldMapPreservesSynchronizedCounterPolicy(t *testing.T) {
	t.Parallel()

	fields := buildFieldMap(teslaconfig.NewBuilder())
	miles := fields["MilesSinceReset"]
	if miles.IntervalSeconds != 10 ||
		miles.MinimumDelta == nil ||
		*miles.MinimumDelta != 0.01 ||
		len(miles.IncludeFields) != 1 ||
		miles.IncludeFields[0] != "SelfDrivingMilesSinceReset" {
		t.Errorf("MilesSinceReset policy = %+v", miles)
	}

	fsd := fields["SelfDrivingMilesSinceReset"]
	if fsd.IntervalSeconds != 1 ||
		fsd.MinimumDelta == nil ||
		*fsd.MinimumDelta != 1 ||
		len(fsd.IncludeFields) != 1 ||
		fsd.IncludeFields[0] != "MilesSinceReset" {
		t.Errorf("SelfDrivingMilesSinceReset policy = %+v", fsd)
	}
}

// TestRunWithDeps_AllSuccess covers the happy path: every vehicle gets
// pushed, exit code is 0, and the pusher saw exactly len(vehicles) calls.
func TestRunWithDeps_AllSuccess(t *testing.T) {
	t.Parallel()
	rc := runConfig{
		dryRun:            false,
		vehicleFilter:     0,
		workers:           2,
		perVehicleTimeout: time.Second,
		fleetHostname:     "fleet.test",
		fleetPort:         443,
		operatorEnv:       "tester",
	}
	push := &stubPusher{}
	got := runWithDeps(context.Background(), rc, &stubLister{vehicles: sampleVehicles()}, push, nil)
	if got != 0 {
		t.Fatalf("exit=%d, want 0", got)
	}
	if push.calls.Load() != int64(len(sampleVehicles())) {
		t.Fatalf("calls=%d, want %d", push.calls.Load(), len(sampleVehicles()))
	}
}

// TestRunWithDeps_DryRun asserts that --dry-run never invokes the
// pusher and still exits 0. This is the canary-procedure precondition
// per the operator runbook ("--vehicle X --dry-run first").
func TestRunWithDeps_DryRun(t *testing.T) {
	t.Parallel()
	rc := runConfig{dryRun: true, workers: 2, perVehicleTimeout: time.Second, operatorEnv: "tester"}
	push := &stubPusher{}
	got := runWithDeps(context.Background(), rc, &stubLister{vehicles: sampleVehicles()}, push, nil)
	if got != 0 {
		t.Fatalf("exit=%d, want 0", got)
	}
	if push.calls.Load() != 0 {
		t.Fatalf("dry-run made %d API calls; expected 0", push.calls.Load())
	}
}

// TestRunWithDeps_OneFailureNonZero asserts a single Tesla rejection
// flips exit code to 1 even though the other two vehicles succeeded —
// the runbook's alert thresholds depend on this so on-call wakes up
// when ANY vehicle fails to resubscribe.
func TestRunWithDeps_OneFailureNonZero(t *testing.T) {
	t.Parallel()
	rc := runConfig{workers: 2, perVehicleTimeout: time.Second, operatorEnv: "tester"}
	push := &stubPusher{failVIN: "5YJ3E1EA0002"}
	got := runWithDeps(context.Background(), rc, &stubLister{vehicles: sampleVehicles()}, push, nil)
	if got == 0 {
		t.Fatalf("exit=0 but expected non-zero (one vehicle failed)")
	}
}

// TestRunWithDeps_TransportErrorNonZero asserts a transport error from
// the Tesla client (vs. an HTTP 5xx) also flips exit code to non-zero.
func TestRunWithDeps_TransportErrorNonZero(t *testing.T) {
	t.Parallel()
	rc := runConfig{workers: 2, perVehicleTimeout: time.Second, operatorEnv: "tester"}
	push := &stubPusher{errVIN: "5YJ3E1EA0001"}
	got := runWithDeps(context.Background(), rc, &stubLister{vehicles: sampleVehicles()}, push, nil)
	if got == 0 {
		t.Fatalf("exit=0 but expected non-zero (transport error)")
	}
}

// TestRunWithDeps_VehicleFilter_Hit asserts --vehicle <id> only
// triggers a single push when the ID matches.
func TestRunWithDeps_VehicleFilter_Hit(t *testing.T) {
	t.Parallel()
	rc := runConfig{vehicleFilter: 2, workers: 1, perVehicleTimeout: time.Second, operatorEnv: "tester"}
	push := &stubPusher{}
	got := runWithDeps(context.Background(), rc, &stubLister{vehicles: sampleVehicles()}, push, nil)
	if got != 0 {
		t.Fatalf("exit=%d, want 0", got)
	}
	if push.calls.Load() != 1 {
		t.Fatalf("calls=%d, want 1", push.calls.Load())
	}
}

// TestRunWithDeps_VehicleFilter_Miss asserts --vehicle <id> with no
// matching vehicle exits non-zero (operator triage scenario — wrong ID
// must surface, not silently succeed).
func TestRunWithDeps_VehicleFilter_Miss(t *testing.T) {
	t.Parallel()
	rc := runConfig{vehicleFilter: 9999, workers: 1, perVehicleTimeout: time.Second, operatorEnv: "tester"}
	push := &stubPusher{}
	got := runWithDeps(context.Background(), rc, &stubLister{vehicles: sampleVehicles()}, push, nil)
	if got == 0 {
		t.Fatalf("exit=0 but vehicle 9999 does not exist")
	}
	if push.calls.Load() != 0 {
		t.Fatalf("calls=%d, want 0 (no vehicles to push)", push.calls.Load())
	}
}

// TestRunWithDeps_EmptyFleet asserts that an empty vehicle list with
// no filter exits 0 (nothing to do, not a failure).
func TestRunWithDeps_EmptyFleet(t *testing.T) {
	t.Parallel()
	rc := runConfig{workers: 1, perVehicleTimeout: time.Second, operatorEnv: "tester"}
	push := &stubPusher{}
	got := runWithDeps(context.Background(), rc, &stubLister{vehicles: nil}, push, nil)
	if got != 0 {
		t.Fatalf("exit=%d, want 0 for empty fleet", got)
	}
	if push.calls.Load() != 0 {
		t.Fatalf("calls=%d, want 0", push.calls.Load())
	}
}

// TestRunWithDeps_ListErrorNonZero asserts a vehicle-list query error
// surfaces as a non-zero exit code (operator must know the database
// failed; cannot silently skip the resubscribe).
func TestRunWithDeps_ListErrorNonZero(t *testing.T) {
	t.Parallel()
	rc := runConfig{workers: 1, perVehicleTimeout: time.Second, operatorEnv: "tester"}
	push := &stubPusher{}
	got := runWithDeps(context.Background(), rc, &stubLister{err: errors.New("db down")}, push, nil)
	if got == 0 {
		t.Fatalf("exit=0 but list returned an error")
	}
}

// TestFilterVehicles asserts the filter helper handles the all/single/
// missing-ID/nil-element cases without panicking.
func TestFilterVehicles(t *testing.T) {
	t.Parallel()
	all := []*vehiclemodel.Vehicle{
		{ID: 3, VIN: "C"},
		nil,
		{ID: 1, VIN: "A"},
		{ID: 2, VIN: "B"},
	}

	got := filterVehicles(all, 0)
	if len(got) != 3 {
		t.Fatalf("got %d, want 3 (nil filtered, all returned)", len(got))
	}
	if got[0].ID != 1 || got[1].ID != 2 || got[2].ID != 3 {
		t.Fatalf("not sorted by ID: %v %v %v", got[0].ID, got[1].ID, got[2].ID)
	}

	single := filterVehicles(all, 2)
	if len(single) != 1 || single[0].VIN != "B" {
		t.Fatalf("filterVehicles(2) = %#v, want VIN=B", single)
	}

	miss := filterVehicles(all, 99)
	if len(miss) != 0 {
		t.Fatalf("filterVehicles(99) = %d, want 0", len(miss))
	}
}

// TestDeriveOperator covers the env-var fallback chain so the
// resubscribe.start audit line always has SOMETHING in the operator
// field even when CI strips USER/USERNAME.
func TestDeriveOperator(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		env  map[string]string
		want string
	}{
		{name: "USER set", env: map[string]string{"USER": "alice"}, want: "alice"},
		{name: "USERNAME fallback", env: map[string]string{"USERNAME": "BOB"}, want: "BOB"},
		{name: "trims whitespace", env: map[string]string{"USER": "  carol  "}, want: "carol"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			getenv := func(k string) string { return tc.env[k] }
			if got := deriveOperator(getenv); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}

	// Unknown branch must return a non-empty string so the audit line
	// is always parseable.
	got := deriveOperator(func(string) string { return "" })
	if got == "" {
		t.Fatalf("deriveOperator returned empty when no env vars set; expected unknown fallback")
	}
}
