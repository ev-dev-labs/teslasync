package synthetic

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	platformhttp "github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// ErrSkipStep is returned by JourneyStep.BuildURL when the step has
// nothing to exercise this run (e.g. inspecting a vehicle when the
// fleet-state step found zero vehicles). A skipped step is recorded as
// OK — it is not a probe failure — and the journey continues to the
// next step instead of aborting.
var ErrSkipStep = errors.New("synthetic: step has nothing to exercise this run")

// JourneyContext carries values discovered by earlier steps (e.g. a
// vehicle ID resolved from the fleet-state step) forward to later
// steps in the same journey run. A fresh JourneyContext is created for
// every Run call, so it is safe for JourneyProbe.Run to be invoked
// repeatedly (and concurrently across distinct Run calls) as long as
// each call gets its own instance — which Run does internally.
type JourneyContext struct {
	values map[string]string
}

func newJourneyContext() *JourneyContext {
	return &JourneyContext{values: make(map[string]string)}
}

// Set stores a value for later steps to read via Get.
func (jc *JourneyContext) Set(key, value string) {
	if jc == nil {
		return
	}
	jc.values[key] = value
}

// Get returns the value previously stored under key, and whether it
// was present.
func (jc *JourneyContext) Get(key string) (string, bool) {
	if jc == nil {
		return "", false
	}
	v, ok := jc.values[key]
	return v, ok
}

// JourneyStepResult captures one step's outcome from the most recent
// journey run. Exposed on Result.Steps by the runner (see runner.go's
// StepReporter interface) so the synthetic-monitoring endpoint can report
// per-stage timing without every probe kind needing its own snapshot endpoint.
type JourneyStepResult struct {
	Name       string `json:"name"`
	OK         bool   `json:"ok"`
	Skipped    bool   `json:"skipped,omitempty"`
	DurationMs int64  `json:"duration_ms"`
	Error      string `json:"error,omitempty"`
}

// JourneyStep is one bounded HTTP call in a multi-step synthetic
// operator journey (e.g. "dashboard/fleet state -> vehicle inspect ->
// battery health -> charging history"). Steps run strictly in order;
// a step may read values an earlier step stored in the JourneyContext
// (typically a vehicle ID) to build its own request.
type JourneyStep struct {
	// Name is the stable, fixed-cardinality label surfaced in
	// JourneyStepResult and Prometheus metrics. Must never be derived
	// from response data (vehicle IDs, VINs, etc.).
	Name string
	// Timeout bounds this step alone. Defaults to 10s when zero. It
	// does not extend the overall per-probe timeout the Runner
	// enforces around the whole journey.
	Timeout time.Duration
	// BuildURL returns the absolute URL to GET for this step. Return
	// ErrSkipStep when the step has nothing to exercise this run
	// (e.g. no vehicle was discovered upstream) — the step is then
	// recorded as skipped rather than failed, and the journey moves
	// on to the next step.
	BuildURL func(baseURL string, jc *JourneyContext) (string, error)
	// OnSuccess runs after a response with an allowed status code. It
	// may parse the body and stash values into jc for later steps.
	// Optional — a nil OnSuccess just checks the status code.
	OnSuccess func(body []byte, jc *JourneyContext) error
	// AllowedStatus lists acceptable HTTP status codes. Empty means
	// "200 only".
	AllowedStatus []int
	// MaxBodyReadKiB caps the response body read passed to OnSuccess.
	// Defaults to 256 KiB when zero.
	MaxBodyReadKiB int
}

// JourneyProbe runs an ordered sequence of bounded HTTP steps modeling
// one operator task end-to-end. It implements synthetic.Probe so it
// can be registered on the same Runner as single-endpoint HTTPProbes.
//
// A step whose BuildURL or request fails aborts the remaining steps
// (later steps are assumed to depend on earlier ones succeeding). A
// step that returns ErrSkipStep is recorded as skipped and does NOT
// abort the journey, since later steps make their own independent
// skip decision from the JourneyContext.
type JourneyProbe struct {
	ProbeName string
	BaseURL   string
	Client    *http.Client
	Steps     []JourneyStep
	headers   http.Header

	// observe, when non-nil, is called once per step with the
	// journey's probe name and that step's result, so the caller can
	// export bounded-cardinality Prometheus metrics (labels: journey
	// name + step name, both fixed vocabularies). Left unset by
	// default so unit tests don't need a metrics registry.
	observe func(journeyName string, step JourneyStepResult)

	mu      sync.RWMutex
	lastRun []JourneyStepResult
}

// NewJourneyProbe wires a journey probe. client defaults to a 10s
// http.Client when nil.
func NewJourneyProbe(name, baseURL string, steps []JourneyStep, client *http.Client) *JourneyProbe {
	if client == nil {
		client = platformhttp.NewClient(platformhttp.ClientConfig{
			Name:    "synthetic-journey",
			Timeout: 10 * time.Second,
		})
	}
	return &JourneyProbe{
		ProbeName: name,
		BaseURL:   strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		Client:    client,
		Steps:     append([]JourneyStep(nil), steps...),
		headers:   make(http.Header),
	}
}

// WithHeader adds a fixed header to every journey request. Configure headers
// before the runner starts; request policy is immutable during active runs.
func (p *JourneyProbe) WithHeader(name, value string) *JourneyProbe {
	if p != nil && name != "" && value != "" {
		p.headers.Set(name, value)
	}
	return p
}

// WithObserver returns p with its step-observation hook set, for
// fluent construction at wiring time (see internal/app/new.go).
func (p *JourneyProbe) WithObserver(observe func(journeyName string, step JourneyStepResult)) *JourneyProbe {
	if p != nil {
		p.observe = observe
	}
	return p
}

// Name returns the probe name surfaced in the runner snapshot + metrics.
func (p *JourneyProbe) Name() string { return p.ProbeName }

// LastStepResults returns a defensive copy of the most recent run's
// per-step results. Safe for concurrent callers.
func (p *JourneyProbe) LastStepResults() []JourneyStepResult {
	if p == nil {
		return nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	out := make([]JourneyStepResult, len(p.lastRun))
	copy(out, p.lastRun)
	return out
}

// Run executes every step in order, stopping at the first step that
// fails outright (as opposed to one that is merely skipped). Returns
// the first such error, wrapped with the step name.
func (p *JourneyProbe) Run(ctx context.Context) error {
	if p == nil {
		return errors.New("nil probe")
	}
	if p.BaseURL == "" {
		return errors.New("empty base url")
	}
	jc := newJourneyContext()
	results := make([]JourneyStepResult, 0, len(p.Steps))
	var firstErr error

	for _, step := range p.Steps {
		res := p.runStep(ctx, step, jc)
		results = append(results, res)
		if p.observe != nil {
			p.observe(p.ProbeName, res)
		}
		if res.Skipped {
			continue
		}
		if res.Error != "" && firstErr == nil {
			firstErr = fmt.Errorf("step %q: %s", step.Name, res.Error)
		}
		if res.Error != "" {
			break
		}
	}

	p.mu.Lock()
	p.lastRun = results
	p.mu.Unlock()
	return firstErr
}

func (p *JourneyProbe) runStep(ctx context.Context, step JourneyStep, jc *JourneyContext) JourneyStepResult {
	res := JourneyStepResult{Name: step.Name}
	start := time.Now()
	if step.BuildURL == nil {
		res.Error = "build url: missing URL builder"
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}

	timeout := step.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	stepCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	url, err := step.BuildURL(p.BaseURL, jc)
	if errors.Is(err, ErrSkipStep) {
		res.Skipped = true
		res.OK = true
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}
	if err != nil {
		res.Error = fmt.Sprintf("build url: %v", err)
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}

	req, err := http.NewRequestWithContext(stepCtx, http.MethodGet, url, nil)
	if err != nil {
		res.Error = fmt.Sprintf("build request: %v", err)
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}
	req.Header.Set("Accept", "application/json")
	for name, values := range p.headers {
		for _, value := range values {
			req.Header.Add(name, value)
		}
	}

	resp, err := p.Client.Do(req)
	if err != nil {
		res.Error = fmt.Sprintf("do: %v", err)
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}
	defer resp.Body.Close()

	allowed := step.AllowedStatus
	if len(allowed) == 0 {
		allowed = []int{http.StatusOK}
	}
	if !statusAllowed(resp.StatusCode, allowed) {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 256*1024))
		res.Error = fmt.Sprintf("unexpected status %d", resp.StatusCode)
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}

	readMax := step.MaxBodyReadKiB
	if readMax <= 0 {
		readMax = 256
	}
	if step.OnSuccess != nil {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, int64(readMax)*1024))
		if readErr != nil {
			res.Error = fmt.Sprintf("read body: %v", readErr)
			res.DurationMs = time.Since(start).Milliseconds()
			return res
		}
		if err := step.OnSuccess(body, jc); err != nil {
			res.Error = fmt.Sprintf("on success: %v", err)
			res.DurationMs = time.Since(start).Milliseconds()
			return res
		}
	} else if _, readErr := io.Copy(io.Discard, io.LimitReader(resp.Body, int64(readMax)*1024)); readErr != nil {
		res.Error = fmt.Sprintf("read body: %v", readErr)
		res.DurationMs = time.Since(start).Milliseconds()
		return res
	}

	res.OK = true
	res.DurationMs = time.Since(start).Milliseconds()
	return res
}

// vehicleIDContextKey is the JourneyContext key the operator-chain
// journey uses to hand a discovered vehicle ID from the fleet-state
// step to the vehicle-inspect/battery/charging-history steps.
const vehicleIDContextKey = "vehicle_id"

// OperatorChainJourneySteps returns the canonical critical-operator
// journey: dashboard/fleet state -> vehicle inspect -> battery health
// -> charging history. It walks the same read path an operator does
// when triaging a fleet from the dashboard, using only endpoints that
// already exist in internal/api/router.go.
//
// The fleet-state step resolves the first vehicle ID it sees; if the
// fleet has zero vehicles the remaining steps are recorded as skipped
// (not failed) rather than treating an empty demo/dev deployment as a
// probe failure.
func OperatorChainJourneySteps() []JourneyStep {
	return []JourneyStep{
		{
			Name:    "fleet_state",
			Timeout: 2 * time.Second,
			BuildURL: func(baseURL string, _ *JourneyContext) (string, error) {
				return baseURL + "/api/v1/vehicles/states?limit=1", nil
			},
			OnSuccess: func(body []byte, jc *JourneyContext) error {
				var envelope struct {
					Data *struct {
						Vehicles *[]struct {
							VehicleID int64 `json:"vehicle_id"`
						} `json:"vehicles"`
					} `json:"data"`
				}
				if err := json.Unmarshal(body, &envelope); err != nil {
					return fmt.Errorf("decode fleet state response: %w", err)
				}
				if envelope.Data == nil || envelope.Data.Vehicles == nil {
					return errors.New("fleet state response missing non-null data.vehicles")
				}
				vehicles := *envelope.Data.Vehicles
				if len(vehicles) > 0 {
					vehicleID := vehicles[0].VehicleID
					if vehicleID <= 0 {
						return errors.New("fleet state response contained an invalid vehicle_id")
					}
					jc.Set(vehicleIDContextKey, strconv.FormatInt(vehicleID, 10))
				}
				return nil
			},
		},
		{
			Name:    "vehicle_inspect",
			Timeout: 2 * time.Second,
			BuildURL: func(baseURL string, jc *JourneyContext) (string, error) {
				id, ok := jc.Get(vehicleIDContextKey)
				if !ok {
					return "", ErrSkipStep
				}
				return baseURL + "/api/v1/vehicles/" + id, nil
			},
		},
		{
			Name:    "battery_health",
			Timeout: 4 * time.Second,
			BuildURL: func(baseURL string, jc *JourneyContext) (string, error) {
				id, ok := jc.Get(vehicleIDContextKey)
				if !ok {
					return "", ErrSkipStep
				}
				return baseURL + "/api/v1/vehicles/" + id + "/battery", nil
			},
		},
		{
			Name:    "charging_history",
			Timeout: 3 * time.Second,
			BuildURL: func(baseURL string, jc *JourneyContext) (string, error) {
				id, ok := jc.Get(vehicleIDContextKey)
				if !ok {
					return "", ErrSkipStep
				}
				return baseURL + "/api/v1/charging?vehicle_id=" + id + "&limit=1", nil
			},
		},
	}
}
