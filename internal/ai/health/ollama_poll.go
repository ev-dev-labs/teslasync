// Package health is the per-provider liveness poller. F9 ships with
// one consumer — the Ollama poller — that watches the user-configured
// local Ollama server and signals the [limit.Limiter] to suspend
// dispatch to the provider when the server goes unhealthy (typically
// the model OOM'd and the daemon is restarting).
//
// The poller is a thin loop:
//
//  1. Every Interval (default 30s) GET <base_url>/api/tags. The
//     endpoint returns 200 when the daemon is up and at least one
//     model is loaded; any other response is "unhealthy".
//  2. After [FailureThreshold] consecutive unhealthy responses (or
//     a body containing the literal "out of memory" / "OOM"), call
//     limiter.SuspendProvider(name, now+SuspendDuration). Subsequent
//     Allow() calls for that provider return Decision.Reason=
//     "provider_unavailable" until the suspension expires.
//  3. The next healthy poll resets the failure counter immediately;
//     the suspension auto-expires from the limiter side.
//
// ADR-015 fit:
//   - The poller hits ONLY the user-configured local URL the user
//     already set in Settings → AI → Provider. No new egress paths
//     (§I4). When ai_mode is "off" the poller is not constructed.
//   - Suspension reduces calls to a sick provider but never breaks
//     the app (§I3) — the AiLimitBanner surfaces the suspension to
//     the user with retry guidance.
package health

import (
	"context"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
)

// DefaultInterval is the time between health probes when no override
// is supplied. 30s matches the F9 prompt design D10.6 and is a
// compromise between "react fast to an OOM" and "do not load the
// daemon with a probe storm".
const DefaultInterval = 30 * time.Second

// DefaultFailureThreshold is the number of consecutive failed probes
// the poller tolerates before signalling suspension. 3 catches a
// real outage while ignoring a single dropped packet.
const DefaultFailureThreshold = 3

// DefaultSuspendDuration is how long a suspended provider stays
// suspended in the limiter. 60s gives a restarting daemon time to
// reload the model without leaving a permanent block on a transient
// failure.
const DefaultSuspendDuration = 60 * time.Second

// DefaultProbeTimeout bounds a single probe so a hung daemon does
// not block the poll loop forever. Smaller than Interval so a slow
// probe never overlaps the next one.
const DefaultProbeTimeout = 5 * time.Second

// Doer is the narrow http client interface the poller uses.
// http.Client satisfies it; tests pass a recording fake.
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// Suspender is the limiter-side surface the poller calls. The full
// [*limit.Limiter] satisfies it; the indirection lets tests assert
// suspension calls without standing up a real limiter.
type Suspender interface {
	SuspendProvider(name string, until time.Time)
}

// Clock is the time source. Mirrors [limit.Clock] so tests can use
// the same FakeClock instance for both the limiter and the poller.
type Clock interface {
	Now() time.Time
}

// realClock returns time.Now().UTC(). Avoids importing limit just
// for SystemClock so the health package stays a leaf node.
type realClock struct{}

func (realClock) Now() time.Time { return time.Now().UTC() }

// Config configures an [OllamaPoller]. All fields have sane defaults
// applied by [NewOllamaPoller] when zero — a Config{BaseURL: "..."}
// is enough for production wiring.
type Config struct {
	// BaseURL is the Ollama server URL (e.g. "http://localhost:11434").
	// Required; an empty value makes [NewOllamaPoller] return nil and
	// log a one-line warning so the operator notices.
	BaseURL string

	// ProviderName is the [limit.Decision].providerName value the
	// poller passes to SuspendProvider. Defaults to "ollama".
	ProviderName string

	// Interval is the time between probes. Defaults to [DefaultInterval].
	Interval time.Duration

	// FailureThreshold is the consecutive-failure count before
	// suspension. Defaults to [DefaultFailureThreshold].
	FailureThreshold int

	// SuspendDuration is how long the limiter suspension lasts after
	// a threshold breach. Defaults to [DefaultSuspendDuration].
	SuspendDuration time.Duration

	// ProbeTimeout is the per-probe timeout. Defaults to
	// [DefaultProbeTimeout]. Must be < Interval.
	ProbeTimeout time.Duration

	// HTTPClient is the http.Client (or stand-in) used to probe.
	// Defaults to a shared http.DefaultClient with no transport tweaks.
	HTTPClient Doer

	// Clock is the time source. Defaults to a system clock.
	Clock Clock
}

// OllamaPoller is the F9 health watcher for a local Ollama server.
// Run it on the app background context; it exits when the context
// cancels. Safe for concurrent observation via [LastStatus] /
// [ConsecutiveFailures].
type OllamaPoller struct {
	cfg       Config
	suspender Suspender

	consecFails atomic.Int32
	lastStatus  atomic.Value // string
}

// NewOllamaPoller constructs a poller. Returns nil + logs a warning
// when cfg.BaseURL is empty so a misconfigured boot does not panic.
// The caller must verify non-nil before calling Run.
func NewOllamaPoller(cfg Config, suspender Suspender) *OllamaPoller {
	if cfg.BaseURL == "" {
		log.Warn().Msg("ai/health: NewOllamaPoller called with empty BaseURL — poller disabled")
		return nil
	}
	if suspender == nil {
		log.Warn().Msg("ai/health: NewOllamaPoller called with nil Suspender — poller disabled")
		return nil
	}
	if cfg.ProviderName == "" {
		cfg.ProviderName = "ollama"
	}
	if cfg.Interval <= 0 {
		cfg.Interval = DefaultInterval
	}
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = DefaultFailureThreshold
	}
	if cfg.SuspendDuration <= 0 {
		cfg.SuspendDuration = DefaultSuspendDuration
	}
	if cfg.ProbeTimeout <= 0 {
		cfg.ProbeTimeout = DefaultProbeTimeout
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = http.DefaultClient
	}
	if cfg.Clock == nil {
		cfg.Clock = realClock{}
	}
	p := &OllamaPoller{cfg: cfg, suspender: suspender}
	p.lastStatus.Store("unknown")
	return p
}

// LastStatus is the last probe outcome ("ok" | "fail" | "unknown").
// Diagnostic — the admin metrics endpoint can render this.
func (p *OllamaPoller) LastStatus() string {
	v, _ := p.lastStatus.Load().(string)
	return v
}

// ConsecutiveFailures is the running failure count. Exposed for
// metrics + tests.
func (p *OllamaPoller) ConsecutiveFailures() int {
	return int(p.consecFails.Load())
}

// Run blocks until ctx is cancelled, probing every Interval. An
// initial probe fires immediately so a permanently-down daemon
// surfaces on the first iteration without waiting for Interval to
// elapse.
//
// Returns nil on graceful (ctx.Done) exit. Errors from individual
// probes are logged + counted, never returned — a single bad probe
// must not kill the whole loop.
func (p *OllamaPoller) Run(ctx context.Context) error {
	p.probeOnce(ctx)
	ticker := time.NewTicker(p.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			p.probeOnce(ctx)
		}
	}
}

// probeOnce executes a single GET /api/tags probe and either resets
// the failure counter (on success) or increments it (on failure).
// On threshold breach, calls the limiter's SuspendProvider.
func (p *OllamaPoller) probeOnce(parent context.Context) {
	ctx, cancel := context.WithTimeout(parent, p.cfg.ProbeTimeout)
	defer cancel()

	url := strings.TrimRight(p.cfg.BaseURL, "/") + "/api/tags"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		p.recordFailure("request build: " + err.Error())
		return
	}
	resp, err := p.cfg.HTTPClient.Do(req)
	if err != nil {
		p.recordFailure("transport: " + err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		p.recordFailure("status " + resp.Status)
		return
	}
	// Drain body briefly to look for OOM markers; Ollama sometimes
	// returns 200 with an error body when a model is unloaded due
	// to memory pressure. Bound the read so a huge body does not
	// blow up.
	body := make([]byte, 4096)
	n, _ := resp.Body.Read(body)
	low := strings.ToLower(string(body[:n]))
	if strings.Contains(low, "out of memory") || strings.Contains(low, "oom") {
		p.recordFailure("oom indicator in response body")
		return
	}

	// Healthy — reset counter + status.
	p.consecFails.Store(0)
	p.lastStatus.Store("ok")
}

// recordFailure increments the counter, updates status, and triggers
// suspension when the threshold is hit. Threshold breaches are
// idempotent — the same failed probe re-suspending the provider is
// fine because [limit.Limiter.SuspendProvider] always uses the
// LATEST until-time.
func (p *OllamaPoller) recordFailure(reason string) {
	failures := p.consecFails.Add(1)
	p.lastStatus.Store("fail")
	log.Warn().
		Int32("consecutive_failures", failures).
		Int("threshold", p.cfg.FailureThreshold).
		Str("reason", reason).
		Str("provider", p.cfg.ProviderName).
		Msg("ai/health: ollama probe failed")

	if int(failures) < p.cfg.FailureThreshold {
		return
	}
	until := p.cfg.Clock.Now().Add(p.cfg.SuspendDuration)
	p.suspender.SuspendProvider(p.cfg.ProviderName, until)
	log.Warn().
		Str("provider", p.cfg.ProviderName).
		Time("suspended_until", until).
		Dur("duration", p.cfg.SuspendDuration).
		Msg("ai/health: provider suspended due to consecutive probe failures")
}
