package httputil

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestWithTimeout_SuccessWithinDeadline(t *testing.T) {
	cfg := TimeoutConfig{Timeout: 1 * time.Second}
	result, err := WithTimeout(context.Background(), cfg, func(ctx context.Context) (string, error) {
		return "ok", nil
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result != "ok" {
		t.Errorf("expected 'ok', got %q", result)
	}
}

func TestWithTimeout_ExceedsDeadline(t *testing.T) {
	cfg := TimeoutConfig{Timeout: 50 * time.Millisecond}
	_, err := WithTimeout(context.Background(), cfg, func(ctx context.Context) (string, error) {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(5 * time.Second):
			return "late", nil
		}
	})
	if err == nil {
		t.Fatal("expected timeout error, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("expected DeadlineExceeded, got: %v", err)
	}
}

func TestWithTimeout_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	cfg := TimeoutConfig{Timeout: 5 * time.Second}
	_, err := WithTimeout(ctx, cfg, func(ctx context.Context) (int, error) {
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-time.After(1 * time.Second):
			return 42, nil
		}
	})
	if err == nil {
		t.Fatal("expected error on cancelled context")
	}
}

func TestWithTimeout_FunctionReturnsError(t *testing.T) {
	cfg := TimeoutConfig{Timeout: 1 * time.Second}
	sentinel := errors.New("custom error")
	_, err := WithTimeout(context.Background(), cfg, func(ctx context.Context) (string, error) {
		return "", sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("expected sentinel error, got: %v", err)
	}
}

func TestDefaultTimeoutConfig(t *testing.T) {
	cfg := DefaultTimeoutConfig()
	if cfg.Timeout != 10*time.Second {
		t.Errorf("expected 10s, got %v", cfg.Timeout)
	}
}

func TestNewHTTPClient(t *testing.T) {
	client := NewHTTPClient(5 * time.Second)
	if client.Timeout != 5*time.Second {
		t.Errorf("expected 5s timeout, got %v", client.Timeout)
	}
	if client.Transport == nil {
		t.Error("expected non-nil transport")
	}
}
