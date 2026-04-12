package httputil

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"time"
)

// RetryConfig configures retry behavior with exponential backoff and jitter.
type RetryConfig struct {
	MaxAttempts     int
	InitialDelay    time.Duration
	MaxDelay        time.Duration
	Multiplier      float64
	RetryableStatus []int
}

// DefaultRetryConfig returns sensible defaults for HTTP retries.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxAttempts:     3,
		InitialDelay:    100 * time.Millisecond,
		MaxDelay:        5 * time.Second,
		Multiplier:      2.0,
		RetryableStatus: []int{429, 500, 502, 503, 504},
	}
}

// Retry executes fn with exponential backoff + jitter.
// Returns the last error if all attempts fail.
func Retry(ctx context.Context, name string, cfg RetryConfig, fn func(ctx context.Context) error) error {
	var lastErr error
	delay := cfg.InitialDelay

	for attempt := 1; attempt <= cfg.MaxAttempts; attempt++ {
		lastErr = fn(ctx)
		if lastErr == nil {
			return nil
		}

		if attempt == cfg.MaxAttempts {
			break
		}
		if ctx.Err() != nil {
			return fmt.Errorf("%s: context cancelled during retry: %w", name, ctx.Err())
		}

		// Apply jitter: ±25%
		jitter := float64(delay) * 0.25
		sleepDur := time.Duration(float64(delay) + (rand.Float64()*2-1)*jitter)

		select {
		case <-time.After(sleepDur):
		case <-ctx.Done():
			return fmt.Errorf("%s: context cancelled waiting to retry: %w", name, ctx.Err())
		}

		delay = time.Duration(math.Min(float64(delay)*cfg.Multiplier, float64(cfg.MaxDelay)))
	}

	return fmt.Errorf("%s: all %d attempts failed: %w", name, cfg.MaxAttempts, lastErr)
}

// RetryWithResult executes fn with retry and returns both a result and error.
func RetryWithResult[T any](ctx context.Context, name string, cfg RetryConfig, fn func(ctx context.Context) (T, error)) (T, error) {
	var zero T
	var result T
	err := Retry(ctx, name, cfg, func(ctx context.Context) error {
		var e error
		result, e = fn(ctx)
		return e
	})
	if err != nil {
		return zero, err
	}
	return result, nil
}

// IsRetryableStatus returns true if the HTTP status code is in the retryable list.
func IsRetryableStatus(status int, retryable []int) bool {
	for _, s := range retryable {
		if status == s {
			return true
		}
	}
	return false
}

// RetryableTransport wraps http.RoundTripper with retry logic.
type RetryableTransport struct {
	Base   http.RoundTripper
	Config RetryConfig
}

// RoundTrip implements http.RoundTripper with retry.
func (t *RetryableTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	var resp *http.Response
	var err error

	base := t.Base
	if base == nil {
		base = http.DefaultTransport
	}

	delay := t.Config.InitialDelay
	for attempt := 1; attempt <= t.Config.MaxAttempts; attempt++ {
		resp, err = base.RoundTrip(req)
		if err == nil && !IsRetryableStatus(resp.StatusCode, t.Config.RetryableStatus) {
			return resp, nil
		}

		if attempt == t.Config.MaxAttempts {
			break
		}
		if req.Context().Err() != nil {
			break
		}

		// Close body from failed attempt
		if resp != nil && resp.Body != nil {
			resp.Body.Close()
		}

		jitter := float64(delay) * 0.25
		sleepDur := time.Duration(float64(delay) + (rand.Float64()*2-1)*jitter)
		time.Sleep(sleepDur)
		delay = time.Duration(math.Min(float64(delay)*t.Config.Multiplier, float64(t.Config.MaxDelay)))
	}

	return resp, err
}
