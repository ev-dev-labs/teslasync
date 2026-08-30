package service

// Prefetch (bulk current-state) tests.
//
// Two properties matter and both are asserted here:
//
//  1. FEWER ROUND TRIPS. A prefetched batch must issue ONE live read, ONE
//     signal_log read and ONE FSM read for the whole page — never one per
//     vehicle.
//  2. IDENTICAL VERDICTS. A prefetched resolution and a per-vehicle
//     resolution of the same data must agree on state, provenance, freshness
//     and verified fields. If they can differ, the optimisation is a bug
//     factory.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ── Test doubles ────────────────────────────────────────────────────────────

// countingLiveStore records how many single-vehicle and bulk reads it served.
type countingLiveStore struct {
	values map[int64]map[string]*signal.Value
	// bulkErrs marks vehicles whose bulk read fails (partial outage).
	bulkErrs map[int64]error
	// bulkCallErr fails the whole bulk primitive.
	bulkCallErr error

	singleCalls int
	bulkCalls   int
	bulkIDs     []int64
}

func (c *countingLiveStore) Update(context.Context, int64, map[string]interface{}) error { return nil }
func (c *countingLiveStore) UpdateNonBlocking(context.Context, int64, map[string]interface{}) error {
	return nil
}
func (c *countingLiveStore) UpdateValuesNonBlocking(context.Context, int64, map[string]*signal.Value) error {
	return nil
}
func (c *countingLiveStore) GetSignal(context.Context, int64, string, signal.LiveSignalReadPreference) (*signal.Value, error) {
	return nil, nil
}

func (c *countingLiveStore) GetAll(_ context.Context, vehicleID int64, _ signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	c.singleCalls++
	return c.values[vehicleID], nil
}

func (c *countingLiveStore) Warm(context.Context, int64) error { return nil }
func (c *countingLiveStore) LocalVehicleIDs() []int64          { return nil }

func (c *countingLiveStore) GetAllBulk(
	_ context.Context,
	vehicleIDs []int64,
	_ signal.LiveSignalReadPreference,
) (map[int64]signal.LiveSignalRead, error) {
	c.bulkCalls++
	c.bulkIDs = append([]int64(nil), vehicleIDs...)
	if c.bulkCallErr != nil {
		return nil, c.bulkCallErr
	}
	out := make(map[int64]signal.LiveSignalRead, len(vehicleIDs))
	for _, id := range vehicleIDs {
		if err, ok := c.bulkErrs[id]; ok {
			out[id] = signal.LiveSignalRead{Err: err}
			continue
		}
		out[id] = signal.LiveSignalRead{Values: c.values[id]}
	}
	return out, nil
}

var _ signal.BulkLiveSignalStore = (*countingLiveStore)(nil)

// countingStateReader is a signal_log fallback that counts per-vehicle vs
// set-based reads.
type countingStateReader struct {
	states      map[int64]signal.State
	singleCalls int
	bulkCalls   int
	bulkErr     error
}

func (c *countingStateReader) State(_ context.Context, vehicleID int64, _ time.Time) (signal.State, error) {
	c.singleCalls++
	return c.states[vehicleID], nil
}

func (c *countingStateReader) StatesAt(_ context.Context, vehicleIDs []int64, _ time.Time) (map[int64]signal.State, error) {
	c.bulkCalls++
	if c.bulkErr != nil {
		return nil, c.bulkErr
	}
	out := make(map[int64]signal.State, len(vehicleIDs))
	for _, id := range vehicleIDs {
		if state, ok := c.states[id]; ok {
			out[id] = state
		}
	}
	return out, nil
}

var _ signal.BulkStateReader = (*countingStateReader)(nil)

// countingFSM is an fsmStateSource with the bulk capability.
type countingFSM struct {
	records     map[int64]fsmStateRecord
	singleCalls int
	bulkCalls   int
	bulkErr     error
}

func (c *countingFSM) GetCurrentStateSince(_ context.Context, vehicleID int64) (string, *time.Time, error) {
	c.singleCalls++
	record := c.records[vehicleID]
	return record.State, record.Since, nil
}

func (c *countingFSM) GetCurrentStatesSince(_ context.Context, vehicleIDs []int64) (map[int64]fsmStateRecord, error) {
	c.bulkCalls++
	if c.bulkErr != nil {
		return nil, c.bulkErr
	}
	out := make(map[int64]fsmStateRecord, len(vehicleIDs))
	for _, id := range vehicleIDs {
		if record, ok := c.records[id]; ok {
			out[id] = record
		}
	}
	return out, nil
}

func observedValue(raw interface{}, at time.Time) *signal.Value {
	return &signal.Value{Raw: raw, Timestamp: at}
}

// ── Round-trip count ────────────────────────────────────────────────────────

func TestPrefetchReadsEveryLayerOncePerBatch(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	now := time.Now().UTC()
	observedAt := now.Add(-5 * time.Second)
	ids := []int64{1, 2, 3, 4, 5}

	live := &countingLiveStore{values: map[int64]map[string]*signal.Value{}}
	reader := &countingStateReader{states: map[int64]signal.State{}}
	fsm := &countingFSM{records: map[int64]fsmStateRecord{}}
	for _, id := range ids {
		live.values[id] = map[string]*signal.Value{"BatteryLevel": observedValue(60.0, observedAt)}
		reader.states[id] = signal.State{"Odometer": 1000.0}
		fsm.records[id] = fsmStateRecord{State: enums.StateParked}
	}

	svc := (&VehicleService{fsmState: fsm}).WithStateReader(reader)
	pre, err := svc.PrefetchCurrentStates(context.Background(), ids, live, now)
	if err != nil {
		t.Fatalf("PrefetchCurrentStates: %v", err)
	}
	if !pre.At().Equal(now.UTC()) {
		t.Fatalf("prefetch instant = %v, want the request-level now %v", pre.At(), now.UTC())
	}
	for _, id := range ids {
		got, err := svc.ResolveCurrentStateWith(
			context.Background(), &vehiclemodel.Vehicle{ID: id}, live, now, pre)
		if err != nil {
			t.Fatalf("ResolveCurrentStateWith(%d): %v", id, err)
		}
		if got.State == nil || got.State.BatteryLevel != 60 {
			t.Fatalf("vehicle %d state = %#v, want battery_level 60", id, got.State)
		}
		if got.State.Odometer != 1000 {
			t.Fatalf("vehicle %d odometer = %v, want the signal_log fallback value", id, got.State.Odometer)
		}
		if got.State.State != enums.StateParked {
			t.Fatalf("vehicle %d fsm state = %q, want parked", id, got.State.State)
		}
	}

	if live.bulkCalls != 1 || live.singleCalls != 0 {
		t.Fatalf("live reads = %d bulk / %d single, want 1 bulk and no fan-out", live.bulkCalls, live.singleCalls)
	}
	if reader.bulkCalls != 1 || reader.singleCalls != 0 {
		t.Fatalf("signal_log reads = %d bulk / %d single, want 1 bulk and no fan-out", reader.bulkCalls, reader.singleCalls)
	}
	if fsm.bulkCalls != 1 || fsm.singleCalls != 0 {
		t.Fatalf("fsm reads = %d bulk / %d single, want 1 bulk and no fan-out", fsm.bulkCalls, fsm.singleCalls)
	}
	if len(live.bulkIDs) != len(ids) {
		t.Fatalf("bulk live read covered %d vehicles, want %d", len(live.bulkIDs), len(ids))
	}
}

func TestPrefetchedAndPerVehicleResolutionAgree(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	now := time.Now().UTC()
	observedAt := now.Add(-5 * time.Second)
	since := now.Add(-time.Hour)
	vehicle := &vehiclemodel.Vehicle{ID: 9}

	newDeps := func() (*countingLiveStore, *VehicleService) {
		live := &countingLiveStore{values: map[int64]map[string]*signal.Value{
			9: {
				"BatteryLevel":        observedValue(61.0, observedAt),
				"DetailedChargeState": observedValue("Charging", observedAt),
			},
		}}
		reader := &countingStateReader{states: map[int64]signal.State{9: {"Odometer": 4242.0}}}
		fsm := &countingFSM{records: map[int64]fsmStateRecord{
			9: {State: enums.StateCharging, Since: &since},
		}}
		return live, (&VehicleService{fsmState: fsm}).WithStateReader(reader)
	}

	liveA, svcA := newDeps()
	perVehicle, err := svcA.ResolveCurrentState(context.Background(), vehicle, liveA, now)
	if err != nil {
		t.Fatalf("ResolveCurrentState: %v", err)
	}

	liveB, svcB := newDeps()
	pre, err := svcB.PrefetchCurrentStates(context.Background(), []int64{9}, liveB, now)
	if err != nil {
		t.Fatalf("PrefetchCurrentStates: %v", err)
	}
	prefetched, err := svcB.ResolveCurrentStateWith(context.Background(), vehicle, liveB, now, pre)
	if err != nil {
		t.Fatalf("ResolveCurrentStateWith: %v", err)
	}

	if *prefetched.State != *perVehicle.State {
		t.Fatalf("state differs between paths:\nprefetched %#v\nper-vehicle %#v", prefetched.State, perVehicle.State)
	}
	if prefetched.DataSource != perVehicle.DataSource ||
		prefetched.Freshness != perVehicle.Freshness ||
		prefetched.Live != perVehicle.Live {
		t.Fatalf("provenance differs: %#v vs %#v", prefetched, perVehicle)
	}
	if len(prefetched.VerifiedFields) != len(perVehicle.VerifiedFields) {
		t.Fatalf("verified fields differ: %v vs %v", prefetched.VerifiedFields, perVehicle.VerifiedFields)
	}
	if prefetched.ObservedAt == nil || perVehicle.ObservedAt == nil ||
		!prefetched.ObservedAt.Equal(*perVehicle.ObservedAt) {
		t.Fatalf("observed_at differs: %v vs %v", prefetched.ObservedAt, perVehicle.ObservedAt)
	}
}

// ── Partial failure ─────────────────────────────────────────────────────────

func TestPrefetchLiveFailureDegradesOnlyThatVehicle(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	now := time.Now().UTC()
	observedAt := now.Add(-5 * time.Second)
	live := &countingLiveStore{
		values: map[int64]map[string]*signal.Value{
			1: {"BatteryLevel": observedValue(61.0, observedAt)},
			2: {"BatteryLevel": observedValue(62.0, observedAt)},
		},
		bulkErrs: map[int64]error{2: errors.New("redis: i/o timeout")},
	}
	reader := &countingStateReader{states: map[int64]signal.State{2: {"Odometer": 777.0}}}
	svc := (&VehicleService{fsmState: &countingFSM{}}).WithStateReader(reader)

	pre, err := svc.PrefetchCurrentStates(context.Background(), []int64{1, 2}, live, now)
	if err != nil {
		t.Fatalf("PrefetchCurrentStates: %v", err)
	}

	healthy, err := svc.ResolveCurrentStateWith(context.Background(), &vehiclemodel.Vehicle{ID: 1}, live, now, pre)
	if err != nil {
		t.Fatalf("healthy vehicle: %v", err)
	}
	if healthy.Freshness != FreshnessFresh || healthy.LiveReadErr != nil {
		t.Fatalf("healthy vehicle degraded with its neighbour: %#v", healthy)
	}

	degraded, err := svc.ResolveCurrentStateWith(context.Background(), &vehiclemodel.Vehicle{ID: 2}, live, now, pre)
	if err != nil {
		t.Fatalf("a failed live read must degrade, not fail: %v", err)
	}
	if degraded.LiveReadErr == nil {
		t.Fatal("the degraded vehicle must report its live-read failure")
	}
	if degraded.DataSource != DataSourceDBFallback {
		t.Fatalf("data_source = %q, want the durable fallback", degraded.DataSource)
	}
	if degraded.Freshness != FreshnessUnknown {
		t.Fatalf("freshness = %q, want unknown — a failed read is not a stale reading", degraded.Freshness)
	}
	if degraded.State == nil || degraded.State.Odometer != 777 {
		t.Fatalf("durable fallback did not fill the hole: %#v", degraded.State)
	}
}

func TestPrefetchDurableFailureStillAnswersFromLive(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	now := time.Now().UTC()
	observedAt := now.Add(-5 * time.Second)
	live := &countingLiveStore{values: map[int64]map[string]*signal.Value{
		1: {"BatteryLevel": observedValue(61.0, observedAt)},
	}}
	reader := &countingStateReader{bulkErr: errors.New("pq: statement timeout")}
	svc := (&VehicleService{fsmState: &countingFSM{}}).WithStateReader(reader)

	pre, err := svc.PrefetchCurrentStates(context.Background(), []int64{1}, live, now)
	if err != nil {
		t.Fatalf("a failed bulk signal_log read must not fail the prefetch: %v", err)
	}
	got, err := svc.ResolveCurrentStateWith(context.Background(), &vehiclemodel.Vehicle{ID: 1}, live, now, pre)
	if err != nil {
		t.Fatalf("ResolveCurrentStateWith: %v", err)
	}
	if got.State == nil || got.State.BatteryLevel != 61 {
		t.Fatalf("live values must still answer: %#v", got.State)
	}
	if reader.singleCalls != 0 {
		t.Fatalf("a failed bulk read must NOT silently re-fan-out per vehicle; single reads = %d", reader.singleCalls)
	}
}

func TestPrefetchFSMFailureReportsUnknownState(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	now := time.Now().UTC()
	observedAt := now.Add(-5 * time.Second)
	live := &countingLiveStore{values: map[int64]map[string]*signal.Value{
		1: {"BatteryLevel": observedValue(61.0, observedAt)},
	}}
	fsm := &countingFSM{bulkErr: errors.New("pq: too many connections")}
	svc := &VehicleService{fsmState: fsm}

	pre, err := svc.PrefetchCurrentStates(context.Background(), []int64{1}, live, now)
	if err != nil {
		t.Fatalf("PrefetchCurrentStates: %v", err)
	}
	got, err := svc.ResolveCurrentStateWith(context.Background(), &vehiclemodel.Vehicle{ID: 1}, live, now, pre)
	if err != nil {
		t.Fatalf("ResolveCurrentStateWith: %v", err)
	}
	// An unreadable FSM must NOT be reported as offline; the assembler's
	// documented default (online) stands and `state` stays unverified.
	if got.State.State == enums.StateOffline {
		t.Fatal("an unreadable FSM must never be rendered as offline")
	}
	for _, field := range got.VerifiedFields {
		if field == "state" {
			t.Fatal("state must not be marked verified when the FSM read failed")
		}
	}
	if fsm.singleCalls != 0 {
		t.Fatalf("a failed bulk FSM read must not re-fan-out; single reads = %d", fsm.singleCalls)
	}
}

// ── Fallback when the bulk capability is absent ─────────────────────────────

func TestPrefetchLeavesUncapableLayersToPerVehicleReads(t *testing.T) {
	metrics.ResetVehicleStateConflictsForTests()
	t.Cleanup(metrics.ResetVehicleStateConflictsForTests)

	now := time.Now().UTC()
	observedAt := now.Add(-5 * time.Second)
	// Neither double implements a bulk capability, so neither layer is
	// prefetched and both must be read per vehicle exactly as before.
	basic := &plainLiveStore{values: map[int64]map[string]*signal.Value{
		1: {"BatteryLevel": observedValue(61.0, observedAt)},
	}}
	reader := &plainStateReader{states: map[int64]signal.State{1: {"Odometer": 10.0}}}
	svc := (&VehicleService{fsmState: &fakeFSMState{state: enums.StateParked}}).WithStateReader(reader)

	pre, err := svc.PrefetchCurrentStates(context.Background(), []int64{1}, basic, now)
	if err != nil {
		t.Fatalf("PrefetchCurrentStates: %v", err)
	}
	if pre.LiveReadAttempted() {
		t.Fatal("a store without the bulk capability must not be reported as prefetched")
	}
	if pre.DurableReadAttempted() {
		t.Fatal("a reader without the bulk capability must not be reported as prefetched")
	}
	if pre.FSMReadAttempted() {
		t.Fatal("an FSM source without the bulk capability must not be reported as prefetched")
	}

	got, err := svc.ResolveCurrentStateWith(context.Background(), &vehiclemodel.Vehicle{ID: 1}, basic, now, pre)
	if err != nil {
		t.Fatalf("ResolveCurrentStateWith: %v", err)
	}
	if got.State == nil || got.State.BatteryLevel != 61 || got.State.Odometer != 10 {
		t.Fatalf("per-vehicle fallback lost data: %#v", got.State)
	}
	if basic.calls != 1 {
		t.Fatalf("live reads = %d, want the per-vehicle fallback to have run once", basic.calls)
	}
	if reader.calls != 1 {
		t.Fatalf("signal_log reads = %d, want the per-vehicle fallback to have run once", reader.calls)
	}
}

// plainLiveStore implements ONLY the per-vehicle LiveSignalStore contract.
type plainLiveStore struct {
	values map[int64]map[string]*signal.Value
	calls  int
}

func (p *plainLiveStore) Update(context.Context, int64, map[string]interface{}) error { return nil }
func (p *plainLiveStore) UpdateNonBlocking(context.Context, int64, map[string]interface{}) error {
	return nil
}
func (p *plainLiveStore) UpdateValuesNonBlocking(context.Context, int64, map[string]*signal.Value) error {
	return nil
}
func (p *plainLiveStore) GetSignal(context.Context, int64, string, signal.LiveSignalReadPreference) (*signal.Value, error) {
	return nil, nil
}
func (p *plainLiveStore) GetAll(_ context.Context, vehicleID int64, _ signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	p.calls++
	return p.values[vehicleID], nil
}
func (p *plainLiveStore) Warm(context.Context, int64) error { return nil }
func (p *plainLiveStore) LocalVehicleIDs() []int64          { return nil }

// plainStateReader implements ONLY the per-vehicle SignalStateReader.
type plainStateReader struct {
	states map[int64]signal.State
	calls  int
}

func (p *plainStateReader) State(_ context.Context, vehicleID int64, _ time.Time) (signal.State, error) {
	p.calls++
	return p.states[vehicleID], nil
}

func TestPrefetchRejectsACancelledContext(t *testing.T) {
	svc := &VehicleService{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := svc.PrefetchCurrentStates(ctx, []int64{1}, nil, time.Now().UTC()); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want the cancellation surfaced rather than an empty prefetch", err)
	}
}
