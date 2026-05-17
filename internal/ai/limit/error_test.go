package limit

import (
	"errors"
	"testing"
	"time"
)

func TestNewLimitErrorReturnsNilOnAllowed(t *testing.T) {
	t.Parallel()
	if err := NewLimitError(Decision{Allowed: true}); err != nil {
		t.Fatalf("expected nil for allowed decision, got %v", err)
	}
}

func TestLimitErrorImplementsErrorInterfaceWithReason(t *testing.T) {
	t.Parallel()
	d := Decision{Reason: "burst", RetryAfter: 100 * time.Millisecond}
	err := NewLimitError(d)
	if err == nil {
		t.Fatal("expected non-nil error for rejected decision")
	}
	got := err.Error()
	if got == "" {
		t.Fatal("expected non-empty error string")
	}
	wantSub := "burst"
	if !contains(got, wantSub) {
		t.Errorf("error %q does not contain %q", got, wantSub)
	}
	if !contains(got, "100ms") {
		t.Errorf("error %q does not contain retry-after duration", got)
	}
}

func TestLimitErrorIsMatchesSentinel(t *testing.T) {
	t.Parallel()
	err := NewLimitError(Decision{Reason: "cost_cap"})
	if !errors.Is(err, ErrLimited) {
		t.Errorf("errors.Is should match ErrLimited sentinel")
	}
}

func TestLimitErrorAsExtractsDecision(t *testing.T) {
	t.Parallel()
	d := Decision{Reason: "per_minute", RetryAfter: 5 * time.Second}
	err := NewLimitError(d)
	var le *LimitError
	if !errors.As(err, &le) {
		t.Fatalf("errors.As should extract LimitError")
	}
	if le.Decision.Reason != "per_minute" {
		t.Errorf("got reason %q, want per_minute", le.Decision.Reason)
	}
	if le.Decision.RetryAfter != 5*time.Second {
		t.Errorf("got retry %v, want 5s", le.Decision.RetryAfter)
	}
}

func TestLimitErrorOnNilReceiver(t *testing.T) {
	t.Parallel()
	var le *LimitError
	if le.Error() == "" {
		t.Fatal("nil-receiver Error() should still return a non-empty string")
	}
}

func contains(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
