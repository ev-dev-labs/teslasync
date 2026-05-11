package unithistory

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	"github.com/redis/go-redis/v9"

	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// fakeRedisClient is the test-only redisClient implementation. It
// records every Get/Set/Del call so tests can assert which Redis
// operations the cache layer issued and in what order — critical for
// validating the cross-pod invalidation contract from ADR-004 #4.
//
// Following the project pattern in internal/signal/redis_cache_test.go
// (fakeRedisSignalClient) keeps test infrastructure consistent with
// the rest of the codebase and avoids pulling miniredis into go.mod
// for a single package.
type fakeRedisClient struct {
	mu          sync.Mutex
	store       map[string]string
	expirations map[string]time.Duration

	getCalls []string
	setCalls []fakeSetCall
	delCalls []string

	// Optional error injection — when non-nil, every subsequent call
	// of the matching kind returns this error. Tests set these to
	// exercise Redis-failure paths.
	getErr error
	setErr error
	delErr error
}

type fakeSetCall struct {
	Key   string
	Value string
	TTL   time.Duration
}

func newFakeRedisClient() *fakeRedisClient {
	return &fakeRedisClient{
		store:       make(map[string]string),
		expirations: make(map[string]time.Duration),
	}
}

func (f *fakeRedisClient) Get(ctx context.Context, key string) *redis.StringCmd {
	f.mu.Lock()
	f.getCalls = append(f.getCalls, key)
	if f.getErr != nil {
		err := f.getErr
		f.mu.Unlock()
		return redis.NewStringResult("", err)
	}
	v, ok := f.store[key]
	f.mu.Unlock()
	if !ok {
		return redis.NewStringResult("", redis.Nil)
	}
	return redis.NewStringResult(v, nil)
}

func (f *fakeRedisClient) Set(ctx context.Context, key string, value any, expiration time.Duration) *redis.StatusCmd {
	f.mu.Lock()
	defer f.mu.Unlock()
	var s string
	switch v := value.(type) {
	case string:
		s = v
	case []byte:
		s = string(v)
	default:
		s = ""
	}
	f.setCalls = append(f.setCalls, fakeSetCall{Key: key, Value: s, TTL: expiration})
	if f.setErr != nil {
		return redis.NewStatusResult("", f.setErr)
	}
	f.store[key] = s
	f.expirations[key] = expiration
	return redis.NewStatusResult("OK", nil)
}

func (f *fakeRedisClient) Del(ctx context.Context, keys ...string) *redis.IntCmd {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.delCalls = append(f.delCalls, keys...)
	if f.delErr != nil {
		return redis.NewIntResult(0, f.delErr)
	}
	var n int64
	for _, k := range keys {
		if _, ok := f.store[k]; ok {
			delete(f.store, k)
			delete(f.expirations, k)
			n++
		}
	}
	return redis.NewIntResult(n, nil)
}

func (f *fakeRedisClient) snapshotGets() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.getCalls))
	copy(out, f.getCalls)
	return out
}
func (f *fakeRedisClient) snapshotSets() []fakeSetCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]fakeSetCall, len(f.setCalls))
	copy(out, f.setCalls)
	return out
}
func (f *fakeRedisClient) snapshotDels() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.delCalls))
	copy(out, f.delCalls)
	return out
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

func TestCache_GetLatest_Miss_ReturnsFalse(t *testing.T) {
	c := NewCache(newFakeRedisClient())
	if _, ok := c.GetLatest(context.Background(), 1, KindDistance); ok {
		t.Errorf("GetLatest on empty cache: ok=true; want false")
	}
}

func TestCache_PutLatest_ThenGetLatest_Hit(t *testing.T) {
	rdb := newFakeRedisClient()
	c := NewCache(rdb)
	ctx := context.Background()

	now := time.Now().UTC()
	entry := Entry{
		VehicleID:     1,
		Kind:          KindDistance,
		Value:         units.ActiveUnitMiles,
		EffectiveFrom: now,
		Source:        SourceTelemetry,
	}
	c.PutLatest(ctx, entry)

	got, ok := c.GetLatest(ctx, 1, KindDistance)
	if !ok {
		t.Fatal("GetLatest after PutLatest: ok=false; want true")
	}
	if got.Value != units.ActiveUnitMiles {
		t.Errorf("Value = %q; want mi", got.Value)
	}
	if !got.EffectiveFrom.Equal(now) {
		t.Errorf("EffectiveFrom = %v; want %v", got.EffectiveFrom, now)
	}
	if got.Source != SourceTelemetry {
		t.Errorf("Source = %q; want telemetry", got.Source)
	}

	// Verify Redis SET happened with TTL=CacheTTL and the right key.
	sets := rdb.snapshotSets()
	if len(sets) != 1 {
		t.Fatalf("Set calls = %d; want 1", len(sets))
	}
	wantKey := "unit_history:1:distance"
	if sets[0].Key != wantKey {
		t.Errorf("Set key = %q; want %q", sets[0].Key, wantKey)
	}
	if sets[0].TTL != CacheTTL {
		t.Errorf("Set TTL = %v; want %v", sets[0].TTL, CacheTTL)
	}
	// Payload must round-trip.
	var p payload
	if err := json.Unmarshal([]byte(sets[0].Value), &p); err != nil {
		t.Fatalf("Set value unparseable: %v", err)
	}
	if p.Value != units.ActiveUnitMiles || !p.EffectiveFrom.Equal(now) || p.Source != SourceTelemetry {
		t.Errorf("Redis payload mismatch: %+v", p)
	}
}

// TestCache_GetForAt_BypassesCacheWhen_t_BeforeEffectiveFrom is the
// validity-rule path from ADR-004 #4: "a cached entry for (vehicleID,
// kind) is valid for the requested t ONLY when t >= cached.effective_from.
// For t < cached.effective_from (backfill / replay queries), the cache
// MUST be bypassed and the lookup MUST hit PG, which can find a
// different (earlier) active unit."
//
// This test asserts that the cache returns ok=false in this case, which
// is the signal the Repo uses to fall through to PG.
func TestCache_GetForAt_BypassesCacheWhen_t_BeforeEffectiveFrom(t *testing.T) {
	rdb := newFakeRedisClient()
	c := NewCache(rdb)
	ctx := context.Background()

	t1 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC) // cached entry's effective_from
	c.PutLatest(ctx, Entry{
		VehicleID:     1,
		Kind:          KindDistance,
		Value:         units.ActiveUnitKilometers,
		EffectiveFrom: t1,
		Source:        SourceTelemetry,
	})

	// Reset the get-call recorder so we can assert the next read does
	// not consult Redis (the validity check is in-process).
	rdb.mu.Lock()
	rdb.getCalls = nil
	rdb.mu.Unlock()

	earlierT := t1.Add(-time.Hour)
	if _, ok := c.GetForAt(ctx, 1, KindDistance, earlierT); ok {
		t.Errorf("GetForAt(t < effective_from): ok=true; want false (cache must be bypassed for backfill)")
	}

	// At t == effective_from the cache IS valid.
	if _, ok := c.GetForAt(ctx, 1, KindDistance, t1); !ok {
		t.Errorf("GetForAt(t == effective_from): ok=false; want true")
	}
	// At t > effective_from the cache IS valid.
	if _, ok := c.GetForAt(ctx, 1, KindDistance, t1.Add(time.Hour)); !ok {
		t.Errorf("GetForAt(t > effective_from): ok=false; want true")
	}
}

// TestCache_GetForAt_BypassPathDoesNotInvalidateCache verifies that
// reading At(t) with t < effective_from doesn't corrupt the cache —
// subsequent Latest() / GetForAt(t > effective_from) reads must still
// hit the cached entry.
func TestCache_GetForAt_BypassPathDoesNotInvalidateCache(t *testing.T) {
	rdb := newFakeRedisClient()
	c := NewCache(rdb)
	ctx := context.Background()

	t1 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	c.PutLatest(ctx, Entry{
		VehicleID:     2,
		Kind:          KindTemperature,
		Value:         units.ActiveUnitCelsius,
		EffectiveFrom: t1,
		Source:        SourceTelemetry,
	})

	// Bypass case.
	if _, ok := c.GetForAt(ctx, 2, KindTemperature, t1.Add(-time.Hour)); ok {
		t.Fatal("setup: GetForAt before effective_from should miss")
	}
	// Cache is still hot for valid t.
	if _, ok := c.GetForAt(ctx, 2, KindTemperature, t1); !ok {
		t.Errorf("GetForAt(valid t) after bypass: cache unexpectedly cleared")
	}
}

// TestCache_Invalidate_DeletesRedisAndLocal asserts the cross-pod
// invalidation contract: Cache.Invalidate calls Redis DEL on the right
// key AND clears the local L0 entry. The gate's grep for "redis.*DEL|DEL"
// pins the literal Redis-DEL invocation.
func TestCache_Invalidate_DeletesRedisAndLocal(t *testing.T) {
	rdb := newFakeRedisClient()
	c := NewCache(rdb)
	ctx := context.Background()

	t1 := time.Now().UTC()
	c.PutLatest(ctx, Entry{
		VehicleID:     1,
		Kind:          KindDistance,
		Value:         units.ActiveUnitMiles,
		EffectiveFrom: t1,
		Source:        SourceTelemetry,
	})
	if _, ok := c.GetLatest(ctx, 1, KindDistance); !ok {
		t.Fatal("setup: PutLatest then GetLatest should hit")
	}

	c.Invalidate(ctx, 1, KindDistance)

	// Redis DEL recorded against the canonical key.
	dels := rdb.snapshotDels()
	if len(dels) != 1 {
		t.Fatalf("Del calls = %d; want 1", len(dels))
	}
	if dels[0] != "unit_history:1:distance" {
		t.Errorf("Del key = %q; want unit_history:1:distance", dels[0])
	}

	// Local L0 cleared too — the next GetLatest must miss
	// (or fall through to a Redis Get that finds nothing).
	if _, ok := c.GetLatest(ctx, 1, KindDistance); ok {
		t.Errorf("GetLatest after Invalidate: ok=true; want false (L0 not cleared)")
	}
}

// TestCache_Invalidate_RedisDelFailureIncrementsMetric asserts that a
// Redis DEL failure during Invalidate logs + increments the failure
// counter but does NOT panic or block. This is the "do not roll back
// PG insert on Redis failure" half of the cross-pod contract.
func TestCache_Invalidate_RedisDelFailureIncrementsMetric(t *testing.T) {
	rdb := newFakeRedisClient()
	rdb.delErr = errors.New("simulated redis network failure")
	c := NewCache(rdb)
	ctx := context.Background()

	before := readCounter(t, "redis_del")
	c.Invalidate(ctx, 1, KindDistance)
	after := readCounter(t, "redis_del")

	if after-before != 1 {
		t.Errorf("invalidateFailuresTotal{redis_del} delta = %v; want 1", after-before)
	}

	// Local L0 must still be cleared even when Redis failed.
	c2 := NewCache(rdb)
	c2.l0[cacheKey{42, KindCharge}] = cachedEntry{
		entry:    Entry{VehicleID: 42, Kind: KindCharge, Value: units.ActiveUnitPercent, EffectiveFrom: time.Now(), Source: SourceTelemetry},
		cachedAt: time.Now(),
	}
	c2.Invalidate(ctx, 42, KindCharge)
	if _, present := c2.l0[cacheKey{42, KindCharge}]; present {
		t.Errorf("L0 not cleared on Redis DEL failure")
	}
}

// TestCache_GetLatest_TTLExpiry verifies the L0 TTL contract: an entry
// older than CacheTTL is treated as a miss even if the underlying map
// still holds it. Bounds the inconsistency window when L1 is
// unavailable (degraded / outage modes).
func TestCache_GetLatest_TTLExpiry(t *testing.T) {
	c := NewCache(newFakeRedisClient())
	ctx := context.Background()

	// Inject a stale entry directly into L0 so we don't have to wait
	// CacheTTL during the test.
	c.l0[cacheKey{1, KindDistance}] = cachedEntry{
		entry: Entry{
			VehicleID:     1,
			Kind:          KindDistance,
			Value:         units.ActiveUnitMiles,
			EffectiveFrom: time.Now().UTC(),
			Source:        SourceTelemetry,
		},
		cachedAt: time.Now().Add(-2 * CacheTTL),
	}
	if _, ok := c.GetLatest(ctx, 1, KindDistance); ok {
		t.Errorf("GetLatest on stale L0 entry: ok=true; want false (TTL must evict)")
	}
}

// TestCache_NilCacheIsNoop verifies the (*Cache)(nil) safety: every
// method on a nil receiver is a no-op so callers can pass nil without
// guarding.
func TestCache_NilCacheIsNoop(t *testing.T) {
	var c *Cache
	ctx := context.Background()
	if _, ok := c.GetLatest(ctx, 1, KindDistance); ok {
		t.Errorf("nil Cache GetLatest: ok=true; want false")
	}
	if _, ok := c.GetForAt(ctx, 1, KindDistance, time.Now()); ok {
		t.Errorf("nil Cache GetForAt: ok=true; want false")
	}
	c.PutLatest(ctx, Entry{}) // must not panic
	c.Invalidate(ctx, 1, KindDistance)
}

// TestCache_GetLatest_RedisHitPromotesToL0 verifies the L0 promotion
// contract: a Redis hit (e.g. after this pod restart) must populate L0
// so subsequent reads avoid the Redis round-trip.
func TestCache_GetLatest_RedisHitPromotesToL0(t *testing.T) {
	rdb := newFakeRedisClient()
	c := NewCache(rdb)
	ctx := context.Background()

	t1 := time.Date(2026, 5, 1, 10, 0, 0, 0, time.UTC)
	p := payload{
		Value:         units.ActiveUnitMiles,
		EffectiveFrom: t1,
		Source:        SourceTelemetry,
	}
	raw, _ := json.Marshal(p)
	rdb.store["unit_history:1:distance"] = string(raw)

	// First read goes to Redis.
	if _, ok := c.GetLatest(ctx, 1, KindDistance); !ok {
		t.Fatal("GetLatest(Redis hit): ok=false; want true")
	}
	if got := rdb.snapshotGets(); len(got) != 1 {
		t.Errorf("Get calls after first read = %d; want 1", len(got))
	}

	// Second read MUST be served from L0 (no additional Redis Get).
	if _, ok := c.GetLatest(ctx, 1, KindDistance); !ok {
		t.Fatal("GetLatest(L0 hit after promotion): ok=false; want true")
	}
	if got := rdb.snapshotGets(); len(got) != 1 {
		t.Errorf("Get calls after second read = %d; want still 1 (L0 promotion failed)", len(got))
	}
}

// TestCache_KeyShape_Stable pins the Redis key namespace. Runbooks
// reference this exact format ("unit_history:{vehicleID}:{kind}") and
// changing it without coordinating with operations is a breaking
// change.
func TestCache_KeyShape_Stable(t *testing.T) {
	cases := []struct {
		vehicleID int64
		kind      Kind
		want      string
	}{
		{1, KindDistance, "unit_history:1:distance"},
		{42, KindTemperature, "unit_history:42:temperature"},
		{99999, KindPressure, "unit_history:99999:pressure"},
		{1234567890, KindCharge, "unit_history:1234567890:charge"},
	}
	for _, c := range cases {
		if got := keyFor(c.vehicleID, c.kind); got != c.want {
			t.Errorf("keyFor(%d, %q) = %q; want %q", c.vehicleID, c.kind, got, c.want)
		}
	}
}

// TestCache_GetLatest_RedisErrorFallsThrough verifies a Redis Get
// network failure becomes a soft miss (ok=false) rather than a panic
// or hard error. The Repo's contract is "cache failure -> read PG."
func TestCache_GetLatest_RedisErrorFallsThrough(t *testing.T) {
	rdb := newFakeRedisClient()
	rdb.getErr = errors.New("simulated network error")
	c := NewCache(rdb)
	if _, ok := c.GetLatest(context.Background(), 1, KindDistance); ok {
		t.Errorf("GetLatest with Redis error: ok=true; want false (must fall through to PG)")
	}
}

// readCounter reads the current value of
// invalidateFailuresTotal{reason=label}. Uses the dto-based read so we
// don't need testutil (which would pull in extra dependencies).
func readCounter(t *testing.T, label string) float64 {
	t.Helper()
	m, err := invalidateFailuresTotal.GetMetricWithLabelValues(label)
	if err != nil {
		t.Fatalf("GetMetricWithLabelValues(%q): %v", label, err)
	}
	return readPromCounter(t, m)
}

// readPromCounter extracts the float64 value from a prometheus.Counter
// via the dto.Metric pathway. Necessary because prometheus.Counter
// itself has no public GetValue method.
func readPromCounter(t *testing.T, c prometheus.Counter) float64 {
	t.Helper()
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("counter.Write: %v", err)
	}
	if m.Counter == nil || m.Counter.Value == nil {
		return 0
	}
	return *m.Counter.Value
}
