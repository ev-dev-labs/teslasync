package fleetstatesvc

// Bulk-path tests for the batch itself.
//
// The service must PREFER the bulk read when the resolver offers it (one
// prefetch for the whole page, no per-vehicle storage fan-out), and must stay
// correct when it does not — a resolver without the capability, or a prefetch
// that fails, still produces a complete batch.

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// bulkFakeResolver implements BOTH the per-vehicle and the bulk resolver
// ports so a test can prove which one the batch used.
type bulkFakeResolver struct {
	mu sync.Mutex

	prefetchCalls   int
	prefetchIDs     []int64
	prefetchErr     error
	prefetchDelay   time.Duration
	perVehicleCalls int
	withPrefetch    int
	nilPrefetch     int

	state func(id int64, now time.Time) service.CurrentState
}

func newBulkFakeResolver() *bulkFakeResolver {
	return &bulkFakeResolver{
		state: func(id int64, now time.Time) service.CurrentState {
			observed := now.Add(-time.Second)
			return service.CurrentState{
				State: &vehiclemodel.VehicleState{
					VehicleID: id, State: "parked", BatteryLevel: 50,
				},
				Live:           true,
				DataSource:     service.DataSourceLiveSignalStore,
				ObservedAt:     &observed,
				Freshness:      service.FreshnessFresh,
				VerifiedFields: []string{"battery_level", "state"},
			}
		},
	}
}

func (b *bulkFakeResolver) ResolveCurrentState(
	_ context.Context,
	vehicle *vehiclemodel.Vehicle,
	_ signal.LiveSignalStore,
	now time.Time,
) (service.CurrentState, error) {
	b.mu.Lock()
	b.perVehicleCalls++
	b.mu.Unlock()
	return b.state(vehicle.ID, now), nil
}

func (b *bulkFakeResolver) PrefetchCurrentStates(
	ctx context.Context,
	vehicleIDs []int64,
	_ signal.LiveSignalStore,
	_ time.Time,
) (*service.CurrentStatePrefetch, error) {
	b.mu.Lock()
	b.prefetchCalls++
	b.prefetchIDs = append([]int64(nil), vehicleIDs...)
	err := b.prefetchErr
	delay := b.prefetchDelay
	b.mu.Unlock()
	if delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if err != nil {
		return nil, err
	}
	// A real prefetch is opaque to this package; an empty one is enough to
	// prove the batch threaded it through to the bulk resolution path.
	return &service.CurrentStatePrefetch{}, nil
}

func (b *bulkFakeResolver) ResolveCurrentStateWith(
	_ context.Context,
	vehicle *vehiclemodel.Vehicle,
	_ signal.LiveSignalStore,
	now time.Time,
	pre *service.CurrentStatePrefetch,
) (service.CurrentState, error) {
	b.mu.Lock()
	if pre == nil {
		b.nilPrefetch++
	} else {
		b.withPrefetch++
	}
	b.mu.Unlock()
	return b.state(vehicle.ID, now), nil
}

var _ bulkStateResolver = (*bulkFakeResolver)(nil)

func TestFleetStatesPrefetchesOncePerBatch(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(12)}
	resolver := newBulkFakeResolver()
	svc := New(Options{
		Vehicles: roster,
		Resolver: resolver,
		Now:      func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) },
	})

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if len(batch.Vehicles) != 12 {
		t.Fatalf("items = %d, want 12", len(batch.Vehicles))
	}
	resolver.mu.Lock()
	defer resolver.mu.Unlock()
	if resolver.prefetchCalls != 1 {
		t.Fatalf("prefetches = %d, want exactly 1 for the whole page", resolver.prefetchCalls)
	}
	if len(resolver.prefetchIDs) != 12 {
		t.Fatalf("prefetch covered %d vehicles, want the whole page", len(resolver.prefetchIDs))
	}
	if resolver.withPrefetch != 12 {
		t.Fatalf("bulk-aware resolutions = %d, want one per vehicle", resolver.withPrefetch)
	}
	if resolver.perVehicleCalls != 0 || resolver.nilPrefetch != 0 {
		t.Fatalf("batch fell back to per-vehicle reads: %d plain / %d nil-prefetch", resolver.perVehicleCalls, resolver.nilPrefetch)
	}
}

func TestFleetStatesPrefetchesOnlyThePagedVehicles(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(10)}
	resolver := newBulkFakeResolver()
	svc := New(Options{
		Vehicles: roster,
		Resolver: resolver,
		Now:      func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) },
	})

	if _, err := svc.FleetStates(context.Background(), Query{Limit: 3, Offset: 4}); err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	resolver.mu.Lock()
	defer resolver.mu.Unlock()
	if got := resolver.prefetchIDs; len(got) != 3 || got[0] != 5 || got[2] != 7 {
		t.Fatalf("prefetch ids = %v, want the paged window [5 6 7]", got)
	}
}

func TestFleetStatesStillAnswersWhenThePrefetchFails(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(3)}
	resolver := newBulkFakeResolver()
	resolver.prefetchErr = errors.New("context deadline exceeded")
	var reported error
	svc := New(Options{
		Vehicles:        roster,
		Resolver:        resolver,
		Now:             func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) },
		OnPrefetchError: func(_ context.Context, err error) { reported = err },
	})

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("a failed prefetch must degrade, not fail the batch: %v", err)
	}
	if batch.Counts.Resolved != 3 {
		t.Fatalf("resolved = %d, want the per-vehicle fallback to have answered all 3", batch.Counts.Resolved)
	}
	if reported == nil {
		t.Fatal("a prefetch failure must be reported, not swallowed")
	}
	resolver.mu.Lock()
	defer resolver.mu.Unlock()
	if resolver.perVehicleCalls != 3 {
		t.Fatalf("per-vehicle resolutions = %d, want the fallback path for every vehicle", resolver.perVehicleCalls)
	}
}

func TestFleetStatesBoundsSlowPrefetchAndRecoversThroughPerVehicleReads(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(3)}
	resolver := newBulkFakeResolver()
	resolver.prefetchDelay = time.Second
	var reported error
	svc := New(Options{
		Vehicles:        roster,
		Resolver:        resolver,
		Now:             func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) },
		PrefetchTimeout: 20 * time.Millisecond,
		OnPrefetchError: func(_ context.Context, err error) { reported = err },
	})

	startedAt := time.Now()
	batch, err := svc.FleetStates(context.Background(), Query{})
	elapsed := time.Since(startedAt)
	if err != nil {
		t.Fatalf("slow prefetch must degrade, not fail the batch: %v", err)
	}
	if elapsed >= 500*time.Millisecond {
		t.Fatalf("slow prefetch held the request for %v, want a bounded fallback", elapsed)
	}
	if !errors.Is(reported, context.DeadlineExceeded) {
		t.Fatalf("reported prefetch error = %v, want context deadline exceeded", reported)
	}
	if batch.Counts.Resolved != 3 {
		t.Fatalf("resolved = %d, want all vehicles recovered through fallback", batch.Counts.Resolved)
	}
	resolver.mu.Lock()
	defer resolver.mu.Unlock()
	if resolver.perVehicleCalls != 3 {
		t.Fatalf("per-vehicle fallback calls = %d, want 3", resolver.perVehicleCalls)
	}
}

func TestFleetStatesUsesPerVehiclePathWithoutBulkCapability(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(4)}
	// fakeResolver (service_test.go) implements ONLY the per-vehicle port.
	resolver := newFakeResolver()
	svc := newService(t, roster, resolver)

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Counts.Resolved != 4 {
		t.Fatalf("resolved = %d, want 4", batch.Counts.Resolved)
	}
	if resolver.callCount != 4 {
		t.Fatalf("resolver calls = %d, want one per vehicle", resolver.callCount)
	}
}

func TestFleetStatesCarriesTheServerDerivedSummary(t *testing.T) {
	roster := &fakeRoster{vehicles: fleet(3)}
	resolver := newBulkFakeResolver()
	svc := New(Options{
		Vehicles: roster,
		Resolver: resolver,
		Now:      func() time.Time { return time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC) },
	})

	batch, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("FleetStates: %v", err)
	}
	if batch.Summary.Counted != 3 {
		t.Fatalf("summary.counted = %d, want 3", batch.Summary.Counted)
	}
	if batch.Summary.VerifiedCount != 3 || batch.Summary.Operational.Parked != 3 {
		t.Fatalf("summary = %+v, want 3 trusted parked vehicles", batch.Summary)
	}
	if batch.Summary.OldestObservedAt == nil || !batch.Summary.OldestObservedAt.Equal(batch.Now.Add(-time.Second)) {
		t.Fatalf("oldest observation = %v, want the items' real observation instant", batch.Summary.OldestObservedAt)
	}
	// The summary describes the SAME items, against the SAME now.
	if batch.Summary.Counted != len(batch.Vehicles) {
		t.Fatalf("summary counts %d items but the page carries %d", batch.Summary.Counted, len(batch.Vehicles))
	}
}
