package fleetstatesvc

// Coalescing + micro-cache tests.
//
// Every property this layer claims is asserted here, because each one is a
// correctness or a SECURITY property rather than an optimisation detail:
// key isolation (no vehicle leaks between scopes or id sets), expiry, "errors
// are never cached", copy safety, and cancellation that belongs to the caller
// rather than to the shared execution.

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// clock is a manually-advanced time source so expiry is deterministic.
type clock struct {
	mu sync.Mutex
	at time.Time
}

func newClock() *clock {
	return &clock{at: time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)}
}

func (c *clock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.at
}

func (c *clock) advance(d time.Duration) {
	c.mu.Lock()
	c.at = c.at.Add(d)
	c.mu.Unlock()
}

// countingRoster counts roster reads, which is the cheapest proxy for "the
// batch actually executed".
type countingRoster struct {
	mu       sync.Mutex
	vehicles []*vehiclemodel.Vehicle
	err      error
	calls    int
	block    chan struct{}
}

func (c *countingRoster) GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error) {
	c.mu.Lock()
	c.calls++
	block := c.block
	err := c.err
	vehicles := c.vehicles
	c.mu.Unlock()

	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if err != nil {
		return nil, err
	}
	return vehicles, nil
}

func (c *countingRoster) callCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

func newCachedService(t *testing.T, roster *countingRoster, clk *clock, apply ...func(*Options)) *Service {
	t.Helper()
	opt := Options{
		Vehicles: roster,
		Resolver: newFakeResolver(),
		Now:      clk.now,
		CacheTTL: DefaultCacheTTL,
	}
	for _, fn := range apply {
		fn(&opt)
	}
	return New(opt)
}

// ── Cache behaviour ─────────────────────────────────────────────────────────

func TestCacheServesIdenticalRequestsFromOneExecution(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(3)}
	svc := newCachedService(t, roster, clk)

	for i := 0; i < 5; i++ {
		batch, err := svc.FleetStates(context.Background(), Query{VehicleIDs: []int64{1, 2, 3}})
		if err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
		if len(batch.Vehicles) != 3 {
			t.Fatalf("call %d returned %d items, want 3", i, len(batch.Vehicles))
		}
	}
	if roster.callCount() != 1 {
		t.Fatalf("storage reads = %d, want 1 — identical requests inside the window must share a result", roster.callCount())
	}
}

func TestCacheNormalizesEquivalentQueriesToOneKey(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(3)}
	svc := newCachedService(t, roster, clk)

	// Same question, three spellings: order, duplicates and a default limit.
	queries := []Query{
		{VehicleIDs: []int64{3, 1, 2}},
		{VehicleIDs: []int64{1, 2, 3, 3}},
		{VehicleIDs: []int64{2, 1, 3}, Limit: DefaultLimit, Offset: 0},
	}
	for i, q := range queries {
		if _, err := svc.FleetStates(context.Background(), q); err != nil {
			t.Fatalf("query %d: %v", i, err)
		}
	}
	if roster.callCount() != 1 {
		t.Fatalf("storage reads = %d, want 1 — equivalent queries must normalize to one key", roster.callCount())
	}
}

func TestCacheExpiresAfterItsWindow(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(2)}
	svc := newCachedService(t, roster, clk)

	if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
		t.Fatalf("first call: %v", err)
	}
	clk.advance(DefaultCacheTTL - time.Millisecond)
	if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
		t.Fatalf("inside window: %v", err)
	}
	if roster.callCount() != 1 {
		t.Fatalf("storage reads = %d inside the window, want 1", roster.callCount())
	}

	clk.advance(2 * time.Millisecond)
	if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
		t.Fatalf("after expiry: %v", err)
	}
	if roster.callCount() != 2 {
		t.Fatalf("storage reads = %d after expiry, want a fresh read", roster.callCount())
	}
}

func TestCacheClampsTTLToTheMaximum(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(1)}
	svc := newCachedService(t, roster, clk, func(o *Options) { o.CacheTTL = time.Hour })

	if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
		t.Fatalf("first call: %v", err)
	}
	clk.advance(MaxCacheTTL + time.Millisecond)
	if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
		t.Fatalf("second call: %v", err)
	}
	if roster.callCount() != 2 {
		t.Fatalf("storage reads = %d, want the TTL clamped to %v", roster.callCount(), MaxCacheTTL)
	}
}

func TestCacheIsDisabledByDefault(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(1)}
	svc := New(Options{Vehicles: roster, Resolver: newFakeResolver(), Now: clk.now})

	for i := 0; i < 3; i++ {
		if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
	}
	if roster.callCount() != 3 {
		t.Fatalf("storage reads = %d, want 3 — caching must be opt-in", roster.callCount())
	}
}

// ── Key isolation (authorization safety) ────────────────────────────────────

func TestCacheNeverSharesResultsAcrossKeys(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(4)}
	svc := newCachedService(t, roster, clk)

	cases := []struct {
		name string
		q    Query
	}{
		{"subset A", Query{VehicleIDs: []int64{1, 2}}},
		{"subset B", Query{VehicleIDs: []int64{3, 4}}},
		{"overlapping subset", Query{VehicleIDs: []int64{2, 3}}},
		{"whole roster", Query{}},
		{"page 2", Query{Limit: 2, Offset: 2}},
		{"page 1", Query{Limit: 2, Offset: 0}},
		{"other scope", Query{Scope: "tenant-b", VehicleIDs: []int64{1, 2}}},
	}
	seen := make(map[string]bool, len(cases))
	for _, tc := range cases {
		key := cacheKey(normalize(tc.q))
		if seen[key] {
			t.Fatalf("%s collided with an earlier key: %q", tc.name, key)
		}
		seen[key] = true
		if _, err := svc.FleetStates(context.Background(), tc.q); err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
	}
	if roster.callCount() != len(cases) {
		t.Fatalf("storage reads = %d, want %d — each distinct question must execute", roster.callCount(), len(cases))
	}
}

func TestCacheKeyIsolatesScopesWithIdenticalFilters(t *testing.T) {
	// The deployment assumption (ONE global roster) is documented on
	// ScopeGlobalRoster. This test pins the mechanism that keeps that
	// assumption safe to relax: the same ids under two scopes are two
	// different questions and can never share an answer.
	global := cacheKey(normalize(Query{VehicleIDs: []int64{1, 2}}))
	explicit := cacheKey(normalize(Query{Scope: ScopeGlobalRoster, VehicleIDs: []int64{1, 2}}))
	other := cacheKey(normalize(Query{Scope: "tenant-b", VehicleIDs: []int64{1, 2}}))

	if global != explicit {
		t.Fatalf("an empty scope must normalize to the documented global roster: %q vs %q", global, explicit)
	}
	if global == other {
		t.Fatalf("two scopes shared a cache key: %q", global)
	}
}

func TestCacheKeySeparatesWholeRosterFromAnExplicitIDSet(t *testing.T) {
	// "everything" and "these three" are different questions even when they
	// currently select the same cars: the roster can change between them.
	all := cacheKey(normalize(Query{}))
	explicit := cacheKey(normalize(Query{VehicleIDs: []int64{1, 2, 3}}))
	if all == explicit {
		t.Fatalf("whole-roster and explicit-id queries shared a key: %q", all)
	}
}

// ── Failures are never cached ───────────────────────────────────────────────

func TestCacheNeverCachesAWholeRequestFailure(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{err: errors.New("pool exhausted")}
	svc := newCachedService(t, roster, clk)

	for i := 0; i < 3; i++ {
		if _, err := svc.FleetStates(context.Background(), Query{}); err == nil {
			t.Fatalf("call %d: a roster failure must surface", i)
		}
	}
	if roster.callCount() != 3 {
		t.Fatalf("storage reads = %d, want 3 — a failure must never be cached", roster.callCount())
	}

	// Recovery must be immediate, not delayed until a TTL expires.
	roster.mu.Lock()
	roster.err = nil
	roster.vehicles = fleet(1)
	roster.mu.Unlock()
	if _, err := svc.FleetStates(context.Background(), Query{}); err != nil {
		t.Fatalf("recovery call: %v", err)
	}
}

// ── Copy safety ─────────────────────────────────────────────────────────────

func TestCacheHandsEveryCallerItsOwnCopy(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(2)}
	svc := newCachedService(t, roster, clk)

	first, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	// A caller mutates everything reachable from its own response.
	first.Vehicles[0].State.BatteryLevel = -1
	first.Vehicles[0].State.State = "tampered"
	first.Vehicles[0].VerifiedFields[0] = "tampered"
	first.Vehicles[0].Outcome = OutcomeFailed
	*first.Vehicles[0].ObservedAt = time.Unix(0, 0).UTC()
	first.Summary.VerifiedCount = 999
	if first.Summary.OldestObservedAt != nil {
		*first.Summary.OldestObservedAt = time.Unix(0, 0).UTC()
	}

	second, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if roster.callCount() != 1 {
		t.Fatalf("the second call must have been a cache hit; storage reads = %d", roster.callCount())
	}
	if second.Vehicles[0].State.BatteryLevel != 50 {
		t.Fatalf("battery_level = %d, want the cached value untouched by another caller", second.Vehicles[0].State.BatteryLevel)
	}
	if second.Vehicles[0].State.State == "tampered" {
		t.Fatal("one caller's mutation reached another caller's state")
	}
	if second.Vehicles[0].VerifiedFields[0] == "tampered" {
		t.Fatal("one caller's mutation reached another caller's verified_fields")
	}
	if second.Vehicles[0].Outcome != OutcomeResolved {
		t.Fatalf("outcome = %q, want the cached outcome untouched", second.Vehicles[0].Outcome)
	}
	if second.Vehicles[0].ObservedAt.Equal(time.Unix(0, 0).UTC()) {
		t.Fatal("one caller's mutation reached another caller's observed_at")
	}
	if second.Summary.VerifiedCount == 999 {
		t.Fatal("one caller's mutation reached another caller's summary")
	}
	if second.Summary.OldestObservedAt != nil && second.Summary.OldestObservedAt.Equal(time.Unix(0, 0).UTC()) {
		t.Fatal("one caller's mutation reached another caller's summary instant")
	}
	if second.Vehicles[0].State == first.Vehicles[0].State {
		t.Fatal("two callers received the SAME *VehicleState pointer")
	}
}

// ── Coalescing + cancellation ───────────────────────────────────────────────

func TestCacheCoalescesConcurrentIdenticalRequests(t *testing.T) {
	clk := newClock()
	release := make(chan struct{})
	roster := &countingRoster{vehicles: fleet(2), block: release}
	var outcomes []CacheOutcome
	var outcomeMu sync.Mutex
	svc := newCachedService(t, roster, clk, func(o *Options) {
		o.OnCacheOutcome = func(_ context.Context, outcome CacheOutcome) {
			outcomeMu.Lock()
			outcomes = append(outcomes, outcome)
			outcomeMu.Unlock()
		}
	})

	const callers = 6
	var wg sync.WaitGroup
	errs := make([]error, callers)
	batches := make([]*Batch, callers)
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			batches[i], errs[i] = svc.FleetStates(context.Background(), Query{VehicleIDs: []int64{1, 2}})
		}(i)
	}
	// Give every caller time to arrive before the single execution completes.
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("caller %d: %v", i, err)
		}
		if len(batches[i].Vehicles) != 2 {
			t.Fatalf("caller %d got %d items, want 2", i, len(batches[i].Vehicles))
		}
	}
	if roster.callCount() != 1 {
		t.Fatalf("storage reads = %d, want exactly 1 for %d concurrent identical requests", roster.callCount(), callers)
	}
	// Distinct payloads per caller, even when the work was shared.
	for i := 1; i < callers; i++ {
		if batches[i] == batches[0] {
			t.Fatal("two coalesced callers received the SAME *Batch pointer")
		}
	}
	outcomeMu.Lock()
	defer outcomeMu.Unlock()
	if len(outcomes) != callers {
		t.Fatalf("cache outcomes reported = %d, want one per caller", len(outcomes))
	}
}

func TestCacheCoalescesLargeBurstWhileCanceledCallersExitIndependently(t *testing.T) {
	clk := newClock()
	release := make(chan struct{})
	roster := &countingRoster{vehicles: fleet(100), block: release}
	svc := newCachedService(t, roster, clk)

	const callers = 64
	start := make(chan struct{})
	contexts := make([]context.Context, callers)
	cancels := make([]context.CancelFunc, callers)
	errs := make([]error, callers)
	batches := make([]*Batch, callers)
	finished := make(chan int, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		contexts[i], cancels[i] = context.WithCancel(context.Background())
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			defer func() { finished <- index }()
			<-start
			batches[index], errs[index] = svc.FleetStates(contexts[index], Query{Limit: 100})
		}(i)
	}
	close(start)

	deadline := time.Now().Add(2 * time.Second)
	for roster.callCount() != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if roster.callCount() != 1 {
		t.Fatalf("shared execution did not start exactly once; calls=%d", roster.callCount())
	}
	// Give the followers time to join the singleflight before half of the
	// callers independently abandon their waits.
	time.Sleep(50 * time.Millisecond)
	for i := 0; i < callers/2; i++ {
		cancels[i]()
	}
	for i := 0; i < callers/2; i++ {
		select {
		case index := <-finished:
			if index >= callers/2 {
				t.Fatalf("live caller %d completed while shared work was blocked", index)
			}
			if !errors.Is(errs[index], context.Canceled) {
				t.Errorf("canceled caller %d error = %v, want context.Canceled", index, errs[index])
			}
		case <-time.After(2 * time.Second):
			t.Fatal("canceled callers did not exit independently of shared work")
		}
	}
	close(release)
	wg.Wait()
	for _, cancel := range cancels {
		cancel()
	}

	for i := 0; i < callers; i++ {
		if i < callers/2 {
			continue
		}
		if errs[i] != nil {
			t.Errorf("live caller %d error = %v", i, errs[i])
		} else if len(batches[i].Vehicles) != 100 {
			t.Errorf("live caller %d received %d vehicles, want 100", i, len(batches[i].Vehicles))
		}
	}
	if roster.callCount() != 1 {
		t.Fatalf("storage reads = %d, want one coalesced execution for %d callers", roster.callCount(), callers)
	}
}

func TestCacheReturnsWhenTheCallersContextIsCancelled(t *testing.T) {
	clk := newClock()
	release := make(chan struct{})
	roster := &countingRoster{vehicles: fleet(2), block: release}
	svc := newCachedService(t, roster, clk)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := svc.FleetStates(ctx, Query{})
		done <- err
	}()
	time.Sleep(25 * time.Millisecond)
	cancel()

	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("err = %v, want the caller's own cancellation", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a cancelled caller must return immediately, not wait for the shared execution")
	}
	// The shared execution keeps running for the other waiters.
	close(release)
}

func TestCacheDetachesSharedWorkFromTheInitiatorsCancellation(t *testing.T) {
	clk := newClock()
	release := make(chan struct{})
	roster := &countingRoster{vehicles: fleet(2), block: release}
	svc := newCachedService(t, roster, clk)

	initiator, cancelInitiator := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		_, err := svc.FleetStates(initiator, Query{})
		firstDone <- err
	}()
	time.Sleep(25 * time.Millisecond)

	secondDone := make(chan error, 1)
	go func() {
		_, err := svc.FleetStates(context.Background(), Query{})
		secondDone <- err
	}()
	time.Sleep(25 * time.Millisecond)

	// The initiator walks away; the follower must still get its answer.
	cancelInitiator()
	if err := <-firstDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("initiator err = %v, want its own cancellation", err)
	}
	close(release)

	select {
	case err := <-secondDone:
		if err != nil {
			t.Fatalf("follower err = %v; the initiator's cancellation must not cancel shared work", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the follower never received the shared result")
	}
	if roster.callCount() != 1 {
		t.Fatalf("storage reads = %d, want the single shared execution", roster.callCount())
	}
}

func TestCacheRejectsAnAlreadyCancelledCallerWithoutReadingStorage(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(1)}
	svc := newCachedService(t, roster, clk)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := svc.FleetStates(ctx, Query{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if roster.callCount() != 0 {
		t.Fatalf("storage reads = %d, want 0 for an already-cancelled caller", roster.callCount())
	}
}

// ── Eviction ────────────────────────────────────────────────────────────────

func TestCacheBoundsItsEntryCount(t *testing.T) {
	clk := newClock()
	cache := newResultCache(DefaultCacheTTL, DefaultSharedWorkTimeout, clk.now, nil)
	for i := 0; i < maxCacheEntries*3; i++ {
		batch := &Batch{Now: clk.now()}
		cache.store(cacheKey(normalize(Query{VehicleIDs: []int64{int64(i + 1)}})), batch)
	}
	cache.mu.Lock()
	size := len(cache.entries)
	cache.mu.Unlock()
	if size > maxCacheEntries {
		t.Fatalf("cache holds %d entries, want at most %d", size, maxCacheEntries)
	}
}

func TestCacheSurvivesANilBatchFromTheReader(t *testing.T) {
	cache := newResultCache(DefaultCacheTTL, DefaultSharedWorkTimeout, newClock().now, nil)
	_, err := cache.do(context.Background(), "k", func(context.Context) (*Batch, error) { return nil, nil })
	if err == nil {
		t.Fatal("a nil batch from a 'successful' read must be an error, not a cached empty fleet")
	}
}

// summaryIsCarriedThroughTheCache proves the derived summary survives the
// copy — a client painting from the cached response must see the same posture
// as one painting from a fresh execution.
func TestCachedBatchKeepsItsSummary(t *testing.T) {
	clk := newClock()
	roster := &countingRoster{vehicles: fleet(2)}
	svc := newCachedService(t, roster, clk)

	fresh, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	cached, err := svc.FleetStates(context.Background(), Query{})
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if fresh.Summary.Counted != cached.Summary.Counted ||
		fresh.Summary.VerifiedCount != cached.Summary.VerifiedCount ||
		fresh.Summary.Operational != cached.Summary.Operational ||
		fresh.Summary.Attention != cached.Summary.Attention {
		t.Fatalf("cached summary differs:\nfresh  %+v\ncached %+v", fresh.Summary, cached.Summary)
	}
}

// compile-time proof the fake resolver still satisfies the port the cache
// tests construct the service with.
var _ stateResolver = (*fakeResolver)(nil)
