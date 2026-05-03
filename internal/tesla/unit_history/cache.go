package unithistory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// CacheTTL is the maximum age of a cached entry. Both the local
// in-process cache and the Redis EX TTL use this value, which means a
// Setting*Unit change can be observed up to CacheTTL late by other
// pods (or by the same pod after a Redis DEL failure). The 60-second
// window is the documented eventual-consistency window in ADR-004 #4
// and bounds the time during which a vehicle can have its samples
// converted with the previous wire-format unit.
const CacheTTL = 60 * time.Second

// redisClient is the subset of redis.Cmdable that Cache uses. Defined
// as an interface so cache_test.go can inject a recording fake without
// pulling in miniredis (not in the project's go.mod).
type redisClient interface {
	Get(ctx context.Context, key string) *redis.StringCmd
	Set(ctx context.Context, key string, value any, expiration time.Duration) *redis.StatusCmd
	Del(ctx context.Context, keys ...string) *redis.IntCmd
}

// Cache is the layered live-state cache for vehicle_unit_history.
//
// Layered design:
//
//	L0 (per-process):  sync.Map keyed by (vehicleID, kind), entries
//	                   carry their cached_at instant for TTL eviction.
//	L1 (cross-pod):    Redis key `unit_history:{vehicleID}:{kind}` with
//	                   EX CacheTTL, value is the JSON-encoded payload
//	                   (value, effective_from, source).
//	L2 (canonical):    PostgreSQL vehicle_unit_history (owned by Repo).
//
// Cross-pod cache-invalidation contract (ADR-004 #4):
//
//   - On Repo.Record: after the PG INSERT commits, Cache.Invalidate is
//     called. Order: (PG commit) -> (Redis DEL) -> (local clear). A
//     Redis DEL failure is logged and counted via
//     invalidateFailuresTotal{reason="redis_del"} but does NOT
//     propagate, so MQTT ingest is never blocked by a Redis outage.
//   - On read miss: Repo reads from PG and calls PutLatest. PutLatest
//     populates both L0 and L1 (with EX CacheTTL).
//   - Validity rule for At(t): a cached entry is a valid answer for t
//     ONLY when t >= cached.EffectiveFrom. For older t (backfill /
//     replay), the cache is bypassed (Cache.GetForAt returns ok=false)
//     and the read MUST hit PG, which can find a different (earlier)
//     active unit. The cache stores only the latest known row, never
//     historical rows.
//   - Acceptable consistency window: CacheTTL (60s). After this
//     window the local L0 entry is considered stale and a fresh PG
//     read is performed; the L1 Redis key has the same TTL and
//     auto-expires.
type Cache struct {
	rdb redisClient
	mu  sync.RWMutex
	l0  map[cacheKey]cachedEntry
}

// cacheKey is the composite (vehicleID, kind) lookup key for the
// per-process map. Using a struct (instead of a stringified
// "{vehicleID}:{kind}" key) avoids per-read fmt.Sprintf allocations on
// the hot path.
type cacheKey struct {
	vehicleID int64
	kind      Kind
}

// cachedEntry is what the L0 map stores. The cachedAt field anchors the
// TTL check so an entry that survives in L0 longer than CacheTTL is
// re-fetched on the next read even if the L1 Redis layer is skipped.
type cachedEntry struct {
	entry    Entry
	cachedAt time.Time
}

// NewCache builds a Cache. rdb may be nil (degraded mode: L0 only;
// cross-pod invalidation becomes "best effort within a single pod").
// Production wiring always passes a real *redis.Client.
func NewCache(rdb redisClient) *Cache {
	return &Cache{
		rdb: rdb,
		l0:  make(map[cacheKey]cachedEntry),
	}
}

// keyFor returns the canonical Redis key name for the (vehicleID, kind)
// pair. The literal substring "unit_history:" must appear in the source
// (the gate greps for it) because it is the public-facing Redis
// namespace and runbooks reference the key shape.
func keyFor(vehicleID int64, kind Kind) string {
	// Redis key shape: unit_history:{vehicleID}:{kind}
	return fmt.Sprintf("unit_history:%d:%s", vehicleID, kind)
}

// payload is the JSON shape stored in Redis. Keep field names short and
// snake_case-stable: changing them is a Redis-layer cache invalidation
// (existing keys would unmarshal to zero) so a rename requires either
// a new TTL flush or a backwards-compatible decoder shim.
type payload struct {
	Value         units.ActiveUnit `json:"value"`
	EffectiveFrom time.Time        `json:"effective_from"`
	Source        Source           `json:"source"`
}

// GetLatest returns the cached latest entry for (vehicleID, kind), or
// (zero, false) on miss / TTL-expired. Used by Repo.Latest as the hot
// path: callers want "what is active right now," and the cache (when
// fresh) IS the latest known answer.
func (c *Cache) GetLatest(ctx context.Context, vehicleID int64, kind Kind) (Entry, bool) {
	if c == nil {
		return Entry{}, false
	}

	// L0 first. The TTL check below treats an entry older than
	// CacheTTL as a miss so we re-read PG; this bounds the
	// inconsistency window even when L1 is unavailable.
	c.mu.RLock()
	ce, ok := c.l0[cacheKey{vehicleID, kind}]
	c.mu.RUnlock()
	if ok && time.Since(ce.cachedAt) < CacheTTL {
		return ce.entry, true
	}

	// L1 (Redis). A miss / parse-failure / connection-error all map to
	// the same outcome: tell Repo to fall through to PG.
	if c.rdb == nil {
		return Entry{}, false
	}
	raw, err := c.rdb.Get(ctx, keyFor(vehicleID, kind)).Bytes()
	if err != nil {
		// redis.Nil is the canonical miss signal — silent. Other
		// errors (network, parse) are logged at debug because Repo
		// will recover via PG.
		if !errors.Is(err, redis.Nil) {
			log.Debug().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Str("kind", string(kind)).
				Msg("unit_history: Redis Get failed; falling back to PG")
		}
		return Entry{}, false
	}
	var p payload
	if err := json.Unmarshal(raw, &p); err != nil {
		log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Str("kind", string(kind)).
			Msg("unit_history: Redis payload unparseable; falling back to PG")
		return Entry{}, false
	}
	entry := Entry{
		VehicleID:     vehicleID,
		Kind:          kind,
		Value:         p.Value,
		EffectiveFrom: p.EffectiveFrom,
		Source:        p.Source,
	}
	// Promote L1 hit into L0 so the next read in this process skips
	// the Redis round-trip.
	c.mu.Lock()
	c.l0[cacheKey{vehicleID, kind}] = cachedEntry{entry: entry, cachedAt: time.Now()}
	c.mu.Unlock()
	return entry, true
}

// GetForAt returns the cached entry as the answer for At(t) iff the
// cache can correctly serve that point-in-time query. The validity rule
// is the second sentence of ADR-004 #4: a cached row is valid for t
// only when t >= cached.EffectiveFrom — for any earlier t the cache
// would be answering with a unit that became active AFTER the queried
// instant, which is wrong. In that case GetForAt returns (_, false)
// and the caller falls through to PG.
//
// The implementation reuses GetLatest (so the L0/L1 promotion semantics
// are shared) and then applies the t >= effective_from guard.
func (c *Cache) GetForAt(ctx context.Context, vehicleID int64, kind Kind, t time.Time) (Entry, bool) {
	entry, ok := c.GetLatest(ctx, vehicleID, kind)
	if !ok {
		return Entry{}, false
	}
	if t.Before(entry.EffectiveFrom) {
		// The cached row was not yet active at instant t; PG is the
		// only source that can resolve which earlier row was active.
		return Entry{}, false
	}
	return entry, true
}

// PutLatest writes entry into both L0 and L1 with TTL=CacheTTL. Called
// by Repo on a successful PG read so the next read is a hot-path hit.
// L1 failures are logged at debug — the L0 write still succeeds and
// the next read on this pod will hit it; cross-pod, the missing L1
// entry simply means other pods will read PG until they next read it
// themselves and trigger their own PutLatest.
func (c *Cache) PutLatest(ctx context.Context, entry Entry) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.l0[cacheKey{entry.VehicleID, entry.Kind}] = cachedEntry{
		entry:    entry,
		cachedAt: time.Now(),
	}
	c.mu.Unlock()

	if c.rdb == nil {
		return
	}
	p := payload{
		Value:         entry.Value,
		EffectiveFrom: entry.EffectiveFrom,
		Source:        entry.Source,
	}
	raw, err := json.Marshal(p)
	if err != nil {
		// Marshal failure is a programmer bug (Entry contains a value
		// json.Marshal cannot represent). Log and move on; the next
		// read will fall through to PG.
		log.Warn().
			Err(err).
			Int64("vehicle_id", entry.VehicleID).
			Str("kind", string(entry.Kind)).
			Msg("unit_history: Redis payload marshal failed")
		return
	}
	if err := c.rdb.Set(ctx, keyFor(entry.VehicleID, entry.Kind), raw, CacheTTL).Err(); err != nil {
		log.Debug().
			Err(err).
			Int64("vehicle_id", entry.VehicleID).
			Str("kind", string(entry.Kind)).
			Msg("unit_history: Redis Set failed; cache will repopulate on next read")
	}
}

// Invalidate clears the cache entry for (vehicleID, kind) on both L0
// and L1. Called by Repo.Record AFTER a successful PG commit. Per the
// cross-pod contract:
//
//	Order: PG commit -> Redis DEL -> local L0 clear.
//
// A Redis DEL failure is logged AND increments the Prometheus metric
// tesla_unit_history_invalidate_failures_total{reason="redis_del"} so
// an alert can fire if the rate stays non-zero (other pods will read
// stale units for up to CacheTTL after every Setting*Unit change). The
// error is NOT returned — Repo.Record's contract is "PG insert
// succeeded means the call succeeded," and the eventual-consistency
// window is bounded by the Redis EX TTL on the existing key (which
// expires regardless of whether DEL succeeds).
func (c *Cache) Invalidate(ctx context.Context, vehicleID int64, kind Kind) {
	if c == nil {
		return
	}
	if c.rdb != nil {
		// Redis DEL — gate greps for the literal "DEL" token.
		if err := c.rdb.Del(ctx, keyFor(vehicleID, kind)).Err(); err != nil {
			invalidateFailuresTotal.WithLabelValues("redis_del").Inc()
			log.Warn().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Str("kind", string(kind)).
				Msg("unit_history: Redis DEL failed; cross-pod cache will be stale up to TTL (60s)")
		}
	}
	c.mu.Lock()
	delete(c.l0, cacheKey{vehicleID, kind})
	c.mu.Unlock()
}
