package limit

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// fakeRepo is the in-memory CostRepo used by every cost test.
type fakeRepo struct {
	subjectSpend map[string]int64
	calls        int32
	failNext     atomic.Bool
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{subjectSpend: map[string]int64{}}
}

func (r *fakeRepo) TodaySpend(_ context.Context, subject string) (int64, error) {
	atomic.AddInt32(&r.calls, 1)
	if r.failNext.Swap(false) {
		return 0, errors.New("repo down")
	}
	return r.subjectSpend[subject], nil
}

func newTestCostCap(t *testing.T, repo CostRepo, capCents int, opts ...CostCapOption) *CostCap {
	t.Helper()
	lookup := func(_ context.Context, _ string) (int, error) { return capCents, nil }
	return NewCostCap(repo, lookup, opts...)
}

func TestCostCap_UnsetCapAlwaysAllows(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	repo.subjectSpend["u"] = 99_999_999_999 // huge spend
	cc := newTestCostCap(t, repo, 0)        // cap unset

	d, r, err := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 1000, 1000)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !d.Allowed {
		t.Fatalf("unset cap should always allow; got %+v", d)
	}
	if r == nil {
		t.Fatal("release should not be nil")
	}
	r(0)
	if got := atomic.LoadInt32(&repo.calls); got != 0 {
		t.Errorf("unset cap should not hit repo; got %d calls", got)
	}
}

func TestCostCap_SettingsErrorFailsClosed(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	failingLookup := func(_ context.Context, _ string) (int, error) {
		return 0, errors.New("settings store down")
	}
	cc := NewCostCap(repo, failingLookup)
	d, _, err := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 100, 100)
	if err != nil {
		t.Errorf("expect nil err (Decision encodes failure); got %v", err)
	}
	if d.Allowed {
		t.Fatal("settings error must fail closed (Allowed=false)")
	}
	if d.Reason != "settings_unavailable" {
		t.Errorf("expected reason settings_unavailable, got %q", d.Reason)
	}
}

func TestCostCap_BlocksWhenProjectedExceedsCap(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	// Cap = 1 cent = 10_000 micro-cents.
	// gpt-4o-mini input @ 150_000 mc/M tokens => 100_000 input tokens = 15_000 mc.
	cc := newTestCostCap(t, repo, 1)

	d, _, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 100_000, 0)
	if d.Allowed {
		t.Fatalf("expect reject when estimate exceeds cap; got %+v", d)
	}
	if d.Reason != "cost_cap" {
		t.Errorf("got reason %q, want cost_cap", d.Reason)
	}
	if d.RetryAfter <= 0 {
		t.Errorf("cost_cap rejection should set RetryAfter, got %v", d.RetryAfter)
	}
}

func TestCostCap_AllowsWhenUnderCap(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	cc := newTestCostCap(t, repo, 100) // $1 cap

	d, r, err := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 100, 100)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !d.Allowed {
		t.Fatalf("under cap: expected allow; got %+v", d)
	}
	if d.BannerLevel != "" {
		t.Errorf("under 80%%: BannerLevel should be empty, got %q", d.BannerLevel)
	}
	r(75) // actual cost in micro-cents
}

func TestCostCap_WarnAt80Percent(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	// Cap = 100 cents = 1_000_000 micro-cents.
	// 80% threshold = 800_000 micro-cents.
	repo.subjectSpend["u"] = 750_000 // 75% already
	cc := newTestCostCap(t, repo, 100)

	// Estimate ~6 cents = 60_000 micro-cents → projected 810_000 (>= 80% of cap).
	// gpt-4o-mini: 100_000 input tokens = 15_000 mc, plus 100_000 output @ 600_000/M = 60_000 mc → total 75_000.
	d, r, err := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 100_000, 100_000)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !d.Allowed {
		t.Fatalf("under cap should allow; got %+v", d)
	}
	if d.BannerLevel != "warn" {
		t.Errorf("at >=80%% expected warn banner; got %q", d.BannerLevel)
	}
	r(-1) // use estimate
}

func TestCostCap_ReservationPreventsConcurrentOvershoot(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	repo.subjectSpend["u"] = 0
	// Cap = 1 cent = 10_000 micro-cents.
	cc := newTestCostCap(t, repo, 1)

	// First call estimate = 50_000 input tokens = 7_500 mc.
	d1, r1, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 50_000, 0)
	if !d1.Allowed {
		t.Fatalf("first call should pass; got %+v", d1)
	}
	// Second call BEFORE first releases — pending reservation should
	// push projected over the cap and reject.
	d2, _, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 50_000, 0)
	if d2.Allowed {
		t.Fatalf("second concurrent call should be rejected; got %+v", d2)
	}
	if d2.Reason != "cost_cap" {
		t.Errorf("expected cost_cap, got %q", d2.Reason)
	}
	r1(7_500)
	// After release, the reservation is dropped + actual is added to today.
	// Now: today=7_500, cap=10_000. Next call estimating 4_000 should pass.
	// 100 input tokens = 15 mc — well under remaining 2_500 mc budget.
	d3, r3, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 100, 0)
	if !d3.Allowed {
		t.Fatalf("after release, small call should pass; got %+v", d3)
	}
	r3(15)
}

func TestCostCap_CacheTTLAvoidsRepoStorm(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	clk := NewFakeClock(time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC))
	cc := newTestCostCap(t, repo, 100, WithCostClock(clk), WithCacheTTL(30*time.Second))

	for i := 0; i < 5; i++ {
		d, r, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 1, 1)
		if !d.Allowed {
			t.Fatalf("call %d should allow; got %+v", i, d)
		}
		r(0)
	}
	if got := atomic.LoadInt32(&repo.calls); got != 1 {
		t.Errorf("expected 1 repo call (cache hit); got %d", got)
	}

	// Advance past cache TTL — next call should refetch.
	clk.Advance(31 * time.Second)
	d, r, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 1, 1)
	if !d.Allowed {
		t.Fatalf("after TTL: should allow; got %+v", d)
	}
	r(0)
	if got := atomic.LoadInt32(&repo.calls); got != 2 {
		t.Errorf("expected 2 repo calls after TTL; got %d", got)
	}
}

func TestCostCap_ZeroCacheTTLAlwaysHitsRepo(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	cc := newTestCostCap(t, repo, 100, WithCacheTTL(0))
	for i := 0; i < 3; i++ {
		_, r, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 1, 1)
		r(0)
	}
	if got := atomic.LoadInt32(&repo.calls); got != 3 {
		t.Errorf("expected 3 repo calls with TTL=0; got %d", got)
	}
}

func TestCostCap_RepoErrorFailsClosed(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	repo.failNext.Store(true)
	cc := newTestCostCap(t, repo, 100)

	d, _, err := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 1, 1)
	if err == nil {
		t.Error("expected non-nil err on repo failure")
	}
	if d.Allowed {
		t.Errorf("repo error should fail closed; got %+v", d)
	}
	if d.Reason != "cost_cap_unavailable" {
		t.Errorf("expected reason cost_cap_unavailable, got %q", d.Reason)
	}
}

func TestCostCap_ReleaseIsIdempotent(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	cc := newTestCostCap(t, repo, 100)
	d, r, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 100, 100)
	if !d.Allowed {
		t.Fatal("call should pass")
	}
	r(50)
	r(50) // double release — must be no-op
	r(50)
	today, pending := cc.Snapshot("u")
	if pending != 0 {
		t.Errorf("expected pending=0 after release; got %d", pending)
	}
	if today != 50 {
		t.Errorf("expected today=50 after one release; got %d", today)
	}
}

func TestCostCap_ReleaseNegativeUsesEstimate(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	cc := newTestCostCap(t, repo, 100)
	// gpt-4o-mini: 100_000 input tokens = 15_000 mc estimate.
	d, r, _ := cc.Check(context.Background(), "u", "openai", "gpt-4o-mini", 100_000, 0)
	if !d.Allowed {
		t.Fatal("call should pass")
	}
	r(-1) // signal "use estimate"
	today, _ := cc.Snapshot("u")
	if today != 15_000 {
		t.Errorf("expected today=15_000 (estimate); got %d", today)
	}
}

func TestCostCap_SnapshotUnknownSubject(t *testing.T) {
	t.Parallel()
	repo := newFakeRepo()
	cc := newTestCostCap(t, repo, 100)
	today, pending := cc.Snapshot("nobody")
	if today != 0 || pending != 0 {
		t.Errorf("expected zeros for unknown subject; got today=%d pending=%d", today, pending)
	}
}

func TestCostCap_NewPanicsOnNilArgs(t *testing.T) {
	t.Parallel()
	t.Run("nil repo", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic on nil repo")
			}
		}()
		_ = NewCostCap(nil, func(_ context.Context, _ string) (int, error) { return 0, nil })
	})
	t.Run("nil lookup", func(t *testing.T) {
		defer func() {
			if r := recover(); r == nil {
				t.Error("expected panic on nil lookup")
			}
		}()
		_ = NewCostCap(newFakeRepo(), nil)
	})
}

func TestAICallLogTodayAdapter(t *testing.T) {
	t.Parallel()
	called := false
	src := func(_ context.Context, subject string) (int64, error) {
		called = true
		if subject != "u" {
			t.Errorf("expected subject u, got %q", subject)
		}
		return 12345, nil
	}
	repo := AICallLogTodayAdapter(src)
	got, err := repo.TodaySpend(context.Background(), "u")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != 12345 {
		t.Errorf("expected 12345, got %d", got)
	}
	if !called {
		t.Error("source func should have been called")
	}
}
