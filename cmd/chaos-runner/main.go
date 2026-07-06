// chaos-runner is the operator-facing entrypoint for TeslaSync's
// scripted fault-injection suite. It runs the default scenario library
// (see internal/chaos/scenarios.go) sequentially against a running
// Toxiproxy instance, optionally probing API health endpoints after
// each scenario, and exits non-zero if any scenario fails or any
// recovery probe times out.
//
// Usage:
//
//	docker compose --profile chaos up -d
//	./chaos-runner
//
// Env:
//
//	TOXIPROXY_URL    (default http://localhost:8474)
//	API_BASE_URL     (default http://localhost:8080)  — used by recovery probe
//	CHAOS_SCENARIOS  (default "all") — comma-separated list of scenario names
//	                                    to run; "all" runs DefaultScenarios()
//
// Output: one JSON-shaped result line per scenario to stdout, suitable
// for parsing by a CI step or log shipper.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/chaos"
)

type runResult struct {
	Name       string `json:"name"`
	OK         bool   `json:"ok"`
	DurationMs int64  `json:"duration_ms"`
	Error      string `json:"error,omitempty"`
}

func main() {
	zerolog.TimeFieldFormat = time.RFC3339
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	toxiURL := envOr("TOXIPROXY_URL", "http://localhost:8474")
	apiURL := envOr("API_BASE_URL", "http://localhost:8080")
	want := envOr("CHAOS_SCENARIOS", "all")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	client := chaos.NewClient(toxiURL)
	if err := client.Ping(ctx); err != nil {
		log.Fatal().Err(err).Str("toxiproxy", toxiURL).
			Msg("toxiproxy unreachable; did you start the `chaos` compose profile?")
	}

	probe := makeAPIProbe(apiURL)
	scenarios := selectScenarios(want, probe)

	failed := run(ctx, client, scenarios, os.Stdout)

	if failed > 0 {
		log.Error().Int("failed", failed).Int("total", len(scenarios)).Msg("chaos run FAILED")
		os.Exit(1)
	}
	log.Info().Int("total", len(scenarios)).Msg("chaos run OK")
}

// run executes each scenario sequentially against client, emitting one
// JSON runResult line per scenario to out, and returns the number of
// scenarios that failed. It never calls os.Exit so it is unit-testable;
// main() maps the failure count onto the process exit code.
func run(ctx context.Context, client *chaos.Client, scenarios []chaos.Scenario, out io.Writer) int {
	var failed int
	for _, s := range scenarios {
		start := time.Now()
		err := s.Run(ctx, client)
		res := runResult{
			Name:       s.Name,
			OK:         err == nil,
			DurationMs: time.Since(start).Milliseconds(),
		}
		if err != nil {
			res.Error = err.Error()
			failed++
			log.Error().Err(err).Str("scenario", s.Name).Msg("chaos scenario FAILED")
		} else {
			log.Info().Str("scenario", s.Name).Int64("duration_ms", res.DurationMs).Msg("chaos scenario OK")
		}
		body, err := json.Marshal(res)
		if err != nil {
			// runResult is all scalar fields so this is effectively
			// unreachable, but never silently drop a result line.
			log.Error().Err(err).Str("scenario", s.Name).Msg("marshal chaos result")
			continue
		}
		fmt.Fprintln(out, string(body))
	}
	return failed
}

// probeConfig holds the tunable timing knobs for the recovery probe.
// Extracted so tests can drive the retry/recovery loop deterministically
// instead of waiting on the production 30s deadline.
type probeConfig struct {
	// httpTimeout bounds each individual GET /healthz call.
	httpTimeout time.Duration
	// deadline is the total wall-clock budget for the system to recover.
	deadline time.Duration
	// interval is how long to wait between recovery attempts.
	interval time.Duration
}

// defaultProbeConfig is the production timing: a 5s per-request timeout,
// a 30s recovery budget, and a 2s gap between attempts.
func defaultProbeConfig() probeConfig {
	return probeConfig{
		httpTimeout: 5 * time.Second,
		deadline:    30 * time.Second,
		interval:    2 * time.Second,
	}
}

// makeAPIProbe returns a verify hook that GETs /healthz against the
// API. A 200 within the probe deadline counts as recovery; anything
// else fails the scenario.
func makeAPIProbe(apiURL string) func(context.Context) error {
	return makeAPIProbeWithConfig(apiURL, defaultProbeConfig())
}

// makeAPIProbeWithConfig is makeAPIProbe with explicit timing, used
// directly by tests. The returned hook retries GET /healthz every
// cfg.interval until it observes a 200 or cfg.deadline elapses, honouring
// context cancellation between attempts.
func makeAPIProbeWithConfig(apiURL string, cfg probeConfig) func(context.Context) error {
	hc := &http.Client{Timeout: cfg.httpTimeout}
	return func(ctx context.Context) error {
		deadline := time.Now().Add(cfg.deadline)
		var lastErr error
		for time.Now().Before(deadline) {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL+"/healthz", nil)
			if err != nil {
				return fmt.Errorf("build probe request: %w", err)
			}
			resp, err := hc.Do(req)
			if err == nil {
				// Drain then close so the underlying connection can be
				// reused across retry attempts.
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
				lastErr = fmt.Errorf("/healthz returned %d", resp.StatusCode)
			} else {
				lastErr = err
			}
			select {
			case <-time.After(cfg.interval):
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if lastErr != nil {
			return fmt.Errorf("api never recovered: %w", lastErr)
		}
		return errors.New("api never recovered")
	}
}

func selectScenarios(want string, verify func(context.Context) error) []chaos.Scenario {
	all := chaos.DefaultScenarios()
	for i := range all {
		all[i].Verify = verify
	}
	if want == "" || want == "all" {
		return all
	}
	wanted := map[string]bool{}
	for _, n := range strings.Split(want, ",") {
		wanted[strings.TrimSpace(n)] = true
	}
	out := make([]chaos.Scenario, 0, len(all))
	for _, s := range all {
		if wanted[s.Name] {
			out = append(out, s)
		}
	}
	return out
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
