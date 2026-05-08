package httputil

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// TimeoutConfig configures call timeout behavior.
type TimeoutConfig struct {
	Timeout time.Duration
}

// DefaultTimeoutConfig returns a 10-second timeout.
func DefaultTimeoutConfig() TimeoutConfig {
	return TimeoutConfig{Timeout: 10 * time.Second}
}

// WithTimeout executes fn with a context timeout.
// Returns context.DeadlineExceeded if fn doesn't complete in time.
func WithTimeout[T any](ctx context.Context, cfg TimeoutConfig, fn func(ctx context.Context) (T, error)) (T, error) {
	tCtx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()

	result, err := fn(tCtx)
	if err != nil && tCtx.Err() == context.DeadlineExceeded {
		var zero T
		log.Warn().
			Dur("timeout", cfg.Timeout).
			Msg("httputil: call timed out")
		return zero, fmt.Errorf("call timed out after %s: %w", cfg.Timeout, context.DeadlineExceeded)
	}
	return result, err
}

// NewHTTPClient returns a preconfigured http.Client with sensible defaults.
func NewHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		Transport: otelhttp.NewTransport(&http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
		}),
	}
}
