package httputil

import (
	"fmt"
	"testing"
	"time"
)

func TestCircuitBreaker_ClosedState_AllowsRequests(t *testing.T) {
	cb := NewCircuitBreaker("test", DefaultCircuitBreakerConfig())

	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}
	if cb.State() != CircuitClosed {
		t.Errorf("expected CircuitClosed, got %v", cb.State())
	}
}

func TestCircuitBreaker_OpensAfterThreshold(t *testing.T) {
	cfg := CircuitBreakerConfig{
		FailureThreshold:    3,
		ResetTimeout:        5 * time.Second,
		HalfOpenMaxRequests: 1,
	}
	cb := NewCircuitBreaker("test", cfg)

	for i := 0; i < 3; i++ {
		_ = cb.Execute(func() error { return fmt.Errorf("fail") })
	}

	if cb.State() != CircuitOpen {
		t.Errorf("expected CircuitOpen after %d failures, got %v", 3, cb.State())
	}
}

func TestCircuitBreaker_RejectsWhenOpen(t *testing.T) {
	cfg := CircuitBreakerConfig{
		FailureThreshold:    2,
		ResetTimeout:        1 * time.Hour, // long timeout so it stays open
		HalfOpenMaxRequests: 1,
	}
	cb := NewCircuitBreaker("test", cfg)

	// Trip the breaker
	for i := 0; i < 2; i++ {
		_ = cb.Execute(func() error { return fmt.Errorf("fail") })
	}

	err := cb.Execute(func() error { return nil })
	if err == nil {
		t.Fatal("expected error when circuit is open")
	}
}

func TestCircuitBreaker_TransitionsToHalfOpen(t *testing.T) {
	cfg := CircuitBreakerConfig{
		FailureThreshold:    2,
		ResetTimeout:        10 * time.Millisecond,
		HalfOpenMaxRequests: 1,
	}
	cb := NewCircuitBreaker("test", cfg)

	// Trip the breaker
	for i := 0; i < 2; i++ {
		_ = cb.Execute(func() error { return fmt.Errorf("fail") })
	}

	// Wait for reset timeout
	time.Sleep(20 * time.Millisecond)

	if cb.State() != CircuitHalfOpen {
		t.Errorf("expected CircuitHalfOpen after reset timeout, got %v", cb.State())
	}
}

func TestCircuitBreaker_HalfOpenSuccess_Closes(t *testing.T) {
	cfg := CircuitBreakerConfig{
		FailureThreshold:    2,
		ResetTimeout:        10 * time.Millisecond,
		HalfOpenMaxRequests: 1,
	}
	cb := NewCircuitBreaker("test", cfg)

	// Trip the breaker
	for i := 0; i < 2; i++ {
		_ = cb.Execute(func() error { return fmt.Errorf("fail") })
	}

	time.Sleep(20 * time.Millisecond)

	// Probe request succeeds
	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Fatalf("Execute() error: %v", err)
	}

	if cb.State() != CircuitClosed {
		t.Errorf("expected CircuitClosed after successful probe, got %v", cb.State())
	}
}

func TestCircuitBreaker_HalfOpenFailure_ReopensCircuit(t *testing.T) {
	cfg := CircuitBreakerConfig{
		FailureThreshold:    2,
		ResetTimeout:        10 * time.Millisecond,
		HalfOpenMaxRequests: 1,
	}
	cb := NewCircuitBreaker("test", cfg)

	// Trip the breaker
	for i := 0; i < 2; i++ {
		_ = cb.Execute(func() error { return fmt.Errorf("fail") })
	}

	time.Sleep(20 * time.Millisecond)

	// Probe request fails
	_ = cb.Execute(func() error { return fmt.Errorf("still broken") })

	if cb.State() != CircuitOpen {
		t.Errorf("expected CircuitOpen after failed probe, got %v", cb.State())
	}
}

func TestCircuitBreaker_SuccessResetsFailureCount(t *testing.T) {
	cfg := CircuitBreakerConfig{
		FailureThreshold:    3,
		ResetTimeout:        1 * time.Hour,
		HalfOpenMaxRequests: 1,
	}
	cb := NewCircuitBreaker("test", cfg)

	// 2 failures
	_ = cb.Execute(func() error { return fmt.Errorf("fail") })
	_ = cb.Execute(func() error { return fmt.Errorf("fail") })

	// 1 success resets counter
	_ = cb.Execute(func() error { return nil })

	// 2 more failures shouldn't trip (counter was reset)
	_ = cb.Execute(func() error { return fmt.Errorf("fail") })
	_ = cb.Execute(func() error { return fmt.Errorf("fail") })

	if cb.State() != CircuitClosed {
		t.Errorf("expected CircuitClosed (counter reset), got %v", cb.State())
	}
}

func TestCircuitState_String(t *testing.T) {
	tests := []struct {
		state CircuitState
		want  string
	}{
		{CircuitClosed, "closed"},
		{CircuitOpen, "open"},
		{CircuitHalfOpen, "half-open"},
		{CircuitState(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.state.String(); got != tt.want {
			t.Errorf("CircuitState(%d).String() = %q, want %q", tt.state, got, tt.want)
		}
	}
}
