package fleetstatesvc

// Request coalescing + successful-result micro-cache.
//
// # The problem
//
// The fleet batch read is the SPA's hot path: every open tab polls it, an SSE
// burst can invalidate it for several tabs at once, and a fleet-wide refresh
// therefore arrives as N IDENTICAL requests within milliseconds of each other.
// Each of those requests independently re-read the whole roster, the whole L2
// hash set and the whole signal_log page.
//
// # What this adds
//
//   - Coalescing: concurrent IDENTICAL normalized requests share ONE
//     execution (golang.org/x/sync/singleflight, already in the module graph).
//   - A 1–2 second micro-cache of SUCCESSFUL results only, so the burst that
//     arrives just after an execution finishes is served without re-reading
//     storage. The window is deliberately shorter than the freshness window
//     it summarises and shorter than the SPA's SSE refetch throttle, so it
//     can never be the reason a Charging→Driving transition is late.
//
// # What this must never do
//
//   - Cache a whole-request failure. An error is per-request; caching it
//     would turn one transient roster failure into two seconds of guaranteed
//     failure for every caller.
//   - Leak vehicles across scopes. The key carries EVERY dimension that
//     changes the result: scope, the exact requested id set, limit and
//     offset. Two different questions cannot share an answer.
//   - Hand two callers the same mutable object. Every caller — cache hit,
//     coalesced follower or the executing leader — receives its own deep
//     copy, so one caller cannot mutate another's payload.
//   - Bind shared work to one caller's cancellation. The shared execution
//     runs on a context detached from the initiating request (values, and
//     therefore the trace, are preserved) under its own bound; each caller
//     still returns the instant ITS OWN context is done.

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// Micro-cache bounds.
//
// DefaultCacheTTL is the successful-result window. One second absorbs the
// multi-tab / SSE-burst thundering herd without ever being old enough to
// change a freshness verdict (the cross-pod window is two MINUTES).
//
// MaxCacheTTL caps whatever a deployment configures: past two seconds the
// cache starts hiding real transitions from the poll loop.
//
// maxCacheEntries bounds memory. Keys are caller-controlled (any id subset),
// so the map is size-limited and pruned rather than allowed to grow with the
// number of distinct questions ever asked.
const (
	DefaultCacheTTL = 1 * time.Second
	MaxCacheTTL     = 2 * time.Second
	maxCacheEntries = 64
)

// DefaultSharedWorkTimeout bounds a coalesced execution once it is detached
// from the request that started it. Without it, a wedged storage layer could
// keep a shared goroutine alive after every caller has gone.
const DefaultSharedWorkTimeout = 30 * time.Second

// CacheOutcome describes how one FleetStates call was served. It is reported
// through Options.OnCacheOutcome so the HTTP boundary can attach it to the
// active span/log without this package importing OpenTelemetry.
type CacheOutcome struct {
	// Key is the normalized cache key (scope + ids + paging). It contains no
	// user identity and no PII.
	Key string
	// Hit is true when the answer came from the micro-cache.
	Hit bool
	// Coalesced is true when this caller joined an execution started by
	// another caller instead of running its own.
	Coalesced bool
	// Age is how old the cached result was when served. Zero for a miss.
	Age time.Duration
}

// resultCache is the coalescing + micro-cache layer around one read function.
type resultCache struct {
	ttl         time.Duration
	workTimeout time.Duration
	now         func() time.Time
	onOutcome   func(context.Context, CacheOutcome)

	group singleflight.Group

	mu      sync.Mutex
	entries map[string]cacheEntry
}

type cacheEntry struct {
	batch     *Batch
	storedAt  time.Time
	expiresAt time.Time
}

func newResultCache(ttl, workTimeout time.Duration, now func() time.Time, onOutcome func(context.Context, CacheOutcome)) *resultCache {
	if ttl <= 0 {
		ttl = DefaultCacheTTL
	}
	if ttl > MaxCacheTTL {
		ttl = MaxCacheTTL
	}
	if workTimeout <= 0 {
		workTimeout = DefaultSharedWorkTimeout
	}
	if now == nil {
		now = time.Now
	}
	return &resultCache{
		ttl:         ttl,
		workTimeout: workTimeout,
		now:         now,
		onOutcome:   onOutcome,
		entries:     make(map[string]cacheEntry, maxCacheEntries),
	}
}

// do serves key from the micro-cache, joins an in-flight execution for the
// same key, or runs `fn` — in that order.
//
// The returned *Batch is ALWAYS a private deep copy.
func (c *resultCache) do(ctx context.Context, key string, fn func(context.Context) (*Batch, error)) (*Batch, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if batch, age, ok := c.load(key); ok {
		c.report(ctx, CacheOutcome{Key: key, Hit: true, Age: age})
		return batch, nil
	}

	// DoChan (not Do) so the caller can abandon a shared execution the moment
	// ITS context is done without cancelling the execution for everyone else.
	ch := c.group.DoChan(key, func() (any, error) {
		// Detached from the initiating request: values (trace, logger) are
		// preserved, cancellation is not, because the result belongs to every
		// waiter — including ones that arrive after the initiator gives up.
		//
		// Authorization safety: the shared execution inherits the INITIATING
		// request's context values, so it must never be able to produce a
		// result another waiter is not entitled to. That holds because the
		// read is a pure function of the KEY (scope + ids + paging) and the
		// roster, and never of any identity carried in the context. If a
		// caller-derived dimension is ever introduced, it MUST be added to
		// Query and therefore to the key — see ScopeGlobalRoster.
		workCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), c.workTimeout)
		defer cancel()

		batch, err := fn(workCtx)
		if err != nil {
			// Whole-request failures are NEVER cached.
			return nil, err
		}
		if batch == nil {
			return nil, fmt.Errorf("fleet state: nil batch from a successful read")
		}
		c.store(key, batch)
		return batch, nil
	})

	select {
	case <-ctx.Done():
		// This caller is gone. The shared execution continues for the others.
		return nil, ctx.Err()
	case res := <-ch:
		if res.Err != nil {
			return nil, res.Err
		}
		batch, ok := res.Val.(*Batch)
		if !ok || batch == nil {
			return nil, fmt.Errorf("fleet state: unexpected coalesced result type %T", res.Val)
		}
		c.report(ctx, CacheOutcome{Key: key, Coalesced: res.Shared})
		return batch.clone(), nil
	}
}

// load returns a private copy of a live cache entry.
func (c *resultCache) load(key string) (*Batch, time.Duration, bool) {
	now := c.now()
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return nil, 0, false
	}
	if !now.Before(entry.expiresAt) {
		delete(c.entries, key)
		return nil, 0, false
	}
	return entry.batch.clone(), now.Sub(entry.storedAt), true
}

// store keeps a private copy so a later mutation by any caller cannot reach
// the cached value.
func (c *resultCache) store(key string, batch *Batch) {
	now := c.now()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pruneLocked(now)
	c.entries[key] = cacheEntry{
		batch:     batch.clone(),
		storedAt:  now,
		expiresAt: now.Add(c.ttl),
	}
}

// pruneLocked drops expired entries and, if the map is still at its bound,
// the entry closest to expiry. Callers must hold c.mu.
func (c *resultCache) pruneLocked(now time.Time) {
	for key, entry := range c.entries {
		if !now.Before(entry.expiresAt) {
			delete(c.entries, key)
		}
	}
	for len(c.entries) >= maxCacheEntries {
		var oldestKey string
		var oldestAt time.Time
		for key, entry := range c.entries {
			if oldestKey == "" || entry.expiresAt.Before(oldestAt) {
				oldestKey, oldestAt = key, entry.expiresAt
			}
		}
		if oldestKey == "" {
			return
		}
		delete(c.entries, oldestKey)
	}
}

func (c *resultCache) report(ctx context.Context, outcome CacheOutcome) {
	if c.onOutcome == nil {
		return
	}
	c.onOutcome(ctx, outcome)
}

// cacheKey renders every dimension that can change the result.
//
// The query MUST already be normalized (ids sorted + de-duplicated, limit and
// offset clamped) so two spellings of the same question share one key and two
// different questions never can. The id list is rendered in full rather than
// hashed: a hash collision here would serve one scope's vehicles to another,
// and the list is bounded by MaxLimit anyway.
func cacheKey(q Query) string {
	var b strings.Builder
	b.WriteString("scope=")
	b.WriteString(q.Scope)
	b.WriteString("|limit=")
	b.WriteString(strconv.Itoa(q.Limit))
	b.WriteString("|offset=")
	b.WriteString(strconv.Itoa(q.Offset))
	b.WriteString("|ids=")
	if len(q.VehicleIDs) == 0 {
		// "the whole roster" is a DIFFERENT question from "these specific
		// ids", even when they currently select the same vehicles.
		b.WriteString("*")
		return b.String()
	}
	for i, id := range q.VehicleIDs {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatInt(id, 10))
	}
	return b.String()
}

// normalize returns the canonical form of a query: default scope, sorted +
// de-duplicated ids, clamped paging. It never mutates the caller's slice.
func normalize(q Query) Query {
	out := Query{
		Scope:  strings.TrimSpace(q.Scope),
		Limit:  q.Limit,
		Offset: q.Offset,
	}
	if out.Scope == "" {
		out.Scope = ScopeGlobalRoster
	}
	if out.Limit <= 0 {
		out.Limit = DefaultLimit
	}
	if out.Limit > MaxLimit {
		out.Limit = MaxLimit
	}
	if out.Offset < 0 {
		out.Offset = 0
	}
	if len(q.VehicleIDs) > 0 {
		seen := make(map[int64]struct{}, len(q.VehicleIDs))
		ids := make([]int64, 0, len(q.VehicleIDs))
		for _, id := range q.VehicleIDs {
			if id <= 0 {
				continue
			}
			if _, dup := seen[id]; dup {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		out.VehicleIDs = ids
	}
	return out
}

// clone returns a deep copy of a batch.
//
// Everything reachable from the copy is private to it: the item slice, each
// item's VehicleState, its ObservedAt instant and its VerifiedFields slice.
// Without this, a cache hit would hand two callers the same *VehicleState and
// one caller's post-processing would silently rewrite another's response.
func (b *Batch) clone() *Batch {
	if b == nil {
		return nil
	}
	out := *b
	if b.Summary.OldestObservedAt != nil {
		oldest := *b.Summary.OldestObservedAt
		out.Summary.OldestObservedAt = &oldest
	}
	if b.Summary.NewestObservedAt != nil {
		newest := *b.Summary.NewestObservedAt
		out.Summary.NewestObservedAt = &newest
	}
	if b.Vehicles == nil {
		return &out
	}
	out.Vehicles = make([]VehicleStateItem, len(b.Vehicles))
	for i := range b.Vehicles {
		out.Vehicles[i] = b.Vehicles[i].clone()
	}
	return &out
}

// clone returns a deep copy of one item.
func (i VehicleStateItem) clone() VehicleStateItem {
	out := i
	if i.State != nil {
		state := *i.State
		if i.State.Since != nil {
			since := *i.State.Since
			state.Since = &since
		}
		if i.State.Heading != nil {
			heading := *i.State.Heading
			state.Heading = &heading
		}
		out.State = &state
	}
	if i.ObservedAt != nil {
		observed := *i.ObservedAt
		out.ObservedAt = &observed
	}
	if i.VerifiedFields != nil {
		fields := make([]string, len(i.VerifiedFields))
		copy(fields, i.VerifiedFields)
		out.VerifiedFields = fields
	}
	return out
}
