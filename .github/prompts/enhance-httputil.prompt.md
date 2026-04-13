# Enhance httputil — Add Timeout, Request Logging, and Rate Limit Utilities

> **Context**: The `internal/platform/httputil` package has circuit breaker, retry,
> response helpers, and request decoding. Three capabilities are missing:
> - Timeout wrapper for outbound HTTP calls
> - Structured request/response logging helper
> - Composable rate limit config for the httputil layer
>
> Existing middleware in `internal/handler/middleware/` covers some of these at the
> HTTP handler level, but `httputil` should provide reusable building blocks that
> adapters and workers can use independently.

---

## Current State

```
internal/platform/httputil/
  circuit_breaker.go     142 lines — CircuitBreaker state machine ✅
  circuit_breaker_test.go 137 lines ✅
  retry.go               114 lines — Retry + RetryableTransport ✅
  retry_test.go          132 lines ✅
  response.go             60 lines — Respond, RespondError, Pagination ✅
  response_test.go        95 lines ✅
  request.go              16 lines — DecodeAndValidate[T] ✅

internal/handler/middleware/
  logging.go              49 lines — basic HTTP handler logging
  ratelimit.go           103 lines — Redis sliding window (handler-level only)
  recovery.go             24 lines — panic recovery
  metrics.go              23 lines — Prometheus
  auth.go                 47 lines — JWT/ForwardAuth
```

## Task

### Step 1: Add Timeout Wrapper — `timeout.go`

Create `internal/platform/httputil/timeout.go`:

Purpose: Wrap any `func(ctx) (T, error)` call with a configurable timeout.
Used by adapters (Tesla, EIA, geocoding) to enforce deadlines on external calls.

```go
package httputil

// TimeoutConfig configures call timeout behavior.
type TimeoutConfig struct {
    Timeout time.Duration
}

// DefaultTimeoutConfig returns a 10-second timeout.
func DefaultTimeoutConfig() TimeoutConfig

// WithTimeout executes fn with a context timeout.
// Returns context.DeadlineExceeded if fn doesn't complete in time.
func WithTimeout[T any](ctx context.Context, cfg TimeoutConfig, fn func(ctx context.Context) (T, error)) (T, error)
```

Implementation:
- Create derived context with `context.WithTimeout`
- Execute fn with derived context
- Defer cancel
- If error is `context.DeadlineExceeded`, wrap with descriptive message
- Use zerolog to log timeout events at Warn level

Also add `NewHTTPClient(timeout time.Duration) *http.Client` — a preconfigured
`http.Client` with timeout, transport settings, and sensible defaults:
```go
func NewHTTPClient(timeout time.Duration) *http.Client {
    return &http.Client{
        Timeout: timeout,
        Transport: &http.Transport{
            MaxIdleConns:        100,
            MaxIdleConnsPerHost: 10,
            IdleConnTimeout:     90 * time.Second,
        },
    }
}
```

Create `timeout_test.go` with:
- Test successful call within timeout
- Test call that exceeds timeout → returns DeadlineExceeded
- Test context cancellation propagation
- Test NewHTTPClient returns client with correct timeout

### Step 2: Add Request Logger — `logging.go`

Create `internal/platform/httputil/logging.go`:

Purpose: Structured logging for outbound HTTP requests (not handler middleware —
that already exists). Used by adapters making external API calls.

```go
package httputil

// LoggedTransport wraps http.RoundTripper and logs every outbound request/response.
type LoggedTransport struct {
    Base   http.RoundTripper
    Name   string // e.g., "tesla-api", "eia-api", "geocoder"
}

func (t *LoggedTransport) RoundTrip(req *http.Request) (*http.Response, error)
```

Implementation:
- Log at Debug level: method, URL (sanitized — strip query params with secrets), name
- On response: log status code, latency, content-length
- On error: log at Error level with error message
- Strip Authorization headers from logs
- Use zerolog structured fields: `method`, `url`, `status`, `latency_ms`, `adapter`

Create `logging_test.go` with:
- Test request/response are logged with correct fields
- Test error responses log at Error level
- Test Authorization header is NOT logged

### Step 3: Add Rate Limiter for Adapters — `ratelimiter.go`

Create `internal/platform/httputil/ratelimiter.go`:

Purpose: In-memory token bucket rate limiter for outbound API calls.
The existing `middleware/ratelimit.go` is Redis-based and for inbound requests.
Adapters need a simple in-memory limiter for external API rate limits.

```go
package httputil

// RateLimiter implements a token bucket algorithm for outbound rate limiting.
type RateLimiter struct {
    rate     float64       // tokens per second
    burst    int           // max burst size
    tokens   float64
    lastTime time.Time
    mu       sync.Mutex
}

// NewRateLimiter creates a rate limiter with given rate (req/s) and burst.
func NewRateLimiter(ratePerSecond float64, burst int) *RateLimiter

// Wait blocks until a token is available or ctx is cancelled.
func (rl *RateLimiter) Wait(ctx context.Context) error

// Allow returns true immediately if a token is available (non-blocking).
func (rl *RateLimiter) Allow() bool

// RateLimitedTransport wraps http.RoundTripper with rate limiting.
type RateLimitedTransport struct {
    Base    http.RoundTripper
    Limiter *RateLimiter
}

func (t *RateLimitedTransport) RoundTrip(req *http.Request) (*http.Response, error)
```

Use cases:
- Tesla Fleet API: 10 req/s burst, 1 req/s sustained
- EIA API: 5 req/s
- Geocoding: 50 req/s (Google), 5 req/s (Nominatim)

Create `ratelimiter_test.go` with:
- Test token refill over time
- Test burst allows N immediate requests
- Test Wait blocks when exhausted
- Test Allow returns false when exhausted
- Test context cancellation during Wait

### Step 4: Add Composable Client Builder — `client.go`

Create `internal/platform/httputil/client.go`:

Purpose: Compose all the above into a single reusable HTTP client builder.

```go
package httputil

// ClientConfig combines timeout, retry, circuit breaker, rate limit, and logging.
type ClientConfig struct {
    Name           string
    Timeout        time.Duration
    Retry          RetryConfig
    CircuitBreaker *CircuitBreakerConfig  // nil = no circuit breaker
    RateLimit      *RateLimiter           // nil = no rate limit
    EnableLogging  bool
}

// NewClient builds an *http.Client with the configured middleware stack.
func NewClient(cfg ClientConfig) *http.Client
```

The transport chain: `LoggedTransport → RateLimitedTransport → RetryableTransport → http.DefaultTransport`

Create `client_test.go` with:
- Test full chain: logging + rate limit + retry + base transport

### Step 5: Add doc.go

Create `internal/platform/httputil/doc.go`:
```go
// Package httputil provides reusable HTTP utilities for the TeslaSync platform.
//
// Components:
//   - CircuitBreaker: prevents cascading failures to unhealthy services
//   - Retry:          exponential backoff with jitter for transient failures
//   - RateLimiter:    token bucket for outbound API rate limiting
//   - Timeout:        context-based deadline enforcement
//   - Logging:        structured request/response logging for adapters
//   - Response:       standardized JSON response envelope
//   - Request:        generic JSON decode + validation
//   - Client:         composable HTTP client builder
//
// See ENGINEERING_GUIDELINES.md Section 6.3 for usage patterns.
package httputil
```

---

## Verification

```bash
# 1. All tests pass
go test ./internal/platform/httputil/... -v -count=1

# 2. Build passes
go build ./...

# 3. No lint issues
golangci-lint run ./internal/platform/httputil/...

# 4. Test coverage
go test ./internal/platform/httputil/... -coverprofile=cover.out
go tool cover -func=cover.out | tail -1
# Target: ≥80% coverage
```

## Do NOT:
- Modify existing circuit_breaker.go, retry.go, response.go, request.go
- Change the existing handler middleware in internal/handler/middleware/
- Add external dependencies (use only stdlib + zerolog)
- Skip tests — every new file needs a corresponding _test.go
