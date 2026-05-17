package limit

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/ai/cost"
)

// CostRepo is the narrow port the [CostCap] consults to learn the
// user's accumulated spend so far today. The production wiring uses
// [internal/database.AICallLogRepo] (its Today method returns a
// CostMicroCents int64 — see the Adapter helper at the bottom of
// this file).
//
// The interface is deliberately minimal — TodaySpend is the ONLY
// dependency. Tests pass a tiny fake; no test database needed.
type CostRepo interface {
	// TodaySpend returns the sum of cost_micro_cents in ai_call_log
	// for `subject` since the current UTC midnight. err is non-nil
	// only on infrastructure failure (DB down). subject == "" is the
	// open-mode key per the audit log convention.
	TodaySpend(ctx context.Context, subject string) (microCents int64, err error)
}

// CapLookup is the function the [CostCap] consults to learn the
// user's daily cap (in cents — matches the
// [models.AppSettings.AICostCapCents] type). Returning 0 means
// "unset" and skips the check; a non-nil error fails-closed (per
// rubber-duck #4) with Decision.Reason="settings_unavailable" so a
// settings-store outage doesn't silently bill the user past their
// intended limit.
type CapLookup func(ctx context.Context, subject string) (capCents int, err error)

// CostCap enforces a per-subject daily cost ceiling. The ceiling
// lives in user settings (cents); the spend lives in ai_call_log
// (micro-cents). The cap layer:
//
//  1. Caches the today-spend per subject for [cacheTTL] so a chatbot
//     burst doesn't hit the DB on every chunk.
//  2. Tracks an in-flight reservation of estimated cost between
//     Check() and Release() so two concurrent calls cannot both
//     pass the cap while the first is still streaming.
//  3. Returns BannerLevel="warn" at 80% of cap so the UI can prompt
//     the user before they hit the wall.
//
// Safe for concurrent use. Per-subject mutex serialises the
// cache+reservation read-modify-write.
type CostCap struct {
	repo  CostRepo
	cap   CapLookup
	clock Clock

	cacheTTL time.Duration

	mu      sync.Mutex
	entries map[string]*cacheEntry
}

const (
	// cacheTTLDefault is the maximum age of a today-spend cache entry
	// before the next Check() refetches from the repo. 30s is a
	// compromise between "the user sees a near-real-time spend bar"
	// and "we don't hit the DB for every streaming chunk".
	cacheTTLDefault = 30 * time.Second

	// warnThresholdNum/Den expresses the 80% warn threshold as
	// integer math so we never lose precision on small caps.
	warnThresholdNum = 4
	warnThresholdDen = 5
)

// cacheEntry is the per-subject snapshot. pending is the sum of
// estimated micro-cents reserved for in-flight calls; it
// monotonically rises until the matching Release() decrements.
type cacheEntry struct {
	mu        sync.Mutex
	today     int64 // last-known DB value in micro-cents
	pending   int64 // sum of in-flight reservations in micro-cents
	fetchedAt time.Time
}

// CostCapOption configures a [CostCap] at construction.
type CostCapOption func(*CostCap)

// WithCostClock overrides the default [SystemClock].
func WithCostClock(c Clock) CostCapOption {
	return func(cc *CostCap) {
		if c != nil {
			cc.clock = c
		}
	}
}

// WithCacheTTL overrides the default 30s today-spend cache TTL. Pass
// 0 to disable caching (every Check hits the repo).
func WithCacheTTL(d time.Duration) CostCapOption {
	return func(cc *CostCap) { cc.cacheTTL = d }
}

// NewCostCap constructs a CostCap. repo is required (the cap reads
// today-spend from it on every cache miss); capLookup is required
// (without a cap there's no reason to instantiate this type — the
// decorator should be omitted from the chain instead).
func NewCostCap(repo CostRepo, capLookup CapLookup, opts ...CostCapOption) *CostCap {
	if repo == nil {
		panic("ai/limit: NewCostCap called with nil CostRepo")
	}
	if capLookup == nil {
		panic("ai/limit: NewCostCap called with nil CapLookup")
	}
	cc := &CostCap{
		repo:     repo,
		cap:      capLookup,
		clock:    SystemClock{},
		cacheTTL: cacheTTLDefault,
		entries:  make(map[string]*cacheEntry, 4),
	}
	for _, o := range opts {
		o(cc)
	}
	return cc
}

// Check evaluates whether `subject` may dispatch a call estimated at
// (estInputTokens, estOutputTokens) against (provider, model). Returns:
//
//   - Decision{Allowed:true} (with optional BannerLevel="warn") on
//     success. The caller MUST invoke release() after the call
//     completes — pass the actual final cost in micro-cents so the
//     reservation is updated and the cache stays accurate. Calling
//     release(-1) (or any negative) means "use my original estimate"
//     and is the safe choice when the actual cost can't be measured.
//
//   - Decision{Allowed:false, Reason:"cost_cap"} when the projected
//     spend would exceed the cap. release() is a no-op.
//
//   - Decision{Allowed:false, Reason:"settings_unavailable"} when
//     the cap lookup errored — fail-closed.
//
// estInputTokens / estOutputTokens are estimates; for streaming calls
// pass the user's prompt length + the strategy's MaxTokens budget so
// the worst case is reserved up front. The actual cost is reconciled
// at release().
func (c *CostCap) Check(
	ctx context.Context,
	subject, providerName, model string,
	estInputTokens, estOutputTokens int,
) (Decision, func(actualMicroCents int64), error) {
	noop := func(int64) {}

	capCents, err := c.cap(ctx, subject)
	if err != nil {
		return Decision{
			Allowed:           false,
			Reason:            "settings_unavailable",
			BannerLevel:       "critical",
			BaselineAvailable: true,
		}, noop, nil // return nil err — Decision encodes the failure
	}
	if capCents <= 0 {
		// Unset cap = unbounded. Skip cache + repo so an unconfigured
		// install does zero DB work.
		return AllowedDecision(), noop, nil
	}

	estimateMc := cost.Compute(providerName, model, estInputTokens, estOutputTokens)
	capMc := int64(capCents) * cost.MicroCentsPerCent

	entry := c.entryFor(subject)

	entry.mu.Lock()
	defer entry.mu.Unlock()

	if err := c.refreshLocked(ctx, subject, entry); err != nil {
		return Decision{
			Allowed:           false,
			Reason:            "cost_cap_unavailable",
			BannerLevel:       "critical",
			BaselineAvailable: true,
		}, noop, fmt.Errorf("cost cap repo: %w", err)
	}

	projected := entry.today + entry.pending + estimateMc

	if projected > capMc {
		return Decision{
			Allowed:           false,
			Reason:            "cost_cap",
			RetryAfter:        timeUntilNextUTCDay(c.clock.Now()),
			BannerLevel:       "critical",
			BaselineAvailable: true,
		}, noop, nil
	}

	// Reserve.
	entry.pending += estimateMc
	reserved := estimateMc

	released := false
	release := func(actualMc int64) {
		entry.mu.Lock()
		defer entry.mu.Unlock()
		if released {
			return
		}
		released = true
		// Drop the reservation; the audit decorator will write the
		// real row, and the next refresh after cacheTTL will pick it
		// up. Until then, optimistically advance `today` by the
		// observed actual so concurrent Checks see the update right
		// away (avoids the "two simultaneous Checks both pass at 99%
		// of cap" race).
		entry.pending -= reserved
		if entry.pending < 0 {
			entry.pending = 0
		}
		if actualMc < 0 {
			actualMc = reserved // caller said "use estimate"
		}
		entry.today += actualMc
	}

	d := AllowedDecision()
	if projected*warnThresholdDen >= capMc*warnThresholdNum {
		d.BannerLevel = "warn"
	}
	return d, release, nil
}

// entryFor returns the cache entry for subject, creating one on miss.
// Outer mutex protects the map; the inner per-entry mutex protects
// the fields. Two-level locking prevents one slow subject from
// blocking unrelated subjects.
func (c *CostCap) entryFor(subject string) *cacheEntry {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[subject]; ok {
		return e
	}
	e := &cacheEntry{}
	c.entries[subject] = e
	return e
}

// refreshLocked refetches the today-spend if the cache is stale.
// Caller MUST hold entry.mu. A non-nil error means the repo failed —
// the caller fails-closed.
func (c *CostCap) refreshLocked(ctx context.Context, subject string, entry *cacheEntry) error {
	now := c.clock.Now()
	if c.cacheTTL > 0 && !entry.fetchedAt.IsZero() && now.Sub(entry.fetchedAt) < c.cacheTTL {
		return nil
	}
	mc, err := c.repo.TodaySpend(ctx, subject)
	if err != nil {
		return err
	}
	entry.today = mc
	entry.fetchedAt = now
	return nil
}

// Snapshot returns the (cached) today-spend + pending for diagnostics
// (the /api/v1/ai/usage endpoint can render this without forcing a
// refresh). Returns 0,0 for an unknown subject. Safe for concurrent
// use.
func (c *CostCap) Snapshot(subject string) (todayMicroCents, pendingMicroCents int64) {
	c.mu.Lock()
	entry, ok := c.entries[subject]
	c.mu.Unlock()
	if !ok {
		return 0, 0
	}
	entry.mu.Lock()
	defer entry.mu.Unlock()
	return entry.today, entry.pending
}

// AICallLogTodayAdapter wraps a CostRepo whose source returns the
// full aggregate row. It is the preferred wiring at boot so the
// repo type stays free of CostRepo's narrow shape. Production wiring:
//
//	cap := limit.NewCostCap(
//	    limit.AICallLogTodayAdapter(repo.AICallLog().Today),
//	    capLookup,
//	)
func AICallLogTodayAdapter(today func(ctx context.Context, subject string) (micro int64, err error)) CostRepo {
	return costRepoFunc(today)
}

// costRepoFunc adapts a function value to CostRepo without exposing
// a public function-typed implementation.
type costRepoFunc func(ctx context.Context, subject string) (int64, error)

// TodaySpend implements [CostRepo].
func (f costRepoFunc) TodaySpend(ctx context.Context, subject string) (int64, error) {
	return f(ctx, subject)
}
