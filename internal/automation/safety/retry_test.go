package safety

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
)

func TestClassifyError_Nil(t *testing.T) {
	if got := ClassifyError(nil); got != ErrorPermanent {
		t.Errorf("ClassifyError(nil) = %s, want permanent", got)
	}
}

func TestClassifyError_PermanentSentinels(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{"unauthorized", domain.ErrUnauthorized},
		{"forbidden", domain.ErrForbidden},
		{"validation", domain.ErrValidation},
		{"not_found", domain.ErrNotFound},
		{"conflict", domain.ErrConflict},
		{"wrapped_unauthorized", fmt.Errorf("check token: %w", domain.ErrUnauthorized)},
		{"wrapped_validation", fmt.Errorf("parse config: %w", domain.ErrValidation)},
		{"deeply_wrapped_not_found", fmt.Errorf("outer: %w", fmt.Errorf("inner: %w", domain.ErrNotFound))},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyError(tt.err); got != ErrorPermanent {
				t.Errorf("ClassifyError(%v) = %s, want permanent", tt.err, got)
			}
		})
	}
}

func TestClassifyError_RetryableSentinels(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{"vehicle_asleep", tesla.ErrVehicleAsleep},
		{"rate_limited", domain.ErrRateLimited},
		{"external_api", domain.ErrExternalAPI},
		{"budget_unavailable", tesla.ErrBudgetUnavailable},
		{"wrapped_vehicle_asleep", fmt.Errorf("wake failed: %w", tesla.ErrVehicleAsleep)},
		{"wrapped_rate_limited", fmt.Errorf("call tesla: %w", domain.ErrRateLimited)},
		{"wrapped_external_api", fmt.Errorf("geocode: %w", domain.ErrExternalAPI)},
		{"wrapped_budget_unavailable", fmt.Errorf("read budget snapshot: %w", tesla.ErrBudgetUnavailable)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyError(tt.err); got != ErrorRetryable {
				t.Errorf("ClassifyError(%v) = %s, want retryable", tt.err, got)
			}
		})
	}
}

func TestClassifyError_ContextErrors(t *testing.T) {
	tests := []struct {
		name  string
		err   error
		class ErrorClass
	}{
		{"deadline_exceeded", context.DeadlineExceeded, ErrorRetryable},
		{"wrapped_deadline", fmt.Errorf("api call: %w", context.DeadlineExceeded), ErrorRetryable},
		{"context_canceled", context.Canceled, ErrorPermanent},
		{"wrapped_canceled", fmt.Errorf("shutdown: %w", context.Canceled), ErrorPermanent},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyError(tt.err); got != tt.class {
				t.Errorf("ClassifyError(%v) = %s, want %s", tt.err, got, tt.class)
			}
		})
	}
}

// testNetError is a net.Error for testing.
type testNetError struct {
	msg     string
	timeout bool
}

func (e *testNetError) Error() string   { return e.msg }
func (e *testNetError) Timeout() bool   { return e.timeout }
func (e *testNetError) Temporary() bool { return true }

func TestClassifyError_NetErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{"net_error_timeout", &testNetError{msg: "dial tcp: timeout", timeout: true}},
		{"net_error_no_timeout", &testNetError{msg: "dial tcp: connection refused", timeout: false}},
		{"wrapped_net_error", fmt.Errorf("tesla api: %w", &testNetError{msg: "tcp reset"})},
		{"dns_error", &net.DNSError{Err: "no such host", Name: "fleet-api.tesla.com"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyError(tt.err); got != ErrorRetryable {
				t.Errorf("ClassifyError(%v) = %s, want retryable", tt.err, got)
			}
		})
	}
}

func TestClassifyError_StringFallback_Retryable(t *testing.T) {
	tests := []struct {
		name string
		msg  string
	}{
		{"connection_refused", "dial tcp 10.0.0.1:8080: connection refused"},
		{"connection_reset", "read tcp: connection reset by peer"},
		{"no_such_host", "lookup fleet-api.tesla.com: no such host"},
		{"io_timeout", "read tcp: i/o timeout"},
		{"temporarily_unavailable", "resource temporarily unavailable"},
		{"vehicle_offline", "vehicle is offline"},
		{"vehicle_offline_short", "vehicle offline, cannot send command"},
		{"service_unavailable", "http 503: service unavailable"},
		{"bad_gateway", "http 502: bad gateway"},
		{"too_many_requests", "http 429: too many requests"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := errors.New(tt.msg)
			if got := ClassifyError(err); got != ErrorRetryable {
				t.Errorf("ClassifyError(%q) = %s, want retryable", tt.msg, got)
			}
		})
	}
}

func TestClassifyError_StringFallback_Permanent(t *testing.T) {
	tests := []struct {
		name string
		msg  string
	}{
		{"not_authenticated", "not authenticated with Tesla"},
		{"unknown_command", "unknown command \"invalid_cmd\""},
		{"api_suspended", "Tesla API calls are suspended"},
		{"commands_disabled", "vehicle commands endpoint is disabled"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := errors.New(tt.msg)
			if got := ClassifyError(err); got != ErrorPermanent {
				t.Errorf("ClassifyError(%q) = %s, want permanent", tt.msg, got)
			}
		})
	}
}

func TestClassifyError_UnknownDefaultsToRetryable(t *testing.T) {
	err := errors.New("something unexpected happened in the flux capacitor")
	if got := ClassifyError(err); got != ErrorRetryable {
		t.Errorf("ClassifyError(unknown) = %s, want retryable (safe default)", got)
	}
}

func TestClassifyError_SentinelPrecedenceOverString(t *testing.T) {
	// An error wrapping ErrUnauthorized but containing "timeout" in msg
	// should be classified by sentinel (permanent), not substring (retryable).
	err := fmt.Errorf("timeout waiting for auth: %w", domain.ErrUnauthorized)
	if got := ClassifyError(err); got != ErrorPermanent {
		t.Errorf("sentinel should take precedence: got %s, want permanent", got)
	}
}

// TestClassifyError_BudgetExceededIsPermanent pins the Fleet API daily
// budget exhaustion classification: retrying an ErrBudgetExceeded action
// cannot succeed before the next UTC reset, so it must be permanent
// regardless of how deeply the sentinel is wrapped.
func TestClassifyError_BudgetExceededIsPermanent(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{"bare_sentinel", tesla.ErrBudgetExceeded},
		{"wrapped_once", fmt.Errorf("send command: %w", tesla.ErrBudgetExceeded)},
		{"deeply_wrapped", fmt.Errorf("outer: %w", fmt.Errorf("inner: %w", tesla.ErrBudgetExceeded))},
		{"typed_budget_exceeded_error", &tesla.BudgetExceededError{
			Category: tesla.BudgetCategoryCommand,
			Snapshot: tesla.BudgetSnapshot{DailyLimitMicroUSD: 1_000_000, EstimatedCostMicroUSD: 1_000_000},
		}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyError(tt.err); got != ErrorPermanent {
				t.Errorf("ClassifyError(%v) = %s, want permanent", tt.err, got)
			}
		})
	}
}

// TestClassifyError_BudgetUnavailableIsRetryable pins the budget evidence
// store outage as retryable — distinct from ErrBudgetExceeded, since the
// store may recover independently of the UTC budget window.
func TestClassifyError_BudgetUnavailableIsRetryable(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{"bare_sentinel", tesla.ErrBudgetUnavailable},
		{"wrapped_once", fmt.Errorf("read budget snapshot: %w", tesla.ErrBudgetUnavailable)},
		{"deeply_wrapped", fmt.Errorf("outer: %w", fmt.Errorf("inner: %w", tesla.ErrBudgetUnavailable))},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyError(tt.err); got != ErrorRetryable {
				t.Errorf("ClassifyError(%v) = %s, want retryable", tt.err, got)
			}
		})
	}
}

// TestClassifyError_BudgetExceededPrecedesRateLimitedString guards against
// a regression where ErrBudgetExceeded's message ("...daily budget
// exceeded...") is misclassified retryable by the generic "too many
// requests" substring fallback instead of the dedicated permanent sentinel
// check.
func TestClassifyError_BudgetExceededPrecedesRateLimitedString(t *testing.T) {
	err := &tesla.BudgetExceededError{
		Category: tesla.BudgetCategoryCommand,
		Snapshot: tesla.BudgetSnapshot{DailyLimitMicroUSD: 1_000_000, EstimatedCostMicroUSD: 1_000_000},
	}
	if got := ClassifyError(err); got != ErrorPermanent {
		t.Errorf("ClassifyError(%v) = %s, want permanent (sentinel must win over string fallback)", err, got)
	}
}

func TestEvaluate_BudgetExceeded_NeverRetries(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("send command: %w", tesla.ErrBudgetExceeded)
	dec := rp.Evaluate(err, 0, 3)

	if dec.ShouldRetry {
		t.Fatal("expected ShouldRetry=false for Fleet API budget exceeded")
	}
	if dec.ErrorClass != ErrorPermanent {
		t.Errorf("ErrorClass = %s, want permanent", dec.ErrorClass)
	}
	if dec.Delay != 0 {
		t.Errorf("Delay = %v, want 0 for permanent error", dec.Delay)
	}
}

func TestEvaluate_BudgetUnavailable_RetriesWithBackoff(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("read budget snapshot: %w", tesla.ErrBudgetUnavailable)
	dec := rp.Evaluate(err, 0, 3)

	if !dec.ShouldRetry {
		t.Fatal("expected ShouldRetry=true for Fleet API budget evidence unavailable")
	}
	if dec.ErrorClass != ErrorRetryable {
		t.Errorf("ErrorClass = %s, want retryable", dec.ErrorClass)
	}
	if dec.Delay != 5*time.Second {
		t.Errorf("Delay = %v, want 5s", dec.Delay)
	}
}

func TestErrorClass_String(t *testing.T) {
	tests := []struct {
		class ErrorClass
		want  string
	}{
		{ErrorRetryable, "retryable"},
		{ErrorPermanent, "permanent"},
		{ErrorClass(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.class.String(); got != tt.want {
			t.Errorf("ErrorClass(%d).String() = %q, want %q", tt.class, got, tt.want)
		}
	}
}

func TestComputeDelay_DefaultSchedule(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0)) // disable jitter for exact values

	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{0, 5 * time.Second},  // 5s × 3^0 = 5s
		{1, 15 * time.Second}, // 5s × 3^1 = 15s
		{2, 45 * time.Second}, // 5s × 3^2 = 45s
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("attempt_%d", tt.attempt), func(t *testing.T) {
			got := rp.ComputeDelay(tt.attempt)
			if got != tt.want {
				t.Errorf("ComputeDelay(%d) = %v, want %v", tt.attempt, got, tt.want)
			}
		})
	}
}

func TestComputeDelay_MaxDelayCap(t *testing.T) {
	rp := NewRetryPolicy(
		WithBaseDelay(10*time.Second),
		WithMultiplier(10),
		WithMaxDelay(30*time.Second),
		WithJitter(0),
	)

	// 10s × 10^2 = 1000s → capped to 30s
	got := rp.ComputeDelay(2)
	if got != 30*time.Second {
		t.Errorf("ComputeDelay(2) = %v, want 30s (capped)", got)
	}
}

func TestComputeDelay_JitterBounds(t *testing.T) {
	rp := NewRetryPolicy(
		WithBaseDelay(10*time.Second),
		WithMultiplier(1),
		WithJitter(0.2),
	)

	// With jitter=0.2, delay should be 10s ± 2s → [8s, 12s]
	minDelay := 8 * time.Second
	maxDelay := 12 * time.Second

	for i := 0; i < 100; i++ {
		got := rp.ComputeDelay(0)
		if got < minDelay || got > maxDelay {
			t.Fatalf("ComputeDelay(0) = %v, want within [%v, %v]", got, minDelay, maxDelay)
		}
	}
}

func TestComputeDelay_DeterministicWithFixedRand(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0.2))
	rp.randFunc = func() float64 { return 0.5 } // midpoint → jitter offset = 0

	// With rand=0.5: offset = (0.5*2 - 1) * jitterRange = 0
	got := rp.ComputeDelay(0)
	if got != 5*time.Second {
		t.Errorf("ComputeDelay(0) with rand=0.5 = %v, want 5s (zero jitter)", got)
	}
}

func TestComputeDelay_CustomParams(t *testing.T) {
	rp := NewRetryPolicy(
		WithBaseDelay(2*time.Second),
		WithMultiplier(2),
		WithMaxDelay(time.Minute),
		WithJitter(0),
	)

	tests := []struct {
		attempt int
		want    time.Duration
	}{
		{0, 2 * time.Second},  // 2s × 2^0 = 2s
		{1, 4 * time.Second},  // 2s × 2^1 = 4s
		{2, 8 * time.Second},  // 2s × 2^2 = 8s
		{3, 16 * time.Second}, // 2s × 2^3 = 16s
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("attempt_%d", tt.attempt), func(t *testing.T) {
			got := rp.ComputeDelay(tt.attempt)
			if got != tt.want {
				t.Errorf("ComputeDelay(%d) = %v, want %v", tt.attempt, got, tt.want)
			}
		})
	}
}

func TestComputeDelay_ZeroAttempt(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))
	got := rp.ComputeDelay(0)
	if got != DefaultBaseDelay {
		t.Errorf("ComputeDelay(0) = %v, want %v (base delay)", got, DefaultBaseDelay)
	}
}

func TestEvaluate_RetryableError_WithinBudget(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("call tesla: %w", tesla.ErrVehicleAsleep)
	dec := rp.Evaluate(err, 0, 3)

	if !dec.ShouldRetry {
		t.Fatal("expected ShouldRetry=true for retryable error within budget")
	}
	if dec.ErrorClass != ErrorRetryable {
		t.Errorf("ErrorClass = %s, want retryable", dec.ErrorClass)
	}
	if dec.Delay != 5*time.Second {
		t.Errorf("Delay = %v, want 5s", dec.Delay)
	}
	if dec.Attempt != 0 {
		t.Errorf("Attempt = %d, want 0", dec.Attempt)
	}
	if dec.MaxAttempts != 3 {
		t.Errorf("MaxAttempts = %d, want 3", dec.MaxAttempts)
	}
}

func TestEvaluate_RetryableError_BudgetExhausted(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("call tesla: %w", tesla.ErrVehicleAsleep)
	dec := rp.Evaluate(err, 3, 3) // attempt 3, max 3 → exhausted

	if dec.ShouldRetry {
		t.Fatal("expected ShouldRetry=false when budget exhausted")
	}
	if dec.ErrorClass != ErrorRetryable {
		t.Errorf("ErrorClass = %s, want retryable", dec.ErrorClass)
	}
	if dec.Reason != "retry budget exhausted" {
		t.Errorf("Reason = %q, want 'retry budget exhausted'", dec.Reason)
	}
}

func TestEvaluate_PermanentError(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("auth check: %w", domain.ErrUnauthorized)
	dec := rp.Evaluate(err, 0, 3)

	if dec.ShouldRetry {
		t.Fatal("expected ShouldRetry=false for permanent error")
	}
	if dec.ErrorClass != ErrorPermanent {
		t.Errorf("ErrorClass = %s, want permanent", dec.ErrorClass)
	}
	if dec.Delay != 0 {
		t.Errorf("Delay = %v, want 0 for permanent error", dec.Delay)
	}
}

func TestEvaluate_ProgressiveBackoff(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	// Simulate 3 successive retryable failures with increasing backoff.
	err := domain.ErrExternalAPI
	expectedDelays := []time.Duration{
		5 * time.Second,
		15 * time.Second,
		45 * time.Second,
	}

	for attempt := 0; attempt < 3; attempt++ {
		dec := rp.Evaluate(err, attempt, 3)
		if !dec.ShouldRetry {
			t.Fatalf("attempt %d: expected ShouldRetry=true", attempt)
		}
		if dec.Delay != expectedDelays[attempt] {
			t.Errorf("attempt %d: Delay = %v, want %v", attempt, dec.Delay, expectedDelays[attempt])
		}
	}
}

func TestEvaluate_ZeroMaxRetries(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	// Max retries = 0 means no retries allowed.
	err := tesla.ErrVehicleAsleep
	dec := rp.Evaluate(err, 0, 0)

	if dec.ShouldRetry {
		t.Fatal("expected ShouldRetry=false when maxRetries=0")
	}
	if dec.Reason != "retry budget exhausted" {
		t.Errorf("Reason = %q, want 'retry budget exhausted'", dec.Reason)
	}
}

func TestEvaluate_NilError_Permanent(t *testing.T) {
	rp := NewRetryPolicy()

	dec := rp.Evaluate(nil, 0, 3)
	if dec.ShouldRetry {
		t.Fatal("expected ShouldRetry=false for nil error")
	}
	if dec.ErrorClass != ErrorPermanent {
		t.Errorf("ErrorClass = %s, want permanent", dec.ErrorClass)
	}
}

func TestNewRetryPolicy_Defaults(t *testing.T) {
	rp := NewRetryPolicy()

	if rp.baseDelay != DefaultBaseDelay {
		t.Errorf("baseDelay = %v, want %v", rp.baseDelay, DefaultBaseDelay)
	}
	if rp.multiplier != DefaultMultiplier {
		t.Errorf("multiplier = %v, want %v", rp.multiplier, DefaultMultiplier)
	}
	if rp.maxDelay != DefaultMaxDelay {
		t.Errorf("maxDelay = %v, want %v", rp.maxDelay, DefaultMaxDelay)
	}
	if rp.jitter != DefaultJitter {
		t.Errorf("jitter = %v, want %v", rp.jitter, DefaultJitter)
	}
}

func TestNewRetryPolicy_WithOptions(t *testing.T) {
	rp := NewRetryPolicy(
		WithBaseDelay(10*time.Second),
		WithMultiplier(2.0),
		WithMaxDelay(time.Minute),
		WithJitter(0.1),
	)

	if rp.baseDelay != 10*time.Second {
		t.Errorf("baseDelay = %v, want 10s", rp.baseDelay)
	}
	if rp.multiplier != 2.0 {
		t.Errorf("multiplier = %v, want 2.0", rp.multiplier)
	}
	if rp.maxDelay != time.Minute {
		t.Errorf("maxDelay = %v, want 1m", rp.maxDelay)
	}
	if rp.jitter != 0.1 {
		t.Errorf("jitter = %v, want 0.1", rp.jitter)
	}
}

func TestScenario_VehicleAsleep_RetriesWithBackoff(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))
	maxRetries := 3
	err := fmt.Errorf("send command: %w", tesla.ErrVehicleAsleep)

	// Attempt 0: should retry after 5s
	dec := rp.Evaluate(err, 0, maxRetries)
	if !dec.ShouldRetry || dec.Delay != 5*time.Second {
		t.Fatalf("attempt 0: ShouldRetry=%v, Delay=%v", dec.ShouldRetry, dec.Delay)
	}

	// Attempt 1: should retry after 15s
	dec = rp.Evaluate(err, 1, maxRetries)
	if !dec.ShouldRetry || dec.Delay != 15*time.Second {
		t.Fatalf("attempt 1: ShouldRetry=%v, Delay=%v", dec.ShouldRetry, dec.Delay)
	}

	// Attempt 2: should retry after 45s
	dec = rp.Evaluate(err, 2, maxRetries)
	if !dec.ShouldRetry || dec.Delay != 45*time.Second {
		t.Fatalf("attempt 2: ShouldRetry=%v, Delay=%v", dec.ShouldRetry, dec.Delay)
	}

	// Attempt 3: budget exhausted
	dec = rp.Evaluate(err, 3, maxRetries)
	if dec.ShouldRetry {
		t.Fatal("attempt 3: should NOT retry (budget exhausted)")
	}
}

func TestScenario_InvalidCommand_FailsImmediately(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("parse action: %w", domain.ErrValidation)
	dec := rp.Evaluate(err, 0, 3)

	if dec.ShouldRetry {
		t.Fatal("invalid command should fail immediately without retry")
	}
	if dec.ErrorClass != ErrorPermanent {
		t.Errorf("ErrorClass = %s, want permanent", dec.ErrorClass)
	}
}

func TestScenario_RateLimit_RetriesWithBackoff(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("tesla api: %w", domain.ErrRateLimited)
	dec := rp.Evaluate(err, 0, 3)

	if !dec.ShouldRetry {
		t.Fatal("rate limited error should be retryable")
	}
	if dec.Delay != 5*time.Second {
		t.Errorf("Delay = %v, want 5s", dec.Delay)
	}
}

func TestScenario_NetworkTimeout_RetriesWithBackoff(t *testing.T) {
	rp := NewRetryPolicy(WithJitter(0))

	err := fmt.Errorf("fleet api: %w", context.DeadlineExceeded)
	dec := rp.Evaluate(err, 1, 3)

	if !dec.ShouldRetry {
		t.Fatal("deadline exceeded should be retryable")
	}
	if dec.Delay != 15*time.Second { // attempt 1 → 5s × 3^1 = 15s
		t.Errorf("Delay = %v, want 15s", dec.Delay)
	}
}

func TestScenario_AuthFailed_NeverRetries(t *testing.T) {
	rp := NewRetryPolicy()

	err := errors.New("not authenticated with Tesla")
	dec := rp.Evaluate(err, 0, 10)

	if dec.ShouldRetry {
		t.Fatal("auth failure should never retry")
	}
}
