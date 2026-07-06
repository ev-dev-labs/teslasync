package elevation

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// defaultTimeout bounds a single HTTP round-trip to the elevation
// service. Lookups run on the telemetry hot path (see Provider's doc
// comment), so this stays short — a slow/unreachable elevation service
// must never stall position ingestion.
const defaultTimeout = 2 * time.Second

// Config configures a Client for a self-hosted elevation HTTP service
// compatible with akhenakh/gedtm30api's REST API
// (GET /getElevation/{lat}/{lng}).
type Config struct {
	// ServiceURL is the base URL of the self-hosted elevation service,
	// e.g. "http://elevation:8080" (the docker-compose service name) or
	// "http://localhost:8080" for local development. Required — use
	// NoopProvider instead of Client when elevation is not configured.
	ServiceURL string

	// Timeout bounds a single HTTP round-trip. Defaults to 2s.
	Timeout time.Duration

	// Sink is the optional outbound api_call_logs sink, threaded through
	// like every other httputil-based adapter in this repo (see
	// internal/geocoding.SetSink). Nil is safe (falls back to
	// zerolog-only logging).
	Sink httputil.APICallSink
}

// Client calls a self-hosted elevation HTTP service. See the package
// doc comment for the reference server (akhenakh/gedtm30api) and why a
// self-hosted, free, worldwide DEM service is the right fit here.
//
// A *Client is safe for concurrent use: the wrapped *http.Client and
// *httputil.CircuitBreaker are both goroutine-safe, and Client holds no
// other mutable state.
type Client struct {
	httpClient *http.Client
	cb         *httputil.CircuitBreaker
	baseURL    string
}

// NewProviderOrNoop is the standard way production wiring turns an
// optional elevation-service setting into a Provider: an empty
// serviceURL returns NoopProvider{} (elevation stays unavailable, no
// behavior change for operators who haven't deployed one), otherwise it
// returns a *Client. Mirrors internal/geocoding.NewGeocoder's "no API
// key configured -> still works" pattern. Used by both
// internal/app (the primary production wiring, which has an
// httputil.APICallSink to pass) and internal/api.NewRouter's
// standalone-handler fallback path (sink may be nil there).
func NewProviderOrNoop(serviceURL string, timeout time.Duration, sink httputil.APICallSink) Provider {
	if serviceURL == "" {
		return NoopProvider{}
	}
	return NewClient(Config{ServiceURL: serviceURL, Timeout: timeout, Sink: sink})
}

// NewClient builds a Client for the elevation service at cfg.ServiceURL.
// Panics if cfg.ServiceURL is empty — a Client with no target is a
// wiring bug; callers that want elevation lookups disabled should wire
// NoopProvider instead of calling NewClient at all.
//
// The circuit breaker (5 consecutive failures opens it, 30s reset) is
// what actually protects the telemetry hot path once the elevation
// service is down for a stretch: without it, EVERY completed lat/lng
// fix would pay the full Timeout before falling back to "no elevation,"
// which at fleet scale (every vehicle, every few seconds) would add
// real backpressure to position ingestion. Once open, Execute fails
// immediately with no network call at all.
func NewClient(cfg Config) *Client {
	if cfg.ServiceURL == "" {
		panic("elevation: NewClient: cfg.ServiceURL must be non-empty (use NoopProvider to disable)")
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = defaultTimeout
	}
	return &Client{
		httpClient: httputil.NewClient(httputil.ClientConfig{
			Name:          "elevation",
			Timeout:       timeout,
			EnableLogging: true,
			Sink:          cfg.Sink,
		}),
		cb:      httputil.NewCircuitBreaker("elevation", httputil.DefaultCircuitBreakerConfig()),
		baseURL: strings.TrimRight(cfg.ServiceURL, "/"),
	}
}

// elevationResponse is the JSON shape returned by
// GET /getElevation/{lat}/{lng} on a gedtm30api-compatible server:
//
//	{"elevation": 4805.3, "latitude": 45.8329, "longitude": 6.8648}
type elevationResponse struct {
	Elevation float64 `json:"elevation"`
}

// Lookup implements Provider by calling the elevation service's
// single-point REST endpoint. A circuit-open, timeout, non-200
// status, or malformed body all return ok=false with a non-nil err —
// none of these are fatal to the caller, which is expected to proceed
// without an elevation value.
func (c *Client) Lookup(ctx context.Context, lat, lon float64) (float64, bool, error) {
	reqURL := fmt.Sprintf("%s/getElevation/%s/%s", c.baseURL, formatCoord(lat), formatCoord(lon))

	var out elevationResponse
	err := c.cb.Execute(func() error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
		if err != nil {
			return fmt.Errorf("build request: %w", err)
		}

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return fmt.Errorf("request failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fmt.Errorf("unexpected status %d", resp.StatusCode)
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, false, fmt.Errorf("elevation: %w", err)
	}
	return out.Elevation, true, nil
}

// formatCoord renders a coordinate with enough precision (6 decimal
// places is ~11cm at the equator) without the noisy trailing digits
// Go's default float formatting produces.
func formatCoord(v float64) string {
	return strconv.FormatFloat(v, 'f', 6, 64)
}

// Compile-time assertion that *Client satisfies Provider.
var _ Provider = (*Client)(nil)
