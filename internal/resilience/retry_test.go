package resilience

import (
	"context"
	"fmt"
	"testing"
	"time"
)

func TestRetrySucceedsOnFirstAttempt(t *testing.T) {
	calls := 0
	err := Retry(context.Background(), "test", RetryConfig{
		MaxAttempts: 3,
		InitialWait: time.Millisecond,
		MaxWait:     time.Millisecond,
		Multiplier:  1,
	}, func(ctx context.Context) error {
		calls++
		return nil
	})
	if err != nil {
		t.Errorf("Retry() error = %v", err)
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1", calls)
	}
}

func TestRetrySucceedsAfterFailures(t *testing.T) {
	calls := 0
	err := Retry(context.Background(), "test", RetryConfig{
		MaxAttempts: 5,
		InitialWait: time.Millisecond,
		MaxWait:     10 * time.Millisecond,
		Multiplier:  2,
	}, func(ctx context.Context) error {
		calls++
		if calls < 3 {
			return fmt.Errorf("fail %d", calls)
		}
		return nil
	})
	if err != nil {
		t.Errorf("Retry() error = %v", err)
	}
	if calls != 3 {
		t.Errorf("calls = %d, want 3", calls)
	}
}

func TestRetryExhaustsAttempts(t *testing.T) {
	calls := 0
	err := Retry(context.Background(), "test", RetryConfig{
		MaxAttempts: 3,
		InitialWait: time.Millisecond,
		MaxWait:     time.Millisecond,
		Multiplier:  1,
	}, func(ctx context.Context) error {
		calls++
		return fmt.Errorf("always fail")
	})
	if err == nil {
		t.Error("Retry() should return error after all attempts")
	}
	if calls != 3 {
		t.Errorf("calls = %d, want 3", calls)
	}
}

func TestRetryRespectsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := Retry(ctx, "test", RetryConfig{
		MaxAttempts: 10,
		InitialWait: time.Second,
		MaxWait:     time.Second,
		Multiplier:  1,
	}, func(ctx context.Context) error {
		return fmt.Errorf("fail")
	})
	if err == nil {
		t.Error("Retry() should return error when context cancelled")
	}
}

func TestConnectWithRetrySuccess(t *testing.T) {
	calls := 0
	err := ConnectWithRetry(context.Background(), "test", 3, func(ctx context.Context) error {
		calls++
		return nil
	})
	if err != nil {
		t.Errorf("ConnectWithRetry() error = %v", err)
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1", calls)
	}
}

func TestSafeGoDoesNotPanic(t *testing.T) {
	done := make(chan struct{})
	SafeGo("test", func() {
		close(done)
	})
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Error("SafeGo() function never executed")
	}
}
