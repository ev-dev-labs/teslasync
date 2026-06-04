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
// Layer: platform
//
// ADR-007 makes this package the home for cross-cutting HTTP client
// utilities: timeouts, circuit breaking, retry, rate limiting, and the
// APICallSink hook consumed by internal/apilog.
package httputil
