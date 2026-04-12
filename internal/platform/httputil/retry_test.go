package httputil

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestRetry_SucceedsFirstAttempt(t *testing.T) {
	calls := 0
	err := Retry(context.Background(), "test", DefaultRetryConfig(), func(ctx context.Context) error {
		calls++
		return nil
	})
	if err != nil {
		t.Fatalf("Retry() error: %v", err)
	}
	if calls != 1 {
		t.Errorf("expected 1 call, got %d", calls)
	}
}

func TestRetry_SucceedsAfterFailures(t *testing.T) {
	calls := 0
	cfg := RetryConfig{
		MaxAttempts:  3,
		InitialDelay: 1 * time.Millisecond,
		MaxDelay:     10 * time.Millisecond,
		Multiplier:   2.0,
	}
	err := Retry(context.Background(), "test", cfg, func(ctx context.Context) error {
		calls++
		if calls < 3 {
			return fmt.Errorf("temporary error")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("Retry() error: %v", err)
	}
	if calls != 3 {
		t.Errorf("expected 3 calls, got %d", calls)
	}
}

func TestRetry_AllAttemptsFail(t *testing.T) {
	cfg := RetryConfig{
		MaxAttempts:  3,
		InitialDelay: 1 * time.Millisecond,
		MaxDelay:     10 * time.Millisecond,
		Multiplier:   2.0,
	}
	err := Retry(context.Background(), "test_op", cfg, func(ctx context.Context) error {
		return fmt.Errorf("permanent error")
	})
	if err == nil {
		t.Fatal("expected error after all attempts fail")
	}
}

func TestRetry_ContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	cfg := RetryConfig{
		MaxAttempts:  3,
		InitialDelay: 1 * time.Second,
		MaxDelay:     5 * time.Second,
		Multiplier:   2.0,
	}
	err := Retry(ctx, "test", cfg, func(ctx context.Context) error {
		return fmt.Errorf("fail")
	})
	if err == nil {
		t.Fatal("expected error on cancelled context")
	}
}

func TestRetryWithResult(t *testing.T) {
	calls := 0
	cfg := RetryConfig{
		MaxAttempts:  3,
		InitialDelay: 1 * time.Millisecond,
		MaxDelay:     10 * time.Millisecond,
		Multiplier:   2.0,
	}
	result, err := RetryWithResult(context.Background(), "test", cfg, func(ctx context.Context) (string, error) {
		calls++
		if calls < 2 {
			return "", fmt.Errorf("temp")
		}
		return "success", nil
	})
	if err != nil {
		t.Fatalf("RetryWithResult() error: %v", err)
	}
	if result != "success" {
		t.Errorf("expected 'success', got %q", result)
	}
}

func TestIsRetryableStatus(t *testing.T) {
	retryable := []int{429, 500, 502, 503, 504}
	tests := []struct {
		status int
		want   bool
	}{
		{200, false},
		{404, false},
		{429, true},
		{500, true},
		{502, true},
		{503, true},
		{504, true},
		{400, false},
	}
	for _, tt := range tests {
		got := IsRetryableStatus(tt.status, retryable)
		if got != tt.want {
			t.Errorf("IsRetryableStatus(%d) = %v, want %v", tt.status, got, tt.want)
		}
	}
}

var errPermanent = errors.New("permanent")

func TestRetry_WrapsLastError(t *testing.T) {
	cfg := RetryConfig{
		MaxAttempts:  2,
		InitialDelay: 1 * time.Millisecond,
		MaxDelay:     10 * time.Millisecond,
		Multiplier:   2.0,
	}
	err := Retry(context.Background(), "op", cfg, func(ctx context.Context) error {
		return errPermanent
	})
	if !errors.Is(err, errPermanent) {
		t.Errorf("expected wrapped errPermanent, got: %v", err)
	}
}
