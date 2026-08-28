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
//	CHAOS_EXPECT_FLEET_BATTERY_LEVEL (optional 0..100) — require the fleet
//	                                    recovery response to carry this live
//	                                    Redis-backed battery observation
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
	"strconv"
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
	fleetProbeCfg := defaultProbeConfig()
	if raw := strings.TrimSpace(os.Getenv("CHAOS_EXPECT_FLEET_BATTERY_LEVEL")); raw != "" {
		expected, err := strconv.Atoi(raw)
		if err != nil || expected < 0 || expected > 100 {
			log.Fatal().
				Str("value", raw).
				Msg("CHAOS_EXPECT_FLEET_BATTERY_LEVEL must be an integer from 0 through 100")
		}
		fleetProbeCfg.expectedFleetBatteryLevel = &expected
	}
	fleetProbe := makeFleetAwareProbeWithConfig(apiURL, fleetProbeCfg)
	// Redis and Postgres are on the read path for the canonical
	// fleet-state batch endpoint and per-vehicle battery reports —
	// their chaos scenarios verify those endpoints actually recovered,
	// not only that /healthz came back. Other scenarios (e.g. the MQTT
	// blackhole, which is an ingest-path fault) keep the /healthz-only
	// probe.
	verifyFor := func(s chaos.Scenario) func(context.Context) error {
		if s.Proxy == "redis" || s.Proxy == "postgres" {
			return fleetProbe
		}
		return probe
	}
	scenarios := selectScenarios(want, verifyFor)

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
	// expectedFleetBatteryLevel, when set, proves the recovered response
	// came through the seeded live Redis path rather than a success-shaped
	// empty or durable-only fallback.
	expectedFleetBatteryLevel *int
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
		err := retryRecoveryProbe(ctx, cfg, func(attemptCtx context.Context) error {
			return verifyHealthRecovered(attemptCtx, hc, apiURL)
		})
		if err != nil {
			return fmt.Errorf("api never recovered: %w", err)
		}
		return nil
	}
}

func retryRecoveryProbe(ctx context.Context, cfg probeConfig, probe func(context.Context) error) error {
	if cfg.deadline <= 0 {
		return errors.New("recovery deadline elapsed before first attempt")
	}
	probeCtx, cancel := context.WithTimeout(ctx, cfg.deadline)
	defer cancel()
	deadline, _ := probeCtx.Deadline()
	interval := cfg.interval
	if interval <= 0 {
		interval = time.Millisecond
	}
	var lastErr error
	for time.Now().Before(deadline) {
		if err := probeCtx.Err(); err != nil {
			return err
		}
		if err := probe(probeCtx); err == nil {
			if err := probeCtx.Err(); err != nil {
				return err
			}
			if !time.Now().Before(deadline) {
				return context.DeadlineExceeded
			}
			return nil
		} else {
			lastErr = err
		}
		wait := min(interval, time.Until(deadline))
		if wait <= 0 {
			break
		}
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-probeCtx.Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			if lastErr != nil && errors.Is(probeCtx.Err(), context.DeadlineExceeded) {
				return fmt.Errorf("%w: last recovery failure: %v", context.DeadlineExceeded, lastErr)
			}
			return probeCtx.Err()
		}
	}
	if lastErr == nil {
		return errors.New("recovery deadline elapsed before first attempt")
	}
	return fmt.Errorf("%w: last recovery failure: %v", context.DeadlineExceeded, lastErr)
}

func verifyHealthRecovered(ctx context.Context, hc *http.Client, apiURL string) error {
	endpoint := strings.TrimRight(apiURL, "/") + "/healthz"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("build probe request: %w", err)
	}
	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if _, err := io.Copy(io.Discard, io.LimitReader(resp.Body, 64*1024)); err != nil {
		return fmt.Errorf("read /healthz response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("/healthz returned %d", resp.StatusCode)
	}
	return nil
}

func selectScenarios(want string, verifyFor func(chaos.Scenario) func(context.Context) error) []chaos.Scenario {
	all := chaos.DefaultScenarios()
	for i := range all {
		all[i].Verify = verifyFor(all[i])
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

// maxFleetProbeBodyKiB caps the fleet-state response body the chaos
// probe reads. The endpoint's own limit=25 cap keeps this well under
// budget in practice; the read cap is a defence-in-depth safety net.
const maxFleetProbeBodyKiB = 512

// makeFleetAwareProbeWithConfig returns a verify hook that, after confirming
// /healthz has recovered, also exercises the canonical bulk fleet-state read
// and, when the fleet has at least one vehicle, a per-vehicle battery report.
func makeFleetAwareProbeWithConfig(apiURL string, cfg probeConfig) func(context.Context) error {
	hc := &http.Client{Timeout: cfg.httpTimeout}
	return func(ctx context.Context) error {
		err := retryRecoveryProbe(ctx, cfg, func(attemptCtx context.Context) error {
			if err := verifyHealthRecovered(attemptCtx, hc, apiURL); err != nil {
				return fmt.Errorf("health recovery check: %w", err)
			}
			vehicleID, err := verifyFleetStateRecovered(
				attemptCtx,
				hc,
				apiURL,
				cfg.expectedFleetBatteryLevel,
			)
			if err != nil {
				return fmt.Errorf("fleet state recovery check: %w", err)
			}
			// An empty fleet still proves the fleet-state endpoint recovered.
			if vehicleID == 0 {
				return nil
			}
			if err := verifyBatteryRecovered(attemptCtx, hc, apiURL, vehicleID); err != nil {
				return fmt.Errorf("battery recovery check: %w", err)
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("fleet read path never recovered: %w", err)
		}
		return nil
	}
}

// fleetStateEnvelope is the minimal shape the chaos probe needs from
// GET /api/v1/vehicles/states — see internal/app/fleetstatesvc.Batch
// for the full response.
type fleetStateEnvelope struct {
	Data *struct {
		Vehicles *[]fleetStateVehicle `json:"vehicles"`
	} `json:"data"`
}

type fleetStateVehicle struct {
	VehicleID int64 `json:"vehicle_id"`
	State     *struct {
		BatteryLevel int `json:"battery_level"`
	} `json:"state"`
	DataSource     string   `json:"data_source"`
	VerifiedFields []string `json:"verified_fields"`
}

// verifyFleetStateRecovered GETs the canonical fleet-state batch
// endpoint and returns the first vehicle id it finds (0 if the fleet is
// empty). A non-2xx status or a body that doesn't parse as the expected
// envelope is an error — a fast but malformed response is not recovery.
func verifyFleetStateRecovered(
	ctx context.Context,
	hc *http.Client,
	apiURL string,
	expectedBatteryLevel *int,
) (int64, error) {
	endpoint := strings.TrimRight(apiURL, "/") + "/api/v1/vehicles/states?limit=25"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		return 0, fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxFleetProbeBodyKiB*1024))
	if err != nil {
		return 0, fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	var envelope fleetStateEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return 0, fmt.Errorf("decode response: %w", err)
	}
	if envelope.Data == nil || envelope.Data.Vehicles == nil {
		return 0, errors.New("response missing non-null data.vehicles")
	}
	vehicles := *envelope.Data.Vehicles
	if len(vehicles) == 0 {
		if expectedBatteryLevel != nil {
			return 0, errors.New("response contained no vehicle for the required live battery evidence")
		}
		return 0, nil
	}
	vehicle := vehicles[0]
	vehicleID := vehicle.VehicleID
	if vehicleID <= 0 {
		return 0, errors.New("response contained an invalid vehicle_id")
	}
	if expectedBatteryLevel != nil {
		if vehicle.State == nil {
			return 0, errors.New("response missing state for the recovery-probe vehicle")
		}
		if vehicle.State.BatteryLevel != *expectedBatteryLevel {
			return 0, fmt.Errorf(
				"battery_level = %d, want seeded live value %d",
				vehicle.State.BatteryLevel,
				*expectedBatteryLevel,
			)
		}
		if vehicle.DataSource != "live_signal_store" {
			return 0, fmt.Errorf("data_source = %q, want live_signal_store", vehicle.DataSource)
		}
		if !containsString(vehicle.VerifiedFields, "battery_level") {
			return 0, errors.New("battery_level was not verified as an observed live field")
		}
	}
	return vehicleID, nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// verifyBatteryRecovered GETs the per-vehicle battery report for
// vehicleID. Only the status code is checked — the probe cares that
// the read path (Postgres + any Redis-backed cache in front of it) is
// serving again, not the specific battery figures.
func verifyBatteryRecovered(ctx context.Context, hc *http.Client, apiURL string, vehicleID int64) error {
	if vehicleID <= 0 {
		return errors.New("vehicle ID must be positive")
	}
	url := fmt.Sprintf("%s/api/v1/vehicles/%d/battery", strings.TrimRight(apiURL, "/"), vehicleID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := hc.Do(req)
	if err != nil {
		return fmt.Errorf("do: %w", err)
	}
	defer resp.Body.Close()
	if _, err := io.Copy(io.Discard, io.LimitReader(resp.Body, maxFleetProbeBodyKiB*1024)); err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status %d for vehicle %d battery report", resp.StatusCode, vehicleID)
	}
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
