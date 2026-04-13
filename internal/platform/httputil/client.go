package httputil

import (
	"net/http"
	"time"
)

// ClientConfig combines timeout, retry, circuit breaker, rate limit, and logging.
type ClientConfig struct {
	Name           string
	Timeout        time.Duration
	Retry          RetryConfig
	CircuitBreaker *CircuitBreakerConfig // nil = no circuit breaker
	RateLimit      *RateLimiter          // nil = no rate limit
	EnableLogging  bool
}

// NewClient builds an *http.Client with the configured middleware stack.
// Transport chain: Logging → RateLimit → Retry → http.DefaultTransport
func NewClient(cfg ClientConfig) *http.Client {
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 10 * time.Second
	}

	// Start with base transport
	var transport http.RoundTripper = &http.Transport{
		MaxIdleConns:        100,
		MaxIdleConnsPerHost: 10,
		IdleConnTimeout:     90 * time.Second,
	}

	// Layer 1: Retry (innermost — wraps base transport)
	if cfg.Retry.MaxAttempts > 0 {
		transport = &RetryableTransport{
			Base:   transport,
			Config: cfg.Retry,
		}
	}

	// Layer 2: Rate limiting
	if cfg.RateLimit != nil {
		transport = &RateLimitedTransport{
			Base:    transport,
			Limiter: cfg.RateLimit,
		}
	}

	// Layer 3: Logging (outermost — logs the final request/response)
	if cfg.EnableLogging {
		transport = &LoggedTransport{
			Base: transport,
			Name: cfg.Name,
		}
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}
