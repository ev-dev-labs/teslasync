package mqtt

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// fakeLoader is a recording stub of VINCacheLoader. The Snapshots queue is
// a slice of (snapshot, err) results; each call pops one until it
// permanently returns the last entry.
type fakeLoader struct {
	mu        sync.Mutex
	calls     atomic.Int64
	snapshots []fakeLoaderResult
}

type fakeLoaderResult struct {
	snap map[string]int64
	err  error
}

func (f *fakeLoader) load(_ context.Context) (map[string]int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls.Add(1)
	if len(f.snapshots) == 0 {
		return map[string]int64{}, nil
	}
	r := f.snapshots[0]
	if len(f.snapshots) > 1 {
		f.snapshots = f.snapshots[1:]
	}
	if r.snap == nil {
		return nil, r.err
	}
	out := make(map[string]int64, len(r.snap))
	for k, v := range r.snap {
		out[k] = v
	}
	return out, r.err
}

// fakeResolver is the DB-backed fallback.
type fakeResolver struct {
	mu    sync.Mutex
	calls atomic.Int64
	table map[string]int64
	err   error
}

func (f *fakeResolver) resolve(_ context.Context, vin string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls.Add(1)
	if f.err != nil {
		return 0, f.err
	}
	id, ok := f.table[vin]
	if !ok {
		return 0, ErrUnknownVIN
	}
	return id, nil
}

func newTestCache(t *testing.T, loader *fakeLoader, resolver *fakeResolver, cfg VINCacheConfig) *VINCache {
	t.Helper()
	c := NewVINCache(
		context.Background(),
		loader.load,
		resolver.resolve,
		cfg,
		zerolog.New(zerolog.NewTestWriter(t)),
	)
	t.Cleanup(c.Close)
	return c
}

func TestVINCache_Preload_PopulatesSnapshot(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{
		{snap: map[string]int64{"V1": 1, "V2": 2, "V3": 3}},
	}}
	resolver := &fakeResolver{}
	c := newTestCache(t, loader, resolver, VINCacheConfig{
		PreloadTimeout:  time.Second,
		RefreshInterval: -1, // disable background refresh for determinism
	})

	if got := c.Size(); got != 3 {
		t.Errorf("Size() after preload = %d, want 3", got)
	}
	for vin, want := range map[string]int64{"V1": 1, "V2": 2, "V3": 3} {
		got, err := c.Resolve(context.Background(), vin)
		if err != nil {
			t.Errorf("Resolve(%q) err = %v", vin, err)
		}
		if got != want {
			t.Errorf("Resolve(%q) = %d, want %d", vin, got, want)
		}
	}
	if resolver.calls.Load() != 0 {
		t.Errorf("resolver.calls = %d after pure-hit lookups, want 0", resolver.calls.Load())
	}
	for id, wantVIN := range map[int64]string{1: "V1", 2: "V2", 3: "V3"} {
		got, ok := c.VINByID(id)
		if !ok || got != wantVIN {
			t.Errorf("VINByID(%d) = (%q, %v), want (%q, true)", id, got, ok, wantVIN)
		}
	}
}

func TestVINCache_PreloadFailure_StartsEmpty_FallbackResolves(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{
		{err: errors.New("DB unreachable")},
	}}
	resolver := &fakeResolver{table: map[string]int64{"V1": 42}}
	c := newTestCache(t, loader, resolver, VINCacheConfig{
		PreloadTimeout:  100 * time.Millisecond,
		RefreshInterval: -1,
	})

	if got := c.Size(); got != 0 {
		t.Errorf("Size() after preload failure = %d, want 0", got)
	}
	id, err := c.Resolve(context.Background(), "V1")
	if err != nil {
		t.Fatalf("Resolve(V1) after preload failure err = %v", err)
	}
	if id != 42 {
		t.Errorf("Resolve(V1) = %d, want 42", id)
	}
	// Memoised positively now.
	if got := c.Size(); got != 1 {
		t.Errorf("Size() after on-miss fill = %d, want 1", got)
	}
	if _, err := c.Resolve(context.Background(), "V1"); err != nil {
		t.Errorf("second Resolve(V1) err = %v", err)
	}
	if resolver.calls.Load() != 1 {
		t.Errorf("resolver.calls = %d, want 1 (second lookup must hit cache)", resolver.calls.Load())
	}
}

func TestVINCache_UnknownVIN_NegativeCacheStable(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{{snap: map[string]int64{"V1": 1}}}}
	resolver := &fakeResolver{table: map[string]int64{"V1": 1}}
	c := newTestCache(t, loader, resolver, VINCacheConfig{RefreshInterval: -1})

	// First miss for an unknown VIN -> resolver returns ErrUnknownVIN -> cached.
	_, err := c.Resolve(context.Background(), "FOREIGN")
	if !errors.Is(err, ErrUnknownVIN) {
		t.Fatalf("first Resolve(FOREIGN) err = %v, want ErrUnknownVIN", err)
	}
	if resolver.calls.Load() != 1 {
		t.Fatalf("resolver.calls after first miss = %d, want 1", resolver.calls.Load())
	}
	// Second miss must NOT reach the resolver.
	_, err = c.Resolve(context.Background(), "FOREIGN")
	if !errors.Is(err, ErrUnknownVIN) {
		t.Errorf("second Resolve(FOREIGN) err = %v, want ErrUnknownVIN", err)
	}
	if resolver.calls.Load() != 1 {
		t.Errorf("resolver.calls after second miss = %d, want 1 (negative cache must hold)", resolver.calls.Load())
	}
}

func TestVINCache_TransientResolverError_NotMemoised(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{{snap: map[string]int64{}}}}
	resolver := &fakeResolver{err: errors.New("DB outage")}
	c := newTestCache(t, loader, resolver, VINCacheConfig{RefreshInterval: -1})

	_, err := c.Resolve(context.Background(), "V1")
	if err == nil || errors.Is(err, ErrUnknownVIN) {
		t.Fatalf("first Resolve(V1) on transient err = %v, want non-nil non-ErrUnknownVIN", err)
	}
	// Switch the resolver to a successful one and retry.
	resolver.mu.Lock()
	resolver.err = nil
	resolver.table = map[string]int64{"V1": 99}
	resolver.mu.Unlock()
	id, err := c.Resolve(context.Background(), "V1")
	if err != nil {
		t.Fatalf("retry Resolve(V1) err = %v", err)
	}
	if id != 99 {
		t.Errorf("retry Resolve(V1) = %d, want 99", id)
	}
}

func TestVINCache_RefreshPicksUpNewVehicles(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{
		{snap: map[string]int64{"V1": 1}},          // preload
		{snap: map[string]int64{"V1": 1, "V2": 2}}, // refresh tick
	}}
	resolver := &fakeResolver{}
	c := newTestCache(t, loader, resolver, VINCacheConfig{
		PreloadTimeout:  time.Second,
		RefreshInterval: 20 * time.Millisecond,
		RefreshTimeout:  time.Second,
	})

	// Wait for at least one refresh tick.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if c.Size() == 2 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if got := c.Size(); got != 2 {
		t.Fatalf("Size() after refresh tick = %d, want 2", got)
	}
	id, err := c.Resolve(context.Background(), "V2")
	if err != nil {
		t.Errorf("Resolve(V2) after refresh err = %v", err)
	}
	if id != 2 {
		t.Errorf("Resolve(V2) after refresh = %d, want 2", id)
	}
}

func TestVINCache_RefreshEvictsRemovedVehicles(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{
		{snap: map[string]int64{"V1": 1, "V2": 2}}, // preload
		{snap: map[string]int64{"V1": 1}},          // V2 deleted
	}}
	resolver := &fakeResolver{} // empty - will return ErrUnknownVIN
	c := newTestCache(t, loader, resolver, VINCacheConfig{
		PreloadTimeout:  time.Second,
		RefreshInterval: 20 * time.Millisecond,
		RefreshTimeout:  time.Second,
	})

	// Preload should give Size=2.
	if got := c.Size(); got != 2 {
		t.Fatalf("Size() after preload = %d, want 2", got)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if c.Size() == 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if got := c.Size(); got != 1 {
		t.Fatalf("Size() after refresh-eviction = %d, want 1", got)
	}
	// V2 should now resolve as ErrUnknownVIN via the empty resolver.
	if _, err := c.Resolve(context.Background(), "V2"); !errors.Is(err, ErrUnknownVIN) {
		t.Errorf("Resolve(V2) after eviction err = %v, want ErrUnknownVIN", err)
	}
}

func TestVINCache_RefreshClearsNegativeCacheForNowKnownVIN(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{
		{snap: map[string]int64{}},         // preload empty
		{snap: map[string]int64{"V1": 42}}, // refresh adds V1
	}}
	resolver := &fakeResolver{} // empty - will negative-cache V1 first
	c := newTestCache(t, loader, resolver, VINCacheConfig{
		PreloadTimeout:  time.Second,
		RefreshInterval: 20 * time.Millisecond,
		RefreshTimeout:  time.Second,
	})

	// Trigger negative-cache entry for V1.
	if _, err := c.Resolve(context.Background(), "V1"); !errors.Is(err, ErrUnknownVIN) {
		t.Fatalf("first Resolve(V1) err = %v, want ErrUnknownVIN", err)
	}

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if c.Size() == 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	id, err := c.Resolve(context.Background(), "V1")
	if err != nil {
		t.Fatalf("Resolve(V1) after refresh err = %v, want nil", err)
	}
	if id != 42 {
		t.Errorf("Resolve(V1) after refresh = %d, want 42", id)
	}
}

func TestVINCache_NilLoaderOrResolverPanics(t *testing.T) {
	mustPanic(t, "nil loader", func() {
		NewVINCache(context.Background(), nil, func(context.Context, string) (int64, error) { return 0, nil }, VINCacheConfig{}, zerolog.Nop())
	})
	mustPanic(t, "nil resolver", func() {
		NewVINCache(context.Background(), func(context.Context) (map[string]int64, error) { return nil, nil }, nil, VINCacheConfig{}, zerolog.Nop())
	})
}

func TestVINCache_Close_StopsRefresher(t *testing.T) {
	loader := &fakeLoader{snapshots: []fakeLoaderResult{{snap: map[string]int64{}}}}
	resolver := &fakeResolver{}
	c := NewVINCache(
		context.Background(),
		loader.load,
		resolver.resolve,
		VINCacheConfig{PreloadTimeout: time.Second, RefreshInterval: 20 * time.Millisecond},
		zerolog.New(zerolog.NewTestWriter(t)),
	)
	c.Close()
	c.Close() // idempotent

	preCalls := loader.calls.Load()
	time.Sleep(80 * time.Millisecond)
	if loader.calls.Load() != preCalls {
		t.Errorf("loader.calls grew after Close; want refresher to have stopped")
	}
}
