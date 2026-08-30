package fleetstatesvc

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// ── Test doubles ────────────────────────────────────────────────────────────

type fakeRoster struct {
	vehicles []*vehiclemodel.Vehicle
	err      error
	calls    int
}

func (f *fakeRoster) GetAll(context.Context) ([]*vehiclemodel.Vehicle, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.vehicles, nil
}

// fakeResolver is programmable per vehicle id so a batch can mix resolved,
// missing and failed items exactly as production would under partial outage.
type fakeResolver struct {
	mu sync.Mutex
	// fn maps vehicle id → behaviour. Absent ids resolve normally.
	fn map[int64]func(ctx context.Context) (service.CurrentState, error)

	seenNow   map[int64]time.Time
	callCount int
	maxInFlgt int
	inFlight  int
}

type blockingStateReader struct{}

func (blockingStateReader) State(ctx context.Context, _ int64, _ time.Time) (signal.State, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func newFakeResolver() *fakeResolver {
	return &fakeResolver{
		fn:      map[int64]func(context.Context) (service.CurrentState, error){},
		seenNow: map[int64]time.Time{},
	}
}

func (f *fakeResolver) ResolveCurrentState(
	ctx context.Context,
	vehicle *vehiclemodel.Vehicle,
	_ signal.LiveSignalStore,
	now time.Time,
) (service.CurrentState, error) {
	f.mu.Lock()
	f.callCount++
	f.inFlight++
	if f.inFlight > f.maxInFlgt {
		f.maxInFlgt = f.inFlight
	}
	f.seenNow[vehicle.ID] = now
	fn := f.fn[vehicle.ID]
	f.mu.Unlock()

	defer func() {
		f.mu.Lock()
		f.inFlight--
		f.mu.Unlock()
	}()

	if fn != nil {
		return fn(ctx)
	}
	observed := now.Add(-time.Second)
	return service.CurrentState{
		State:          &vehiclemodel.VehicleState{VehicleID: vehicle.ID, BatteryLevel: 50},
		Live:           true,
		DataSource:     service.DataSourceLiveSignalStore,
		ObservedAt:     &observed,
		Freshness:      service.FreshnessFresh,
		VerifiedFields: []string{"battery_level", "state"},
	}, nil
}

func fleet(n int) []*vehiclemodel.Vehicle {
	out := make([]*vehiclemodel.Vehicle, n)
	for i := range out {
		out[i] = &vehiclemodel.Vehicle{ID: int64(i + 1), VIN: fmt.Sprintf("VIN%03d", i+1)}
	}
	return out
}

func newService(t *testing.T, roster *fakeRoster, resolver *fakeResolver, opts ...func(*Options)) *Service {
	t.Helper()
	fixedNow := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	opt := Options{
		Vehicles: roster,
		Resolver: resolver,
		Now:      func() time.Time { return fixedNow },
	}
	for _, apply := range opts {
		apply(&opt)
	}
	return New(opt)
}

// ── Contract ────────────────────────────────────────────────────────────────

func TestFleetStatesResolvesEveryVehicleInOneCall(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(120)}
	resolver := newFakeResolver()
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{Limit: MaxLimit})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if roster.calls != 1 {
		t.Fatalf("roster reads = %d, want exactly 1 for the whole batch", roster.calls)
	}
	if got := len(batch.Vehicles); got != 120 {
		t.Fatalf("items = %d, want 120", got)
	}
	if batch.Total != 120 {
		t.Fatalf("total = %d, want 120", batch.Total)
	}
	if batch.Counts.Resolved != 120 {
		t.Fatalf("resolved = %d, want 120 (%+v)", batch.Counts.Resolved, batch.Counts)
	}
	// Response order must mirror roster order regardless of completion order.
	for i, item := range batch.Vehicles {
		if item.VehicleID != int64(i+1) {
			t.Fatalf("item %d = vehicle %d, want %d (order not preserved)", i, item.VehicleID, i+1)
		}
	}
}

func TestFleetStatesUsesOneRequestLevelNowForEveryVehicle(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(50)}
	resolver := newFakeResolver()
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	for id, seen := range resolver.seenNow {
		if !seen.Equal(batch.Now) {
			t.Fatalf("vehicle %d classified against %v, want the request-level now %v", id, seen, batch.Now)
		}
	}
	if batch.Now.Location() != time.UTC {
		t.Fatalf("now location = %v, want UTC", batch.Now.Location())
	}
}

func TestFleetStatesBoundsConcurrency(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(100)}
	resolver := newFakeResolver()
	release := make(chan struct{})
	var once sync.Once
	for _, v := range roster.vehicles {
		resolver.fn[v.ID] = func(ctx context.Context) (service.CurrentState, error) {
			// Hold every worker until the pool is saturated so the observed
			// high-water mark is meaningful rather than a scheduling artefact.
			once.Do(func() { go func() { time.Sleep(20 * time.Millisecond); close(release) }() })
			<-release
			return service.CurrentState{State: &vehiclemodel.VehicleState{}}, nil
		}
	}
	svc := newService(t, roster, resolver, func(o *Options) { o.Workers = 4 })

	if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	resolver.mu.Lock()
	peak := resolver.maxInFlgt
	resolver.mu.Unlock()
	if peak > 4 {
		t.Fatalf("peak concurrent live reads = %d, want <= 4", peak)
	}
}

func TestFleetStatesIsolatesOneFailingVehicle(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(3)}
	resolver := newFakeResolver()
	resolver.fn[2] = func(context.Context) (service.CurrentState, error) {
		return service.CurrentState{}, errors.New("redis: i/o timeout on vehicle:2:signals")
	}
	var reportedVehicleID int64
	var reportedError error
	svc := newService(t, roster, resolver, func(o *Options) {
		o.OnResolverError = func(_ context.Context, vehicleID int64, err error) {
			reportedVehicleID = vehicleID
			reportedError = err
		}
	})

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("one bad live read failed the whole batch: %v", err)
	}
	if got := []string{batch.Vehicles[0].Outcome, batch.Vehicles[1].Outcome, batch.Vehicles[2].Outcome}; got[0] != OutcomeResolved || got[1] != OutcomeFailed || got[2] != OutcomeResolved {
		t.Fatalf("outcomes = %v, want [resolved failed resolved]", got)
	}
	failed := batch.Vehicles[1]
	if failed.State != nil {
		t.Fatalf("failed item carried a state %#v; a transport failure is not a reading", failed.State)
	}
	if failed.DataSource != DataSourceUnavailable {
		t.Fatalf("failed data_source = %q, want %q", failed.DataSource, DataSourceUnavailable)
	}
	if failed.Error != ErrCodeStateUnavailable {
		t.Fatalf("error = %q, want the stable code %q", failed.Error, ErrCodeStateUnavailable)
	}
	if failed.Freshness != string(service.FreshnessUnknown) {
		t.Fatalf("freshness = %q, want unknown", failed.Freshness)
	}
	if failed.VerifiedFields == nil {
		t.Fatal("verified_fields = nil, want an empty array even on failure")
	}
	if batch.Counts != (OutcomeCounts{Resolved: 2, Missing: 0, Failed: 1}) {
		t.Fatalf("counts = %+v, want 2 resolved / 1 failed", batch.Counts)
	}
	if reportedVehicleID != 2 || reportedError == nil {
		t.Fatalf("failure report = vehicle %d, %v; want vehicle 2 and its resolver error", reportedVehicleID, reportedError)
	}
}

func TestFleetStatesNeverLeaksInternalErrorText(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(1)}
	resolver := newFakeResolver()
	resolver.fn[1] = func(context.Context) (service.CurrentState, error) {
		return service.CurrentState{}, errors.New("pq: password authentication failed for user \"teslasync\"")
	}
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Vehicles[0].Error != ErrCodeStateUnavailable {
		t.Fatalf("error = %q, want only the stable code", batch.Vehicles[0].Error)
	}
}

func TestFleetStatesReportsAbsentSnapshotAsMissing(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(2)}
	resolver := newFakeResolver()
	resolver.fn[1] = func(context.Context) (service.CurrentState, error) {
		return service.CurrentState{State: nil}, nil
	}
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Vehicles[0].Outcome != OutcomeMissing {
		t.Fatalf("outcome = %q, want missing (an authoritative absence, not a failure)", batch.Vehicles[0].Outcome)
	}
	if batch.Vehicles[0].Error != "" {
		t.Fatalf("error = %q, want empty for a successful empty read", batch.Vehicles[0].Error)
	}
	if batch.Vehicles[0].DataSource != DataSourceUnavailable {
		t.Fatalf("missing data_source = %q, want %q", batch.Vehicles[0].DataSource, DataSourceUnavailable)
	}
	if batch.Counts != (OutcomeCounts{Resolved: 1, Missing: 1}) {
		t.Fatalf("counts = %+v, want 1 resolved / 1 missing", batch.Counts)
	}
}

func TestFleetStatesSurvivesAResolverPanic(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(3)}
	resolver := newFakeResolver()
	resolver.fn[2] = func(context.Context) (service.CurrentState, error) {
		panic("assembler bug on one vehicle")
	}
	var reportedVehicleID int64
	var reportedPanic any
	svc := newService(t, roster, resolver, func(o *Options) {
		o.OnResolverPanic = func(_ context.Context, vehicleID int64, recovered any) {
			reportedVehicleID = vehicleID
			reportedPanic = recovered
		}
	})

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Vehicles[1].Outcome != OutcomeFailed {
		t.Fatalf("outcome = %q, want failed", batch.Vehicles[1].Outcome)
	}
	if batch.Vehicles[0].Outcome != OutcomeResolved || batch.Vehicles[2].Outcome != OutcomeResolved {
		t.Fatal("a panic on one vehicle hid the rest of the fleet")
	}
	if reportedVehicleID != 2 || reportedPanic != "assembler bug on one vehicle" {
		t.Fatalf("panic report = vehicle %d, %v; want vehicle 2 and recovered panic", reportedVehicleID, reportedPanic)
	}
}

func TestFleetStatesAppliesPerVehicleTimeout(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(2)}
	resolver := newFakeResolver()
	resolver.fn[1] = func(ctx context.Context) (service.CurrentState, error) {
		<-ctx.Done()
		return service.CurrentState{}, ctx.Err()
	}
	svc := newService(t, roster, resolver, func(o *Options) {
		o.PerVehicleTimeout = 25 * time.Millisecond
		o.Workers = 2
	})

	start := time.Now()
	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("batch took %v; one wedged vehicle must not stall the fleet", elapsed)
	}
	if batch.Vehicles[0].Outcome != OutcomeFailed {
		t.Fatalf("wedged vehicle outcome = %q, want failed", batch.Vehicles[0].Outcome)
	}
	if batch.Vehicles[1].Outcome != OutcomeResolved {
		t.Fatalf("healthy vehicle outcome = %q, want resolved", batch.Vehicles[1].Outcome)
	}
}

func TestFleetStatesTimeoutCancelsDurableFallbackRead(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(1)}
	resolver := (&service.VehicleService{}).WithStateReader(blockingStateReader{})
	svc := New(Options{
		Vehicles:          roster,
		Resolver:          resolver,
		Now:               func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) },
		PerVehicleTimeout: 25 * time.Millisecond,
	})

	started := time.Now()
	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("durable fallback ignored the per-vehicle deadline; elapsed %v", elapsed)
	}
	if batch.Vehicles[0].Outcome != OutcomeFailed {
		t.Fatalf("outcome = %q, want failed after the durable read deadline", batch.Vehicles[0].Outcome)
	}
}

func TestFleetStatesFiltersToRequestedIDs(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(5)}
	resolver := newFakeResolver()
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{VehicleIDs: []int64{4, 2}})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if len(batch.Vehicles) != 2 || batch.Vehicles[0].VehicleID != 2 || batch.Vehicles[1].VehicleID != 4 {
		t.Fatalf("ids = %v, want roster-ordered [2 4]", ids(batch))
	}
	if batch.Total != 2 {
		t.Fatalf("total = %d, want the filtered total 2", batch.Total)
	}
	if resolver.callCount != 2 {
		t.Fatalf("resolver calls = %d, want 2 — unrequested vehicles must not be read", resolver.callCount)
	}
}

func TestFleetStatesDropsIDsOutsideTheRoster(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(2)}
	resolver := newFakeResolver()
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{VehicleIDs: []int64{1, 999}})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	// 999 is silently absent: echoing it back would confirm (or deny) the
	// existence of a vehicle the caller does not own.
	if len(batch.Vehicles) != 1 || batch.Vehicles[0].VehicleID != 1 {
		t.Fatalf("ids = %v, want [1]", ids(batch))
	}
}

func TestFleetStatesPaginates(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(10)}
	resolver := newFakeResolver()
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{Limit: 3, Offset: 4})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if got := ids(batch); len(got) != 3 || got[0] != 5 || got[2] != 7 {
		t.Fatalf("ids = %v, want [5 6 7]", got)
	}
	if batch.Total != 10 || batch.Limit != 3 || batch.Offset != 4 {
		t.Fatalf("paging meta = total %d limit %d offset %d, want 10/3/4", batch.Total, batch.Limit, batch.Offset)
	}

	// Offset past the end is an empty page, not an error.
	batch, err = svc.FleetStates(context.Background(), Query{Offset: 99})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if len(batch.Vehicles) != 0 || batch.Total != 10 {
		t.Fatalf("over-run page = %d items / total %d, want 0 / 10", len(batch.Vehicles), batch.Total)
	}
}

func TestFleetStatesClampsLimit(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(3)}
	svc := newService(t, roster, newFakeResolver())

	batch, err := svc.FleetStates(context.Background(), Query{Limit: 10_000})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Limit != MaxLimit {
		t.Fatalf("limit = %d, want the clamp %d", batch.Limit, MaxLimit)
	}

	batch, err = svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Limit != DefaultLimit {
		t.Fatalf("limit = %d, want the default %d", batch.Limit, DefaultLimit)
	}
}

func TestFleetStatesFailsWholeBatchOnRosterError(t *testing.T) {
	roster := &fakeRoster{err: errors.New("pool exhausted")}
	svc := newService(t, roster, newFakeResolver())

	if _, err := svc.FleetStates(context.Background(), Query{}); err == nil {
		t.Fatal("a roster read failure must fail the batch rather than answer with an empty fleet")
	}
}

func TestFleetStatesRequiresWiring(t *testing.T) {
	for name, svc := range map[string]*Service{
		"nil service":  nil,
		"no roster":    New(Options{Resolver: newFakeResolver()}),
		"no resolver":  New(Options{Vehicles: &fakeRoster{}}),
		"zero options": New(Options{}),
	} {
		if _, err := svc.FleetStates(context.Background(), Query{}); !errors.Is(err, ErrNotConfigured) {
			t.Fatalf("%s: err = %v, want ErrNotConfigured", name, err)
		}
	}
}

func TestFleetStatesEmptyFleetIsNotAnError(t *testing.T) {
	svc := newService(t, &fakeRoster{}, newFakeResolver())
	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Total != 0 || len(batch.Vehicles) != 0 {
		t.Fatalf("got %+v, want an empty batch", batch)
	}
}

func ids(b *Batch) []int64 {
	out := make([]int64, 0, len(b.Vehicles))
	for _, item := range b.Vehicles {
		out = append(out, item.VehicleID)
	}
	return out
}
