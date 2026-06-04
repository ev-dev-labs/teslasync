// Package worker provides the periodic heartbeat writer that every long-running worker
// process (notification, export, automation) is expected to start in
// its main(). The heartbeater records process liveness via the
// shared [workerdb.WorkerStatusStore] so the API server's
// /system/queues panel can show operators "is this worker actually
// running and responsive?".
//
// Design constraints:
//
//   - The heartbeater MUST NOT block forever on a stuck Redis. Each
//     RecordHeartbeat call inherits a per-tick context with a hard
//     timeout (defaults to half the interval) so a flaky cache
//     can't wedge the worker process.
//   - Failures to record are logged at debug level only — they
//     should NEVER take the worker down. The worker_status panel
//     surfacing "no heartbeat" is the recovery surface, not log
//     noise.
//   - Start blocks the caller goroutine until ctx is done. That's
//     deliberate so callers can compose it with errgroup, sync.WaitGroup,
//     or just `go h.Start(ctx)` patterns interchangeably.
//   - The first heartbeat fires immediately on Start so a freshly
//     deployed worker registers itself before the first tick.
package worker

import (
	"context"
	"os"
	"time"

	"github.com/rs/zerolog/log"

	workerdb "github.com/ev-dev-labs/teslasync/internal/database/worker"
)

// DefaultHeartbeatInterval is the cadence the API server's
// /system/queues panel is calibrated against. Any longer than 60s
// and a freshly-deployed worker can briefly appear "stale"; any
// shorter and we waste Redis traffic.
const DefaultHeartbeatInterval = 30 * time.Second

// HeartbeaterOptions carry the construction-time configuration. All
// fields have sensible defaults — leave them at the zero value for
// the production wire-up.
type HeartbeaterOptions struct {
	// Worker is the canonical worker name. Required. Use one of
	// database.WorkerName{Notification,Export,Automation}.
	Worker string
	// Version is the binary version stamped onto each heartbeat
	// document so operators can spot mixed-version deployments.
	// Optional.
	Version string
	// Interval overrides DefaultHeartbeatInterval. Must be > 0
	// when supplied; values <= 0 fall back to the default.
	Interval time.Duration
	// WriteTimeout caps how long a single RecordHeartbeat call is
	// allowed to take. Defaults to half the interval.
	WriteTimeout time.Duration
	// Now overrides the clock for tests. Defaults to time.Now.
	Now func() time.Time
	// Hostname overrides the OS hostname reported in the
	// heartbeat. Defaults to os.Hostname().
	Hostname string
}

// Heartbeater periodically writes the calling worker's heartbeat to
// the shared store.
type Heartbeater struct {
	store        workerdb.WorkerStatusStore
	worker       string
	version      string
	interval     time.Duration
	writeTimeout time.Duration
	now          func() time.Time
	hostname     string
	pid          int
}

// NewHeartbeater constructs the writer. Returns nil when store is
// nil or opts.Worker is empty — both indicate a wire-up bug, and
// returning nil lets callers no-op gracefully (the production code
// path tests `if hb != nil { go hb.Start(ctx) }`).
func NewHeartbeater(store workerdb.WorkerStatusStore, opts HeartbeaterOptions) *Heartbeater {
	if store == nil || opts.Worker == "" {
		return nil
	}
	interval := opts.Interval
	if interval <= 0 {
		interval = DefaultHeartbeatInterval
	}
	writeTimeout := opts.WriteTimeout
	if writeTimeout <= 0 {
		writeTimeout = interval / 2
		if writeTimeout <= 0 {
			writeTimeout = 5 * time.Second
		}
	}
	nowFn := opts.Now
	if nowFn == nil {
		nowFn = func() time.Time { return time.Now().UTC() }
	}
	host := opts.Hostname
	if host == "" {
		host, _ = os.Hostname()
	}
	return &Heartbeater{
		store:        store,
		worker:       opts.Worker,
		version:      opts.Version,
		interval:     interval,
		writeTimeout: writeTimeout,
		now:          nowFn,
		hostname:     host,
		pid:          os.Getpid(),
	}
}

// Start blocks until ctx is done, writing one heartbeat immediately
// and then on every tick. Errors are logged but never returned —
// the heartbeat path must not impact worker availability.
func (h *Heartbeater) Start(ctx context.Context) {
	if h == nil {
		return
	}
	startedAt := h.now()
	h.write(ctx, startedAt)
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			h.write(ctx, startedAt)
		}
	}
}

// write performs a single bounded RecordHeartbeat. Exposed (lower-case
// but reachable from the test file) so unit tests can drive a single
// tick deterministically without spinning the ticker.
func (h *Heartbeater) write(ctx context.Context, startedAt time.Time) {
	if h == nil {
		return
	}
	tickCtx, cancel := context.WithTimeout(ctx, h.writeTimeout)
	defer cancel()
	hb := workerdb.WorkerHeartbeat{
		Worker:          h.worker,
		Host:            h.hostname,
		PID:             h.pid,
		Version:         h.version,
		StartedAt:       startedAt,
		LastHeartbeatAt: h.now(),
	}
	if err := h.store.RecordHeartbeat(tickCtx, hb); err != nil {
		log.Debug().Err(err).Str("worker", h.worker).Msg("heartbeat: record failed")
	}
}
