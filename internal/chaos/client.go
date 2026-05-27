// Package chaos provides a scripted fault-injection harness for
// TeslaSync's runtime dependencies (MQTT, Redis, Postgres).
//
// Phase-49 / p49-chaos.
//
// The harness drives Toxiproxy (https://github.com/Shopify/toxiproxy) —
// a programmable TCP proxy that can inject latency, drops, and bandwidth
// limits between TeslaSync and its backing services. It is intentionally
// non-destructive: a chaos run starts a scenario, observes recovery, and
// removes all injected faults at the end. If the runner crashes mid-run,
// the operator restarts the underlying compose service and Toxiproxy's
// in-memory state is cleared.
//
// Architecture:
//
//	chaos.Runner (this package)
//	     │  uses
//	     ▼
//	Toxiproxy HTTP admin API (http://toxiproxy:8474)
//	     │  proxies
//	     ▼
//	{mqtt,redis,postgres}  ← real services
//
// The Go API + workers connect to the Toxiproxy port, NOT to the real
// service port, when the `chaos` compose profile is active. See
// docker-compose.yml chaos profile for the wiring.
//
// This package only contains the scenario library + a thin Toxiproxy
// client. The runner binary lives at cmd/chaos-runner. Scenarios MUST
// be safe to repeat — every scenario is responsible for cleaning up its
// own toxics in a deferred block.
package chaos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is a tiny Toxiproxy HTTP admin client. It only implements the
// subset of endpoints the chaos scenarios actually use:
//   - POST /proxies/{name}/toxics      add a toxic
//   - DELETE /proxies/{name}/toxics/{toxic_name}
//   - GET /proxies/{name}/toxics
//
// Failures are bubbled up wrapped with %w so the caller can decide
// whether to abort the scenario or continue degraded.
type Client struct {
	baseURL string
	hc      *http.Client
}

// NewClient builds a Toxiproxy admin client targeting baseURL
// (e.g. "http://toxiproxy:8474"). The default HTTP client has a 10s
// timeout — Toxiproxy admin calls are local + fast, anything slower
// than that indicates a real problem.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		hc:      &http.Client{Timeout: 10 * time.Second},
	}
}

// Toxic is the JSON payload Toxiproxy expects when adding a fault.
// See https://github.com/Shopify/toxiproxy#toxics for the canonical
// list — TeslaSync's scenarios use latency, bandwidth, timeout, and
// down (full stop).
type Toxic struct {
	Name       string                 `json:"name"`
	Type       string                 `json:"type"`
	Stream     string                 `json:"stream,omitempty"` // upstream|downstream
	Toxicity   float64                `json:"toxicity,omitempty"`
	Attributes map[string]interface{} `json:"attributes,omitempty"`
}

// AddToxic posts a toxic to the named proxy. If the proxy already has
// a toxic with the same name, Toxiproxy returns 409 Conflict which we
// surface as an error — callers should pick unique names per scenario.
func (c *Client) AddToxic(ctx context.Context, proxy string, t Toxic) error {
	body, err := json.Marshal(t)
	if err != nil {
		return fmt.Errorf("marshal toxic: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/proxies/%s/toxics", c.baseURL, proxy),
		bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("post toxic: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("toxiproxy returned %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

// RemoveToxic deletes a previously added toxic by name. Idempotent —
// a 404 is swallowed because the most common caller is a deferred
// cleanup block that may double-fire on shutdown.
func (c *Client) RemoveToxic(ctx context.Context, proxy, name string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		fmt.Sprintf("%s/proxies/%s/toxics/%s", c.baseURL, proxy, name), nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("delete toxic: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil
	}
	if resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("toxiproxy returned %d: %s", resp.StatusCode, string(raw))
	}
	return nil
}

// Ping verifies the Toxiproxy admin endpoint is reachable. Used by
// the runner during startup so the operator sees a clean error if the
// chaos profile wasn't started.
func (c *Client) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/version", nil)
	if err != nil {
		return err
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("ping toxiproxy: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("toxiproxy not healthy")
	}
	return nil
}
