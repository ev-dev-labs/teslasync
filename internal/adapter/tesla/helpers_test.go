package tesla

import (
	"net/http"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// newTestClient builds a Client wired to a test server URL with a plain
// http.Client (no retry transport) so tests exercise this package's own
// request/response logic deterministically. Each client owns a fresh circuit
// breaker so breaker state never leaks between tests.
func newTestClient(baseURL string, timeout time.Duration) *Client {
	return &Client{
		httpClient: &http.Client{},
		baseURL:    baseURL,
		authURL:    baseURL,
		cb:         httputil.NewCircuitBreaker("test", httputil.DefaultCircuitBreakerConfig()),
		timeout:    timeout,
	}
}

// newTestClientWithBreaker is like newTestClient but lets a test inject a
// circuit-breaker config (e.g. a low failure threshold to force the open state).
func newTestClientWithBreaker(baseURL string, timeout time.Duration, cb httputil.CircuitBreakerConfig) *Client {
	c := newTestClient(baseURL, timeout)
	c.cb = httputil.NewCircuitBreaker("test", cb)
	return c
}

// assertEq fails the test when got != want for any comparable value.
func assertEq[T comparable](t *testing.T, field string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s = %v, want %v", field, got, want)
	}
}

// assertEqf compares two float64 values within a small tolerance.
func assertEqf(t *testing.T, field string, got, want float64) {
	t.Helper()
	const eps = 1e-9
	if diff := got - want; diff > eps || diff < -eps {
		t.Errorf("%s = %v, want %v", field, got, want)
	}
}
