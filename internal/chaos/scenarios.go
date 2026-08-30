package chaos

import (
	"context"
	"fmt"
	"time"
)

// Scenario is a single, self-contained chaos experiment. Each scenario
// declares the proxy it targets, the toxic it injects, how long the
// fault stays active, and (optionally) a verification hook that runs
// AFTER the toxic is removed to confirm the system recovered.
//
// Design decision: scenarios are sequential, not parallel. Running two
// scenarios at the same time makes attribution of recovery failures
// ambiguous — and the harness is a diagnostic tool, not a load test.
type Scenario struct {
	// Name is the human-friendly label used in logs + metrics.
	Name string
	// Proxy is the Toxiproxy proxy name (e.g. "mqtt", "redis", "postgres").
	Proxy string
	// Toxic is the fault to inject.
	Toxic Toxic
	// Duration is how long the toxic stays attached before the harness
	// removes it. Must be > 0.
	Duration time.Duration
	// Verify is an optional post-recovery probe. If non-nil it runs
	// AFTER the toxic is removed and after the SettleDelay grace
	// period. A non-nil error means the system did NOT recover within
	// SLO — the scenario fails and the runner exits non-zero.
	Verify func(ctx context.Context) error
	// SettleDelay is how long to wait after toxic removal before
	// running Verify. Defaults to 10s if zero.
	SettleDelay time.Duration
}

// Run installs the toxic, waits Duration, removes it, then runs
// Verify (if set). Cleanup is deferred so a panic or context cancel
// still removes the toxic.
func (s Scenario) Run(ctx context.Context, c *Client) error {
	if s.Name == "" || s.Proxy == "" || s.Toxic.Name == "" || s.Duration <= 0 {
		return fmt.Errorf("scenario %q: invalid: name/proxy/toxic.name/duration all required", s.Name)
	}
	if err := c.AddToxic(ctx, s.Proxy, s.Toxic); err != nil {
		return fmt.Errorf("scenario %q: install toxic: %w", s.Name, err)
	}
	removed := false
	// Defer removal — we want cleanup even if the wait-loop ctx
	// expires. Use a fresh context for cleanup so a cancelled parent
	// doesn't prevent removal.
	defer func() {
		if removed {
			return
		}
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = c.RemoveToxic(cleanupCtx, s.Proxy, s.Toxic.Name)
	}()

	select {
	case <-time.After(s.Duration):
	case <-ctx.Done():
		return ctx.Err()
	}

	removeCtx, removeCancel := context.WithTimeout(context.Background(), 10*time.Second)
	err := c.RemoveToxic(removeCtx, s.Proxy, s.Toxic.Name)
	removeCancel()
	if err != nil {
		return fmt.Errorf("scenario %q: remove toxic: %w", s.Name, err)
	}
	removed = true

	settle := s.SettleDelay
	if settle == 0 {
		settle = 10 * time.Second
	}
	select {
	case <-time.After(settle):
	case <-ctx.Done():
		return ctx.Err()
	}

	if s.Verify != nil {
		if err := s.Verify(ctx); err != nil {
			return fmt.Errorf("scenario %q verify failed: %w", s.Name, err)
		}
	}
	return nil
}

// DefaultScenarios returns the canonical TeslaSync chaos suite. Each
// scenario is documented inline with the failure mode it simulates and
// the recovery contract it exercises.
//
// Verify hooks are intentionally nil here — the runner binary wires
// them up with concrete HTTP probes against the API's /healthz +
// /readyz endpoints (and any custom checks the operator passes in).
func DefaultScenarios() []Scenario {
	return []Scenario{
		{
			// MQTT broker becomes unreachable for 30s. The Tesla
			// telemetry pipeline must reconnect + resume processing
			// without dropping a vehicle. Recovery contract: API
			// /healthz back to 200 within 10s of the toxic being
			// removed.
			Name:     "mqtt_blackhole_30s",
			Proxy:    "mqtt",
			Duration: 30 * time.Second,
			Toxic: Toxic{
				Name: "mqtt_blackhole",
				Type: "timeout",
				Attributes: map[string]interface{}{
					"timeout": 0, // 0 = drop all traffic
				},
			},
		},
		{
			// Redis is degraded with 500ms of upstream latency for
			// 60s. SignalStore L1 reads should be unaffected; SSE +
			// cross-pod live reads degrade gracefully without
			// returning 500s to the SPA.
			Name:     "redis_latency_500ms_60s",
			Proxy:    "redis",
			Duration: 60 * time.Second,
			Toxic: Toxic{
				Name:     "redis_latency",
				Type:     "latency",
				Stream:   "downstream",
				Toxicity: 1.0,
				Attributes: map[string]interface{}{
					"latency": 500,
					"jitter":  50,
				},
			},
		},
		{
			// Postgres is throttled to 1 MB/s upstream + downstream
			// for 45s. Long-running analytics queries should hit the
			// QueryBudget middleware ceiling; write paths should
			// queue but not panic.
			Name:     "postgres_throttle_1mbps_45s",
			Proxy:    "postgres",
			Duration: 45 * time.Second,
			Toxic: Toxic{
				Name:     "postgres_throttle",
				Type:     "bandwidth",
				Stream:   "downstream",
				Toxicity: 1.0,
				Attributes: map[string]interface{}{
					"rate": 1024, // KB/s
				},
			},
		},
		{
			// Redis blackhole — the rollback path for distributed
			// live signal reads. SignalStore L1 stays fresh, so the
			// FSM/telemetry hot path must continue uninterrupted.
			Name:     "redis_blackhole_20s",
			Proxy:    "redis",
			Duration: 20 * time.Second,
			Toxic: Toxic{
				Name: "redis_blackhole",
				Type: "timeout",
				Attributes: map[string]interface{}{
					"timeout": 0,
				},
			},
		},
	}
}
