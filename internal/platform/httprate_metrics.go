// Package platform — Phase-46 / Prompt 40
//
// httprate_metrics.go exposes a thread-safe sliding-window request
// counter that the rate-limit status panel reads from. It is a deliberate
// alternative to scraping the third-party `httprate` middleware's
// internal state, which is not exported. Wire one WindowCounter per
// scope (e.g. one for all /api/v1 traffic, one for write methods only)
// at router construction, then attach the returned chi-compatible
// middleware to the matching subrouter. The handler in
// `rate_limit_handler.go` reads `Count()` to render the current usage.
//
// The counter uses fixed-size per-second buckets (default: 60 buckets
// for a 1-minute window). Increments are O(1) under the lock and the
// total bucket count fits in two CPU cache lines for the default size,
// so the contention overhead is negligible compared to the surrounding
// HTTP middleware chain.
//
// The counter does NOT enforce any limit — it only observes. Limits
// are configured externally and expressed by the handler in the
// ScopeBudget response so frontend rendering can colour-code severity.

package platform

import (
	"net/http"
	"sync"
	"time"
)

// DefaultWindowCounterWindow is the sliding-window length used when
// callers don't override it via NewWindowCounterWithBuckets. A
// one-minute window matches the dominant httprate.LimitByIP(N, 1*Minute)
// configurations in router.go so the displayed "current vs limit"
// rolls forward in lockstep with what the middleware enforces.
const DefaultWindowCounterWindow = 1 * time.Minute

// DefaultWindowCounterBuckets is the per-second bucket granularity. A
// minute / second resolution means the counter loses at most ~1 second
// of precision when a bucket rolls off the trailing edge of the
// window — well within the 30-second auto-refresh cadence the SPA uses
// for the status panel.
const DefaultWindowCounterBuckets = 60

// WindowCounter is a goroutine-safe sliding-window request counter. It
// tracks the number of Increment() calls observed during the most
// recent `window` duration, bucketed at `bucketDuration` granularity.
// The zero value is NOT usable; construct via NewWindowCounter or
// NewWindowCounterWithBuckets.
type WindowCounter struct {
	mu             sync.Mutex
	buckets        []int
	bucketDuration time.Duration
	windowStart    time.Time
	now            func() time.Time
}

// NewWindowCounter returns a WindowCounter with the default 1-minute
// window split into 60 per-second buckets.
func NewWindowCounter() *WindowCounter {
	return NewWindowCounterWithBuckets(DefaultWindowCounterWindow, DefaultWindowCounterBuckets)
}

// NewWindowCounterWithBuckets returns a WindowCounter with a caller-
// chosen window and bucket count. Both must be positive; callers passing
// zero or negative values fall back to the defaults so a misconfigured
// constructor cannot panic at request time.
func NewWindowCounterWithBuckets(window time.Duration, buckets int) *WindowCounter {
	if window <= 0 {
		window = DefaultWindowCounterWindow
	}
	if buckets <= 0 {
		buckets = DefaultWindowCounterBuckets
	}
	return &WindowCounter{
		buckets:        make([]int, buckets),
		bucketDuration: window / time.Duration(buckets),
		now:            func() time.Time { return time.Now() },
	}
}

// Window returns the configured sliding-window duration.
func (c *WindowCounter) Window() time.Duration {
	return c.bucketDuration * time.Duration(len(c.buckets))
}

// Increment records a single observation at the caller's wall-clock
// instant. Buckets older than the window are zeroed in O(staleBuckets)
// time before the new observation is recorded. Repeated calls within
// the same bucket are O(1).
func (c *WindowCounter) Increment() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.advanceLocked(c.now())
	c.buckets[len(c.buckets)-1]++
}

// Count returns the number of Increment() calls observed during the
// most recent Window() duration. Stale buckets are pruned before the
// sum so the value never lags more than `bucketDuration` behind real
// time even when no Increment has happened in a while.
func (c *WindowCounter) Count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.advanceLocked(c.now())
	total := 0
	for _, v := range c.buckets {
		total += v
	}
	return total
}

// advanceLocked rolls the bucket ring forward to the supplied wall
// instant, zeroing any bucket that has fallen out of the window. The
// caller MUST hold c.mu.
func (c *WindowCounter) advanceLocked(now time.Time) {
	if c.windowStart.IsZero() {
		c.windowStart = now.Truncate(c.bucketDuration)
		return
	}
	currentBucket := now.Truncate(c.bucketDuration)
	if !currentBucket.After(c.windowStart) {
		return
	}
	steps := int(currentBucket.Sub(c.windowStart) / c.bucketDuration)
	if steps >= len(c.buckets) {
		// Entire window elapsed without an Increment — wipe.
		for i := range c.buckets {
			c.buckets[i] = 0
		}
		c.windowStart = currentBucket
		return
	}
	// Shift left by `steps`, zeroing the freed tail slots.
	copy(c.buckets, c.buckets[steps:])
	for i := len(c.buckets) - steps; i < len(c.buckets); i++ {
		c.buckets[i] = 0
	}
	c.windowStart = currentBucket
}

// Middleware returns a chi-compatible middleware that calls Increment()
// once per inbound request before handing off to next. The optional
// methodFilter restricts increments to specific HTTP methods (used to
// build the "writes only" scope without duplicating handlers); pass nil
// to count every request regardless of method.
func (c *WindowCounter) Middleware(methodFilter map[string]bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if methodFilter == nil || methodFilter[r.Method] {
				c.Increment()
			}
			next.ServeHTTP(w, r)
		})
	}
}

// WriteMethodFilter is the canonical method set used to identify "write"
// requests for the api.write.minute scope. Exposed so tests and other
// call-sites build the same filter without hand-rolling it.
func WriteMethodFilter() map[string]bool {
	return map[string]bool{
		http.MethodPost:   true,
		http.MethodPut:    true,
		http.MethodPatch:  true,
		http.MethodDelete: true,
	}
}

// SetNowForTests is the deterministic-clock seam used by tests to
// advance the bucket window without sleeping. It is package-private to
// the tests by virtue of the *_test.go file naming, but must live on
// the production type because Go test files in the same package can
// only access exported AND unexported members defined here.
func (c *WindowCounter) SetNowForTests(now func() time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = now
}
