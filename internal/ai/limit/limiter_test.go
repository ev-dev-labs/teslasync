package limit

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newTestLimiter returns a limiter wired with a fake clock + a tier
// resolver registering "feat-conv" (conversational) and "feat-gen"
// (generative). Tests pass a per-feature quota override to keep the
// numbers small + deterministic.
func newTestLimiter(t *testing.T, clock *FakeClock, override map[string]Quota) *Limiter {
	t.Helper()
	tiers := MapTierResolver{
		"feat-conv":  string(TierUpgrade),
		"feat-gen":   string(TierGenerative),
		"feat-bg":    string(TierMaintenance),
	}
	opts := []Option{WithClock(clock)}
	if override != nil {
		opts = append(opts, WithQuotaResolver(MapQuotaResolver(override)))
	}
	return New(tiers, opts...)
}

func TestLimiter_RejectsMissingFeatureID(t *testing.T) {
	t.Parallel()
	l := newTestLimiter(t, NewFakeClock(time.Now()), nil)
	d, release := l.Allow("user-1", "", "")
	if d.Allowed {
		t.Fatal("expected reject for missing feature ID")
	}
	if d.Reason != "missing_feature_id" {
		t.Errorf("got reason %q, want missing_feature_id", d.Reason)
	}
	if release == nil {
		t.Fatal("release should be a no-op, not nil")
	}
	release() // must not panic
}

func TestLimiter_RejectsUnknownFeatureID(t *testing.T) {
	t.Parallel()
	l := newTestLimiter(t, NewFakeClock(time.Now()), nil)
	d, _ := l.Allow("user-1", "no-such-feature", "")
	if d.Allowed {
		t.Fatal("expected reject for unknown feature ID")
	}
	if d.Reason != "unknown_feature_id" {
		t.Errorf("got reason %q, want unknown_feature_id", d.Reason)
	}
}

func TestLimiter_BurstReqLimit(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 2, PerMinute: 100, PerDay: 100, InTokensPM: 0, OutTokensPM: 0},
	})

	// Two parallel calls should both be allowed.
	d1, r1 := l.Allow("user-1", "feat-conv", "")
	d2, r2 := l.Allow("user-1", "feat-conv", "")
	if !d1.Allowed || !d2.Allowed {
		t.Fatalf("first two parallel calls should be allowed; got %+v %+v", d1, d2)
	}
	// Third while two are inflight should be rejected.
	d3, _ := l.Allow("user-1", "feat-conv", "")
	if d3.Allowed {
		t.Fatal("third concurrent call should be rejected")
	}
	if d3.Reason != "burst" {
		t.Errorf("expected reason burst, got %q", d3.Reason)
	}
	// After releasing one slot, a new call should be allowed.
	r1()
	d4, _ := l.Allow("user-1", "feat-conv", "")
	if !d4.Allowed {
		t.Fatalf("after release, call should be allowed; got %+v", d4)
	}
	r2()
}

func TestLimiter_PerMinuteTokenBucketDrainsAndRefills(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		// PerMinute=2 → 1 token every 30s; capacity 2.
		"feat-conv": {BurstReq: 100, PerMinute: 2, PerDay: 100},
	})

	// Drain the bucket. Release each call so BurstReq doesn't kick in.
	d1, r1 := l.Allow("user-1", "feat-conv", "")
	if !d1.Allowed {
		t.Fatal("call 1 should pass")
	}
	r1()
	d2, r2 := l.Allow("user-1", "feat-conv", "")
	if !d2.Allowed {
		t.Fatal("call 2 should pass")
	}
	r2()
	d3, _ := l.Allow("user-1", "feat-conv", "")
	if d3.Allowed {
		t.Fatal("call 3 should be rejected (bucket empty)")
	}
	if d3.Reason != "per_minute" {
		t.Errorf("got reason %q, want per_minute", d3.Reason)
	}
	if d3.RetryAfter <= 0 {
		t.Errorf("expected positive RetryAfter, got %v", d3.RetryAfter)
	}

	// Advance 30s — one token regenerates → next call passes.
	clk.Advance(30 * time.Second)
	d4, r4 := l.Allow("user-1", "feat-conv", "")
	if !d4.Allowed {
		t.Fatalf("after 30s should refill 1 token; got %+v", d4)
	}
	r4()
}

func TestLimiter_PerDayResetsAtUTCMidnight(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 1, 1, 23, 30, 0, 0, time.UTC)
	clk := NewFakeClock(start)
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 100, PerMinute: 100, PerDay: 2},
	})
	for i := 0; i < 2; i++ {
		d, r := l.Allow("user-1", "feat-conv", "")
		if !d.Allowed {
			t.Fatalf("call %d should pass; got %+v", i, d)
		}
		r()
	}
	d3, _ := l.Allow("user-1", "feat-conv", "")
	if d3.Allowed {
		t.Fatal("third call same day should be rejected")
	}
	if d3.Reason != "per_day" {
		t.Errorf("got reason %q, want per_day", d3.Reason)
	}
	// RetryAfter should match time-until-midnight (~30 min).
	if d3.RetryAfter <= 25*time.Minute || d3.RetryAfter > 31*time.Minute {
		t.Errorf("retry-after = %v, want ~30 min", d3.RetryAfter)
	}

	// Cross UTC midnight; budget should reset.
	clk.Advance(45 * time.Minute) // now 00:15 UTC next day
	d4, r4 := l.Allow("user-1", "feat-conv", "")
	if !d4.Allowed {
		t.Fatalf("after midnight reset, call should pass; got %+v", d4)
	}
	r4()
}

func TestLimiter_InTokensPMObservation(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 100, PerMinute: 100, PerDay: 100, InTokensPM: 1000, OutTokensPM: 0},
	})
	d1, r1 := l.Allow("user-1", "feat-conv", "")
	if !d1.Allowed {
		t.Fatal("first call should pass")
	}
	l.Observe("user-1", "feat-conv", 1500, 0)
	r1()

	// Second call should be rejected on input_tokens.
	d2, _ := l.Allow("user-1", "feat-conv", "")
	if d2.Allowed {
		t.Fatalf("expected reject on input_tokens; got %+v", d2)
	}
	if d2.Reason != "input_tokens" {
		t.Errorf("got reason %q, want input_tokens", d2.Reason)
	}
}

func TestLimiter_OutTokensPMObservation(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 100, PerMinute: 100, PerDay: 100, InTokensPM: 0, OutTokensPM: 500},
	})
	d1, r1 := l.Allow("user-1", "feat-conv", "")
	if !d1.Allowed {
		t.Fatal("first call should pass")
	}
	l.Observe("user-1", "feat-conv", 0, 600)
	r1()
	d2, _ := l.Allow("user-1", "feat-conv", "")
	if d2.Allowed {
		t.Fatal("expected reject on output_tokens")
	}
	if d2.Reason != "output_tokens" {
		t.Errorf("got reason %q, want output_tokens", d2.Reason)
	}
}

func TestLimiter_TokenWindowResetsAfterMinute(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 100, PerMinute: 100, PerDay: 100, InTokensPM: 100, OutTokensPM: 0},
	})
	d1, r1 := l.Allow("user-1", "feat-conv", "")
	if !d1.Allowed {
		t.Fatal("first call should pass")
	}
	l.Observe("user-1", "feat-conv", 200, 0)
	r1()
	d2, _ := l.Allow("user-1", "feat-conv", "")
	if d2.Allowed {
		t.Fatal("call inside same minute should be rejected")
	}
	clk.Advance(61 * time.Second)
	d3, r3 := l.Allow("user-1", "feat-conv", "")
	if !d3.Allowed {
		t.Fatalf("after minute boundary, call should pass; got %+v", d3)
	}
	r3()
}

func TestLimiter_PerSubjectIsolation(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 1, PerMinute: 100, PerDay: 100},
	})
	_, r1 := l.Allow("user-A", "feat-conv", "")
	d2, r2 := l.Allow("user-B", "feat-conv", "")
	if !d2.Allowed {
		t.Fatal("user-B should not be affected by user-A's burst slot")
	}
	r1()
	r2()
}

func TestLimiter_PerFeatureIsolation(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 1, PerMinute: 100, PerDay: 100},
		"feat-gen":  {BurstReq: 1, PerMinute: 100, PerDay: 100},
	})
	_, r1 := l.Allow("user-1", "feat-conv", "")
	d2, r2 := l.Allow("user-1", "feat-gen", "")
	if !d2.Allowed {
		t.Fatal("feat-gen should not share a bucket with feat-conv")
	}
	r1()
	r2()
}

func TestLimiter_SuspendProvider(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	clk := NewFakeClock(start)
	l := newTestLimiter(t, clk, nil)
	l.SuspendProvider("ollama", start.Add(60*time.Second))

	d, _ := l.Allow("user-1", "feat-conv", "ollama")
	if d.Allowed {
		t.Fatal("call to suspended provider should be rejected")
	}
	if d.Reason != "provider_unavailable" {
		t.Errorf("got reason %q, want provider_unavailable", d.Reason)
	}
	if d.RetryAfter < 50*time.Second || d.RetryAfter > 65*time.Second {
		t.Errorf("retry-after = %v, want ~60s", d.RetryAfter)
	}

	// Suspending an unrelated provider does not affect ollama.
	if _, ok := l.IsProviderSuspended("openai"); ok {
		t.Error("openai should not be suspended")
	}
	if _, ok := l.IsProviderSuspended("ollama"); !ok {
		t.Error("ollama should be suspended")
	}

	// After the suspension expires, calls pass.
	clk.Advance(65 * time.Second)
	d2, r2 := l.Allow("user-1", "feat-conv", "ollama")
	if !d2.Allowed {
		t.Fatalf("after suspension expires, call should pass; got %+v", d2)
	}
	r2()
}

func TestLimiter_SuspendProviderSkipsEmptyName(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, nil)
	l.SuspendProvider("", clk.Now().Add(time.Hour)) // no-op
	d, _ := l.Allow("user-1", "feat-conv", "")
	if !d.Allowed {
		t.Errorf("empty provider name with empty suspend should pass; got %+v", d)
	}
}

func TestLimiter_SuspendProviderSkipsPastTime(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, nil)
	l.SuspendProvider("ollama", clk.Now().Add(-time.Second)) // no-op
	d, r := l.Allow("user-1", "feat-conv", "ollama")
	if !d.Allowed {
		t.Errorf("past suspend should be no-op; got %+v", d)
	}
	r()
}

func TestLimiter_ZeroQuotaIsUnbounded(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {}, // explicit zero override = unbounded
	})
	for i := 0; i < 10; i++ {
		d, r := l.Allow("user-1", "feat-conv", "")
		if !d.Allowed {
			t.Errorf("zero quota should never reject; got %+v at i=%d", d, i)
		}
		r()
	}
}

func TestLimiter_ReleaseIsIdempotent(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 1, PerMinute: 100, PerDay: 100},
	})
	d1, r1 := l.Allow("user-1", "feat-conv", "")
	if !d1.Allowed {
		t.Fatal("first call should pass")
	}
	r1()
	r1() // double release — must not panic, must not free a phantom slot
	r1()
	// Slot should be free, second call should pass.
	d2, r2 := l.Allow("user-1", "feat-conv", "")
	if !d2.Allowed {
		t.Fatalf("call after release should pass; got %+v", d2)
	}
	r2()
	// And a third call must hit BurstReq because nothing else is inflight.
	d3, r3 := l.Allow("user-1", "feat-conv", "")
	if !d3.Allowed {
		t.Errorf("call 3 after release of call 2 should pass; got %+v", d3)
	}
	r3()
}

func TestLimiter_ConcurrentAllowsRespectBurst(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, map[string]Quota{
		"feat-conv": {BurstReq: 5, PerMinute: 1000, PerDay: 1000},
	})

	const goroutines = 100
	var wg sync.WaitGroup
	var allowed int32
	wg.Add(goroutines)
	releases := make(chan func(), goroutines)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			d, r := l.Allow("user-1", "feat-conv", "")
			if d.Allowed {
				atomic.AddInt32(&allowed, 1)
				releases <- r
			}
		}()
	}
	wg.Wait()
	close(releases)

	if got := int(allowed); got != 5 {
		t.Errorf("expected exactly 5 concurrent allows; got %d", got)
	}
	for r := range releases {
		r()
	}
}

func TestLimiter_NewPanicsOnNilTierResolver(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Error("expected panic for nil TierResolver")
		}
	}()
	_ = New(nil)
}

func TestLimiter_ObserveOnUnknownBucketIsNoop(t *testing.T) {
	t.Parallel()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	l := newTestLimiter(t, clk, nil)
	// Should not panic or error.
	l.Observe("user-1", "feat-conv", 100, 100)
	l.Observe("user-1", "", 100, 100)        // empty feature ID is no-op
	l.Observe("user-1", "feat-conv", -1, -1) // negative clamps to zero
}

func TestLimiterError_HelpfulErrorString(t *testing.T) {
	t.Parallel()
	d := Decision{Allowed: false, Reason: "cost_cap"}
	err := NewLimitError(d)
	if err == nil {
		t.Fatal("expected non-nil error")
	}
	var le *LimitError
	if !errors.As(err, &le) {
		t.Fatal("errors.As should find LimitError")
	}
}
