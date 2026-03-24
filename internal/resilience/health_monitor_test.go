package resilience

import (
	"context"
	"testing"
	"time"
)

func TestHealthMonitor_OverallStatus_SkipsUnchecked(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.Register("mqtt")

	// db is healthy, mqtt never checked (unknown with 0 total checks)
	hm.RecordSuccess("db")

	overall := hm.OverallStatus()
	if overall != StatusHealthy {
		t.Errorf("overall = %v, want healthy (unchecked components should be skipped)", overall)
	}
}

func TestHealthMonitor_OverallStatus_WorstWins(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.Register("mqtt")

	hm.RecordSuccess("db")
	for i := 0; i < 5; i++ {
		hm.RecordFailure("mqtt", nil)
	}

	overall := hm.OverallStatus()
	if overall != StatusDegraded {
		t.Errorf("overall = %v, want degraded (worst component)", overall)
	}
}

func TestHealthMonitor_UnregisteredComponent(t *testing.T) {
	hm := NewHealthMonitor()
	// Record to unregistered component should not panic
	hm.RecordSuccess("nonexistent")
	hm.RecordFailure("nonexistent", nil)
}

func TestConnectWithRetry_SuccessAfterRetry(t *testing.T) {
	attempts := 0
	err := ConnectWithRetry(context.Background(), "test", 3, func(ctx context.Context) error {
		attempts++
		if attempts < 2 {
			return context.DeadlineExceeded
		}
		return nil
	})
	if err != nil {
		t.Errorf("expected success, got %v", err)
	}
	if attempts != 2 {
		t.Errorf("attempts = %d, want 2", attempts)
	}
}

func TestConnectWithRetry_AllFail(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	err := ConnectWithRetry(ctx, "test", 2, func(ctx context.Context) error {
		return context.DeadlineExceeded
	})
	if err == nil {
		t.Error("expected error when all retries fail")
	}
}

func TestSafeGo_RecoversPanic(t *testing.T) {
	done := make(chan struct{})
	SafeGo("test-panic", func() {
		defer close(done)
		panic("test panic")
	})
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Error("SafeGo didn't recover from panic")
	}
}

func TestHealthMonitor_GetStatus_IsCopy(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.RecordSuccess("db")

	status := hm.GetStatus()
	// Modifying the returned map should not affect the monitor
	status["db"].ConsecFails = 999

	fresh := hm.GetStatus()
	if fresh["db"].ConsecFails != 0 {
		t.Error("GetStatus should return a copy, not a reference")
	}
}

func TestHealthMonitor_IsDegraded(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.RecordSuccess("db")

	if hm.IsDegraded() {
		t.Error("should not be degraded when all healthy")
	}

	for i := 0; i < 5; i++ {
		hm.RecordFailure("db", nil)
	}
	if !hm.IsDegraded() {
		t.Error("should be degraded after 5 failures")
	}
}
