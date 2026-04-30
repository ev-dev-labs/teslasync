package httputil

import (
	"net/http"
	"time"
)

// ClientConfig combines timeout, retry, circuit breaker, rate limit, logging
// and the optional outbound api_call_logs sink.
//
// Sink is nil-safe: a nil sink keeps today's behaviour (zerolog only). When
// non-nil, every outbound round-trip — success or network error — is also
// recorded into the api_call_logs hypertable through the injected sink.
type ClientConfig struct {
	Name           string
	Timeout        time.Duration
	Retry          RetryConfig
	CircuitBreaker *CircuitBreakerConfig // nil = no circuit breaker
	RateLimit      *RateLimiter          // nil = no rate limit
	EnableLogging  bool
	Sink           APICallSink // nil = no api_call_logs persistence
}

// NewClient builds an *http.Client with the configured middleware stack.
// Transport chain: Logging → RateLimit → Retry → http.DefaultTransport
//
// The Sink is wired into the LoggedTransport when EnableLogging is true.
// LoggedTransport tolerates a nil Sink (preserves today's zerolog-only
// behaviour) so call sites that do not opt in are unaffected.
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
			Sink: cfg.Sink,
		}
	}

	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
	}
}
