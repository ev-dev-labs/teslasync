// Package synthetic runs read-only outside-in probes against TeslaSync HTTP
// paths. The embedded runner records endpoint and multi-step operator-journey
// results without creating vehicles or mutating fleet data.
package synthetic

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Probe is the interface implemented by each individual canary.
// Implementations MUST be idempotent — the runner may invoke the same
// probe many times per minute and parallel invocations against the
// same canary vehicle are expected.
type Probe interface {
	// Name returns the stable identifier surfaced in Prometheus and
	// the admin observability response. Must match [a-z][a-z0-9_]*.
	Name() string
	// Run executes one probe iteration. Returns nil when the probe
	// succeeded and a wrapped error containing a leaf message
	// describing the failure mode otherwise.
	Run(ctx context.Context) error
}

// Result is the wire shape consumed by /admin/observability/synthetic.
// Holds the most recent outcome of each registered probe.
type Result struct {
	Name        string    `json:"name"`
	LastRunAt   time.Time `json:"last_run_at"`
	LastDurMs   int64     `json:"last_duration_ms"`
	LastError   string    `json:"last_error,omitempty"`
	OK          bool      `json:"ok"`
	Streak      int       `json:"streak"` // consecutive successes (>=0) or failures (<=0)
	TotalRuns   int64     `json:"total_runs"`
	TotalFailed int64     `json:"total_failed"`
	// Steps holds per-stage detail for multi-step probes (e.g.
	// JourneyProbe). Nil for single-endpoint probes such as HTTPProbe.
	Steps []JourneyStepResult `json:"steps,omitempty"`
}

// StepReporter is implemented by probes that expose step-level detail
// from their most recent Run (currently only JourneyProbe). The runner
// surfaces it on Result.Steps so the admin observability endpoint can
// report per-stage timing without every probe kind needing its own
// snapshot endpoint.
type StepReporter interface {
	LastStepResults() []JourneyStepResult
}

// Snapshot is the runner's full state.
type Snapshot struct {
	GeneratedAt time.Time `json:"generated_at"`
	Results     []Result  `json:"results"`
}

// Runner drives a set of probes on a fixed cadence. Construct via
// NewRunner and call Start to begin the ticker loop; Stop blocks
// until the in-flight tick finishes.
type Runner struct {
	mu       sync.Mutex
	probes   []Probe
	results  map[string]*Result
	interval time.Duration
	timeout  time.Duration
	now      func() time.Time

	startOnce sync.Once
	stopOnce  sync.Once
	stopCh    chan struct{}
	doneCh    chan struct{}
}

// NewRunner constructs a runner. Interval is the per-tick cadence;
// timeout bounds each probe invocation so a stuck probe doesn't
// block the next tick.
func NewRunner(probes []Probe, interval, timeout time.Duration) *Runner {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	r := &Runner{
		probes:   probes,
		results:  make(map[string]*Result, len(probes)),
		interval: interval,
		timeout:  timeout,
		now:      time.Now,
		stopCh:   make(chan struct{}),
		doneCh:   make(chan struct{}),
	}
	for _, p := range probes {
		r.results[p.Name()] = &Result{Name: p.Name()}
	}
	return r
}

// Start kicks off the ticker. Returns immediately; the goroutine
// exits when ctx is cancelled or Stop is called.
func (r *Runner) Start(ctx context.Context) {
	r.startOnce.Do(func() {
		go r.loop(ctx)
	})
}

// Stop signals the loop to exit and blocks until it has done so.
// Safe to call more than once or before Start.
func (r *Runner) Stop() {
	r.stopOnce.Do(func() {
		close(r.stopCh)
		r.startOnce.Do(func() {
			close(r.doneCh)
		})
	})
	<-r.doneCh
}

func (r *Runner) loop(ctx context.Context) {
	defer close(r.doneCh)
	// Run once immediately so the first snapshot doesn't show "never run"
	// for every probe.
	r.runAll(ctx)
	ticker := time.NewTicker(r.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.stopCh:
			return
		case <-ticker.C:
			r.runAll(ctx)
		}
	}
}

func (r *Runner) runAll(ctx context.Context) {
	for _, p := range r.probes {
		r.runOne(ctx, p)
	}
}

func (r *Runner) runOne(ctx context.Context, p Probe) {
	pctx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	start := r.now()
	err := p.Run(pctx)
	dur := r.now().Sub(start)

	r.mu.Lock()
	defer r.mu.Unlock()
	res := r.results[p.Name()]
	if res == nil {
		res = &Result{Name: p.Name()}
		r.results[p.Name()] = res
	}
	res.LastRunAt = r.now()
	res.LastDurMs = dur.Milliseconds()
	res.TotalRuns++
	if sr, ok := p.(StepReporter); ok {
		res.Steps = sr.LastStepResults()
	}
	if err != nil {
		res.OK = false
		res.LastError = err.Error()
		res.TotalFailed++
		if res.Streak > 0 {
			res.Streak = -1
		} else {
			res.Streak--
		}
		return
	}
	res.OK = true
	res.LastError = ""
	if res.Streak < 0 {
		res.Streak = 1
	} else {
		res.Streak++
	}
}

// Snapshot returns the current per-probe state. Safe for concurrent
// callers — copies the underlying map before returning.
func (r *Runner) Snapshot() Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := Snapshot{GeneratedAt: r.now(), Results: make([]Result, 0, len(r.results))}
	for _, res := range r.results {
		result := *res
		result.Steps = append([]JourneyStepResult(nil), res.Steps...)
		out.Results = append(out.Results, result)
	}
	return out
}

// HealthCheckProbe is a built-in probe that asserts an HTTP endpoint
// returns 2xx within the timeout. Useful for probing /healthz,
// /readyz, and any other lightweight liveness surface.
type HealthCheckProbe struct {
	ProbeName string
	URL       string
	Client    interface {
		Do(req any) (any, error)
	}
}

// Name returns the probe name.
func (p *HealthCheckProbe) Name() string { return p.ProbeName }

// Run is a stub — concrete HTTP wiring lives in the runner
// constructor that the API server uses (probe_http.go). Keeping this
// interface trivial avoids dragging net/http into a package that
// many tests want to vendor without TLS roots.
func (p *HealthCheckProbe) Run(_ context.Context) error {
	if p == nil {
		return errors.New("nil probe")
	}
	return fmt.Errorf("HealthCheckProbe.Run is a stub; use synthetic.NewHTTPProbe instead")
}
