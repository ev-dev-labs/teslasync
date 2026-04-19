package database

import (
	"errors"
	"testing"
	"time"

	"github.com/sony/gobreaker"
)

// transientErr simulates a DB connectivity error that IsTransient returns true for.
var transientErr = errors.New("connection refused")

// permanentErr simulates a constraint violation that IsTransient returns false for.
var permanentErr = errors.New("duplicate key value violates unique constraint")

func TestCircuitBreaker_OpensAfterConsecutiveTransientFailures(t *testing.T) {
	cb := NewDBCircuitBreaker("test-open")

	// 5 consecutive transient failures should open the breaker
	for i := 0; i < 5; i++ {
		err := cb.Execute(func() error { return transientErr })
		if err == nil {
			t.Fatalf("attempt %d: expected error, got nil", i+1)
		}
	}

	if cb.State() != gobreaker.StateOpen {
		t.Fatalf("expected StateOpen after 5 failures, got %s", cb.State())
	}
}

func TestCircuitBreaker_ReturnsErrOpenStateWhenOpen(t *testing.T) {
	cb := NewDBCircuitBreaker("test-err-open")

	// Trip the breaker
	for i := 0; i < 5; i++ {
		cb.Execute(func() error { return transientErr })
	}

	// Next call should fail fast with ErrOpenState
	err := cb.Execute(func() error {
		t.Fatal("fn should not be called when breaker is open")
		return nil
	})

	if !errors.Is(err, gobreaker.ErrOpenState) {
		t.Fatalf("expected ErrOpenState, got %v", err)
	}
}

func TestCircuitBreaker_TransitionsToHalfOpenAfterTimeout(t *testing.T) {
	// Create a breaker with a very short timeout for testing
	cb := &DBCircuitBreaker{
		cb: gobreaker.NewCircuitBreaker(gobreaker.Settings{
			Name:        "test-half-open",
			MaxRequests: 1,
			Interval:    30 * time.Second,
			Timeout:     100 * time.Millisecond, // very short for test
			ReadyToTrip: func(counts gobreaker.Counts) bool {
				return counts.ConsecutiveFailures >= 5
			},
			IsSuccessful: func(err error) bool {
				if err == nil {
					return true
				}
				return !IsTransient(err)
			},
		}),
	}

	// Trip the breaker
	for i := 0; i < 5; i++ {
		cb.Execute(func() error { return transientErr })
	}
	if cb.State() != gobreaker.StateOpen {
		t.Fatalf("expected StateOpen, got %s", cb.State())
	}

	// Wait for timeout to allow half-open transition
	time.Sleep(150 * time.Millisecond)

	// The state transitions to half-open on the next Execute call.
	// A successful probe should close it.
	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Fatalf("expected nil (probe should succeed), got %v", err)
	}

	if cb.State() != gobreaker.StateClosed {
		t.Fatalf("expected StateClosed after successful probe, got %s", cb.State())
	}
}

func TestCircuitBreaker_ClosesOnSuccessfulProbe(t *testing.T) {
	cb := &DBCircuitBreaker{
		cb: gobreaker.NewCircuitBreaker(gobreaker.Settings{
			Name:        "test-close",
			MaxRequests: 1,
			Interval:    30 * time.Second,
			Timeout:     50 * time.Millisecond,
			ReadyToTrip: func(counts gobreaker.Counts) bool {
				return counts.ConsecutiveFailures >= 5
			},
			IsSuccessful: func(err error) bool {
				if err == nil {
					return true
				}
				return !IsTransient(err)
			},
		}),
	}

	// Trip the breaker
	for i := 0; i < 5; i++ {
		cb.Execute(func() error { return transientErr })
	}

	// Wait for half-open
	time.Sleep(80 * time.Millisecond)

	// Successful probe closes it
	cb.Execute(func() error { return nil })
	if cb.State() != gobreaker.StateClosed {
		t.Fatalf("expected StateClosed, got %s", cb.State())
	}

	// Verify counts are reset
	counts := cb.Counts()
	if counts.ConsecutiveFailures != 0 {
		t.Fatalf("expected 0 consecutive failures after close, got %d", counts.ConsecutiveFailures)
	}
}

func TestCircuitBreaker_NonTransientErrorsDoNotTripBreaker(t *testing.T) {
	cb := NewDBCircuitBreaker("test-non-transient")

	// 10 permanent errors should NOT open the breaker (IsSuccessful returns true)
	for i := 0; i < 10; i++ {
		err := cb.Execute(func() error { return permanentErr })
		if err == nil {
			t.Fatalf("attempt %d: expected error, got nil", i+1)
		}
		if !errors.Is(err, permanentErr) {
			t.Fatalf("attempt %d: expected permanentErr, got %v", i+1, err)
		}
	}

	if cb.State() != gobreaker.StateClosed {
		t.Fatalf("expected StateClosed after only non-transient errors, got %s", cb.State())
	}
}

func TestCircuitBreaker_MixedErrorsOnlyCountTransient(t *testing.T) {
	cb := NewDBCircuitBreaker("test-mixed")

	// 3 transient failures
	for i := 0; i < 3; i++ {
		cb.Execute(func() error { return transientErr })
	}

	// 1 permanent error (should not count as failure for breaker)
	cb.Execute(func() error { return permanentErr })

	// Consecutive transient failures should be reset by the non-transient "success"
	// 3 more transient failures (total consecutive = 3, not 6)
	for i := 0; i < 3; i++ {
		cb.Execute(func() error { return transientErr })
	}

	// Should still be closed (never reached 5 consecutive transient failures)
	if cb.State() != gobreaker.StateClosed {
		t.Fatalf("expected StateClosed (consecutive transient failures reset by non-transient), got %s", cb.State())
	}
}

func TestCircuitBreaker_SuccessResetsConsecutiveFailures(t *testing.T) {
	cb := NewDBCircuitBreaker("test-reset")

	// 4 transient failures (just under threshold)
	for i := 0; i < 4; i++ {
		cb.Execute(func() error { return transientErr })
	}

	// 1 success resets consecutive failures
	cb.Execute(func() error { return nil })

	// 4 more transient failures (total consecutive = 4, not 8)
	for i := 0; i < 4; i++ {
		cb.Execute(func() error { return transientErr })
	}

	if cb.State() != gobreaker.StateClosed {
		t.Fatalf("expected StateClosed (consecutive failures reset by success), got %s", cb.State())
	}
}
