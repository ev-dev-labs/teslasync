package limit

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ErrFeatureUnknown is returned by [Limiter.Allow] when the supplied
// feature ID is not registered in [TierResolver]. We fail loudly rather
// than fall back to defaults so a
// missing-registry typo surfaces as a 4xx instead of a silent quiet
// quota.
var ErrFeatureUnknown = errors.New("ai/limit: feature ID not registered")

// TierResolver decouples the limiter from the canonical
// [internal/ai/features] registry so the limit package stays
// independently testable. Production wiring passes
// [features.RegistryTierResolver] (a tiny shim) at construction.
//
// Tier returns the canonical tier code (see [FeatureTier] constants).
// ok=false means the featureID is not registered; the limiter
// translates that into Decision.Reason="unknown_feature_id".
type TierResolver interface {
	Tier(featureID string) (tier string, ok bool)
}

// QuotaResolver is the optional override hook. When non-nil the
// limiter consults it FIRST for a (featureID) override; on miss it
// falls back to [DefaultQuotaForTier] keyed by the resolver tier.
// Used by the Settings UI's per-feature overrides (admin-only) and
// by tests that want a tight quota to assert rejection.
type QuotaResolver interface {
	Quota(featureID string) (q Quota, ok bool)
}

// Limiter is the per-(subject, feature) token-bucket + sliding window
// + inflight tracker. Buckets are constructed lazily on first
// Allow(); a stale bucket (no traffic for 24h) is left in place — the
// memory footprint is bounded by `(subject × feature)` cardinality
// which for a single-tenant TeslaSync install is O(features).
//
// Safe for concurrent use. The package-level sync.Map handles bucket
// lookup; per-bucket operations take the bucket's own mutex.
type Limiter struct {
	clock        Clock
	tiers        TierResolver
	quotas       QuotaResolver // optional; nil = always use defaults
	buckets      sync.Map      // map[bucketKey]*bucket
	suspMu       sync.RWMutex
	suspProvider map[string]time.Time // provider name -> suspended-until
}

// Option configures a [Limiter] at construction. Defined as a typed
// function so future knobs (e.g. metrics namespace) extend cleanly.
type Option func(*Limiter)

// WithClock overrides the default [SystemClock]. Tests pass
// [NewFakeClock] for determinism.
func WithClock(c Clock) Option {
	return func(l *Limiter) {
		if c != nil {
			l.clock = c
		}
	}
}

// WithQuotaResolver installs a per-feature quota override resolver.
// Pass nil (or omit the option) to use only the default tier table.
func WithQuotaResolver(r QuotaResolver) Option {
	return func(l *Limiter) { l.quotas = r }
}

// New builds a Limiter. The TierResolver is required (the limiter
// fails-loud on unknown features so it cannot be nil). Production
// wiring passes a shim around [features.Registry].
func New(tiers TierResolver, opts ...Option) *Limiter {
	if tiers == nil {
		panic("ai/limit: New called with nil TierResolver — pass features.RegistryTierResolver")
	}
	l := &Limiter{
		clock:        SystemClock{},
		tiers:        tiers,
		suspProvider: make(map[string]time.Time, 4),
	}
	for _, o := range opts {
		o(l)
	}
	return l
}

// bucketKey is the composite map key for the buckets sync.Map. Using
// a typed struct (rather than a hash-collidable formatted string)
// makes the bucket lookup unambiguous and lets future per-vehicle
// scoping slot in without restringing the key.
type bucketKey struct {
	Subject string
	Feature string
}

// bucket holds the per-(subject, feature) live counters. The bucket
// is reset lazily on read — the next Allow that observes a new minute
// or new UTC day window decrements/refills as needed.
type bucket struct {
	mu sync.Mutex

	quota Quota

	// Token bucket for PerMinute. tokens is fractional
	// (refill happens continuously); capacity == quota.PerMinute.
	tokens     float64
	lastRefill time.Time

	// Per-day rolling counter, reset at the next UTC midnight.
	dayCount int
	dayStart time.Time

	// Per-minute observed token windows. Reset on every minute
	// boundary read.
	minuteStart time.Time
	minuteIn    int
	minuteOut   int

	// Inflight count (BurstReq).
	inflight int
}

// Allow checks whether (subject, feature) may dispatch a call right
// now. Returns:
//
// - Decision{Allowed:true} on success — caller MUST invoke the
// returned release() func when the call completes (success or
// failure) to decrement the inflight counter. Calling release()
// a second time is a no-op.
// - Decision{Allowed:false, Reason:...} on rejection — release()
// is a no-op on a rejected call (no inflight slot was taken).
//
// The decorator wraps the returned release in the chunk channel for
// streaming calls so the inflight slot frees on stream close /
// context cancel / error frame, never leaking.
//
// providerName is consulted against the suspend table; the empty
// string skips the suspend check (used by tests; production callers
// always pass p.Name()).
func (l *Limiter) Allow(subject, featureID, providerName string) (Decision, func()) {
	noop := func() {}

	if featureID == "" {
		return Decision{
			Allowed:           false,
			Reason:            "missing_feature_id",
			BaselineAvailable: true,
		}, noop
	}

	if providerName != "" {
		if d, blocked := l.checkSuspend(providerName); blocked {
			return d, noop
		}
	}

	tier, ok := l.tiers.Tier(featureID)
	if !ok {
		return Decision{
			Allowed:           false,
			Reason:            "unknown_feature_id",
			BaselineAvailable: true,
		}, noop
	}

	q := l.resolveQuota(featureID, FeatureTier(strings.TrimSpace(tier)))
	if q.IsZero() {
		// Explicit zero override = unbounded. Still track inflight so
		// later Observe + Suspend hooks have somewhere to live.
		return AllowedDecision(), noop
	}

	now := l.clock.Now()
	b := l.bucketFor(subject, featureID, q, now)

	b.mu.Lock()
	defer b.mu.Unlock()

	b.refillLocked(now)

	if q.BurstReq > 0 && b.inflight >= q.BurstReq {
		return Decision{
			Allowed:           false,
			Reason:            "burst",
			RetryAfter:        100 * time.Millisecond, // burst usually clears fast
			BannerLevel:       "warn",
			BaselineAvailable: true,
		}, noop
	}

	if q.PerDay > 0 && b.dayCount >= q.PerDay {
		return Decision{
			Allowed:           false,
			Reason:            "per_day",
			RetryAfter:        timeUntilNextUTCDay(now),
			BannerLevel:       "critical",
			BaselineAvailable: true,
		}, noop
	}

	if q.PerMinute > 0 && b.tokens < 1 {
		return Decision{
			Allowed:           false,
			Reason:            "per_minute",
			RetryAfter:        timeForOneToken(q.PerMinute),
			BannerLevel:       "warn",
			BaselineAvailable: true,
		}, noop
	}

	if q.InTokensPM > 0 && b.minuteIn >= q.InTokensPM {
		return Decision{
			Allowed:           false,
			Reason:            "input_tokens",
			RetryAfter:        timeUntilNextMinute(now, b.minuteStart),
			BannerLevel:       "warn",
			BaselineAvailable: true,
		}, noop
	}

	if q.OutTokensPM > 0 && b.minuteOut >= q.OutTokensPM {
		return Decision{
			Allowed:           false,
			Reason:            "output_tokens",
			RetryAfter:        timeUntilNextMinute(now, b.minuteStart),
			BannerLevel:       "warn",
			BaselineAvailable: true,
		}, noop
	}

	// Reserve: take one token, count one call against PerDay, mark
	// inflight. Inflight is decremented by the returned release func.
	if q.PerMinute > 0 {
		b.tokens -= 1
	}
	b.dayCount++
	b.inflight++

	released := false
	release := func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		if released {
			return
		}
		released = true
		if b.inflight > 0 {
			b.inflight--
		}
	}

	return AllowedDecision(), release
}

// Observe records the actual input + output token counts for the
// (subject, feature) tuple AFTER the call completes. Best-effort —
// the per-minute token quotas are checked on the NEXT Allow() based
// on the rolling minute window.
//
// Negative counts are clamped to zero. A miss on bucket lookup is a
// no-op (the bucket is constructed lazily on the next Allow).
func (l *Limiter) Observe(subject, featureID string, inputTokens, outputTokens int) {
	if featureID == "" {
		return
	}
	if inputTokens < 0 {
		inputTokens = 0
	}
	if outputTokens < 0 {
		outputTokens = 0
	}
	v, ok := l.buckets.Load(bucketKey{Subject: subject, Feature: featureID})
	if !ok {
		return
	}
	b := v.(*bucket)
	now := l.clock.Now()
	b.mu.Lock()
	b.refillLocked(now)
	b.minuteIn += inputTokens
	b.minuteOut += outputTokens
	b.mu.Unlock()
}

// SuspendProvider marks a provider as unavailable until the supplied
// instant. Subsequent Allow() calls that supply the same providerName
// reject with Decision{Reason:"provider_unavailable"} and a
// RetryAfter the time difference. The suspension is cleared lazily
// when an Allow call observes the suspend-until is in the past.
//
// providerName is the [provider.Provider.Name] value (e.g. "ollama").
// providerName == "" or until in the past is a no-op so the caller
// (the health poller) does not need to check before invoking.
func (l *Limiter) SuspendProvider(providerName string, until time.Time) {
	if providerName == "" {
		return
	}
	if !until.After(l.clock.Now()) {
		return
	}
	l.suspMu.Lock()
	l.suspProvider[providerName] = until
	l.suspMu.Unlock()
}

// IsProviderSuspended reports the suspend-until time for providerName
// (zero time + ok=false when not suspended). Diagnostic — the
// admin /metrics endpoint can render this.
func (l *Limiter) IsProviderSuspended(providerName string) (time.Time, bool) {
	l.suspMu.RLock()
	defer l.suspMu.RUnlock()
	t, ok := l.suspProvider[providerName]
	return t, ok && t.After(l.clock.Now())
}

// checkSuspend returns a rejection Decision when providerName is
// currently suspended. Reads under RLock and clears stale entries
// opportunistically when found.
func (l *Limiter) checkSuspend(providerName string) (Decision, bool) {
	l.suspMu.RLock()
	until, ok := l.suspProvider[providerName]
	l.suspMu.RUnlock()
	if !ok {
		return Decision{}, false
	}
	now := l.clock.Now()
	if !until.After(now) {
		// Stale; clear under write-lock.
		l.suspMu.Lock()
		if cur, stillThere := l.suspProvider[providerName]; stillThere && !cur.After(now) {
			delete(l.suspProvider, providerName)
		}
		l.suspMu.Unlock()
		return Decision{}, false
	}
	return Decision{
		Allowed:           false,
		Reason:            "provider_unavailable",
		RetryAfter:        until.Sub(now),
		BannerLevel:       "critical",
		BaselineAvailable: true,
	}, true
}

// resolveQuota picks the effective quota for featureID. Override wins
// over default; default is keyed by tier. Empty tier (typo at the
// boot-time TierResolver) falls back to conservative conversational
// — the rejection-on-unknown happens earlier in Allow().
func (l *Limiter) resolveQuota(featureID string, tier FeatureTier) Quota {
	if l.quotas != nil {
		if q, ok := l.quotas.Quota(featureID); ok {
			return q
		}
	}
	return DefaultQuotaForTier(tier)
}

// bucketFor returns the bucket for (subject, feature), constructing
// one lazily on first miss. Construction races are resolved by
// sync.Map.LoadOrStore; the loser drops its candidate.
func (l *Limiter) bucketFor(subject, featureID string, q Quota, now time.Time) *bucket {
	key := bucketKey{Subject: subject, Feature: featureID}
	if v, ok := l.buckets.Load(key); ok {
		return v.(*bucket)
	}
	candidate := &bucket{
		quota:       q,
		tokens:      float64(q.PerMinute),
		lastRefill:  now,
		dayStart:    truncateToUTCDay(now),
		minuteStart: truncateToMinute(now),
	}
	actual, _ := l.buckets.LoadOrStore(key, candidate)
	return actual.(*bucket)
}

// refillLocked advances the bucket's token + day + minute state to
// `now`. Caller MUST hold b.mu.
func (b *bucket) refillLocked(now time.Time) {
	if b.quota.PerMinute > 0 {
		elapsed := now.Sub(b.lastRefill)
		if elapsed > 0 {
			ratePerSec := float64(b.quota.PerMinute) / 60.0
			b.tokens += elapsed.Seconds() * ratePerSec
			if b.tokens > float64(b.quota.PerMinute) {
				b.tokens = float64(b.quota.PerMinute)
			}
		}
		b.lastRefill = now
	}
	if dayStart := truncateToUTCDay(now); dayStart.After(b.dayStart) {
		b.dayCount = 0
		b.dayStart = dayStart
	}
	if minStart := truncateToMinute(now); minStart.After(b.minuteStart) {
		b.minuteIn = 0
		b.minuteOut = 0
		b.minuteStart = minStart
	}
}

// truncateToUTCDay returns the start of t's UTC calendar day.
func truncateToUTCDay(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// truncateToMinute returns the start of t's UTC minute.
func truncateToMinute(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, time.UTC)
}

// timeUntilNextUTCDay returns the duration from now until 00:00 UTC
// the next day. Used to populate Decision.RetryAfter for per-day
// rejections so the frontend countdown is accurate.
func timeUntilNextUTCDay(now time.Time) time.Duration {
	t := truncateToUTCDay(now).Add(24 * time.Hour)
	return t.Sub(now)
}

// timeUntilNextMinute returns the duration from now to the next
// rolling-minute boundary, computed from b.minuteStart so the
// frontend retry countdown matches the actual reset moment.
func timeUntilNextMinute(now, minuteStart time.Time) time.Duration {
	if minuteStart.IsZero() {
		return time.Minute
	}
	next := minuteStart.Add(time.Minute)
	if !next.After(now) {
		return 0
	}
	return next.Sub(now)
}

// timeForOneToken is the duration a fully-empty bucket needs to
// accumulate one token at the configured PerMinute rate. Used to
// hint the frontend retry countdown.
func timeForOneToken(perMinute int) time.Duration {
	if perMinute <= 0 {
		return time.Minute
	}
	return time.Duration(float64(time.Minute) / float64(perMinute))
}

// MapTierResolver is a tiny in-memory [TierResolver] used by tests +
// by callers that want to register a small custom set without
// touching the canonical features registry. The map is read-only
// after construction.
type MapTierResolver map[string]string

// Tier implements [TierResolver].
func (m MapTierResolver) Tier(featureID string) (string, bool) {
	t, ok := m[featureID]
	return t, ok
}

// MapQuotaResolver is a tiny in-memory [QuotaResolver] used by tests.
type MapQuotaResolver map[string]Quota

// Quota implements [QuotaResolver].
func (m MapQuotaResolver) Quota(featureID string) (Quota, bool) {
	q, ok := m[featureID]
	return q, ok
}

// String returns a human-readable Quota render. Diagnostic; the
// /metrics endpoint and test failure messages use this.
func (q Quota) String() string {
	return fmt.Sprintf("burst=%d pm=%d pd=%d in_pm=%d out_pm=%d",
		q.BurstReq, q.PerMinute, q.PerDay, q.InTokensPM, q.OutTokensPM)
}
