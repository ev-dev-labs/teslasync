// Phase-46 / Prompt 65 — Scheduled / recurring export driver.
//
// The Scheduler is a side-car to the existing MQTT-backed export
// Worker. Every tick (default 60 s) it asks the repo for rows where
// `enabled AND next_run_at <= now()`, then for each row:
//
//   1. Builds a one-shot JobRequest from the schedule's parameters
//      and a relative date window (range_window).
//   2. Hands it straight to *Processor.Process — the same code path
//      that one-shot HTTP submissions use.
//   3. Dispatches the produced bytes via Delivery.kind (download is
//      stored on the row; email/webhook log + reserve a hook for
//      future Phase-46 prompts).
//   4. Records last_run_at / last_status / last_error and recomputes
//      next_run_at via cron.
//
// Per-row try / catch
// -------------------
// A failed row MUST NOT block its siblings. processOne() captures
// any panic and converts it to last_status='failed'. Tick() never
// returns mid-batch on row failure.
//
// Cancellation
// ------------
// Start(ctx) honours ctx.Done() — the ticker is stopped and the
// in-flight tick is awaited before returning. Long-running
// processor work runs under the same ctx, so a graceful shutdown
// will short-circuit the SQL and the file-bytes generation alike.
//
// Distribution
// ------------
// The repo's DueBefore intentionally does NOT take a row-level
// lock. In multi-replica deployments, two pods could pick the
// same row simultaneously. That is acceptable today because:
//   - Delivery is idempotent at the user level (duplicate download
//     entries / email / webhook are visible-but-harmless).
//   - MarkRunResult advances next_run_at past the cutoff, so the
//     second pod's update finds last_run_at already past now() and
//     becomes a no-op.
// A future "FOR UPDATE SKIP LOCKED" upgrade can land cleanly here
// without changing the public scheduler surface.
package export

import (
	"context"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// DefaultSchedulerInterval is the production tick cadence. Tests
// pass shorter intervals through SchedulerOptions.
const DefaultSchedulerInterval = 60 * time.Second

// SchedulerStore is the slice of *database.ScheduledExportRepo the
// scheduler needs. Production wires the concrete repo; tests stub.
type SchedulerStore interface {
	DueBefore(ctx context.Context, cutoff time.Time, limit int) ([]database.ScheduledExportRow, error)
	MarkRunResult(ctx context.Context, id int64, outcome database.ScheduledExportRunOutcome) error
}

// SchedulerProcessor is the slice of *Processor the scheduler uses.
// Wraps *Processor.Process so tests don't need a full DB.
type SchedulerProcessor interface {
	Process(ctx context.Context, req *JobRequest) (*ProcessResult, error)
}

// SchedulerDelivery dispatches a finished export to the user-chosen
// destination. Returning an error marks the row as failed.
//
// Implementations are expected to be best-effort + log-on-failure;
// they should NOT block the scheduler tick. Use the ctx for
// cancellation.
type SchedulerDelivery interface {
	Deliver(ctx context.Context, row database.ScheduledExportRow, result *ProcessResult) error
}

// SchedulerOptions tunes the scheduler. Zero-valued fields fall
// back to production defaults.
type SchedulerOptions struct {
	// Interval between ticks. Defaults to DefaultSchedulerInterval.
	Interval time.Duration
	// MaxBatch caps how many due rows are processed per tick. The
	// repo's DueBefore enforces the SQL LIMIT; this is purely a
	// belt-and-braces guard. Defaults to 64.
	MaxBatch int
	// PerRowTimeout caps how long a single row may take. Defaults
	// to 5 minutes — long enough for an account export, short
	// enough that one runaway row can't starve the next tick.
	PerRowTimeout time.Duration
	// Now is the wall-clock source. Defaults to time.Now().UTC.
	Now func() time.Time
}

// Scheduler is the long-running driver that fires due schedules.
type Scheduler struct {
	store    SchedulerStore
	proc     SchedulerProcessor
	delivery SchedulerDelivery
	opts     SchedulerOptions

	// done is closed when Start exits.
	done chan struct{}
	once sync.Once
}

// NewScheduler wires a scheduler. delivery may be nil — a no-op
// dispatcher is used (download-only mode).
func NewScheduler(store SchedulerStore, proc SchedulerProcessor, delivery SchedulerDelivery, opts SchedulerOptions) *Scheduler {
	if opts.Interval <= 0 {
		opts.Interval = DefaultSchedulerInterval
	}
	if opts.MaxBatch <= 0 {
		opts.MaxBatch = 64
	}
	if opts.PerRowTimeout <= 0 {
		opts.PerRowTimeout = 5 * time.Minute
	}
	if opts.Now == nil {
		opts.Now = func() time.Time { return time.Now().UTC() }
	}
	if delivery == nil {
		delivery = noopDelivery{}
	}
	return &Scheduler{
		store:    store,
		proc:     proc,
		delivery: delivery,
		opts:     opts,
		done:     make(chan struct{}),
	}
}

// Start runs the scheduler tick loop until ctx is cancelled. Safe
// to call once per Scheduler instance. Returns nil when ctx is
// done. Designed to be called via `go scheduler.Start(ctx)`.
func (s *Scheduler) Start(ctx context.Context) error {
	if s == nil {
		return nil
	}
	defer s.once.Do(func() { close(s.done) })
	if s.store == nil || s.proc == nil {
		log.Warn().Msg("export scheduler: missing store or processor; not starting")
		return nil
	}

	ticker := time.NewTicker(s.opts.Interval)
	defer ticker.Stop()

	// Fire one tick immediately so a freshly enqueued row that is
	// already due does not have to wait a full interval.
	s.Tick(ctx)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			s.Tick(ctx)
		}
	}
}

// Done closes when Start exits — convenient for shutdown plumbing.
func (s *Scheduler) Done() <-chan struct{} { return s.done }

// Tick runs a single scheduling pass. Exposed for tests + a future
// admin "Run scheduler now" endpoint. Returns the number of rows
// processed (success + failure).
func (s *Scheduler) Tick(ctx context.Context) int {
	if s == nil || s.store == nil || s.proc == nil {
		return 0
	}
	now := s.opts.Now()
	rows, err := s.store.DueBefore(ctx, now, s.opts.MaxBatch)
	if err != nil {
		log.Error().Err(err).Msg("export scheduler: DueBefore failed")
		return 0
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return 0
		}
		s.processOne(ctx, row)
	}
	return len(rows)
}

// processOne runs a single schedule. A failed row records
// last_status='failed' + last_error; a panic is recovered and
// converted to a failure so a poison-pill row can never crash the
// scheduler.
func (s *Scheduler) processOne(ctx context.Context, row database.ScheduledExportRow) {
	defer func() {
		if rec := recover(); rec != nil {
			log.Error().
				Int64("schedule_id", row.ID).
				Interface("panic", rec).
				Bytes("stack", debug.Stack()).
				Msg("export scheduler: panic in row processing")
			s.recordOutcome(ctx, row, scheduledStatusFailed, fmt.Sprintf("panic: %v", rec))
		}
	}()

	rowCtx, cancel := context.WithTimeout(ctx, s.opts.PerRowTimeout)
	defer cancel()

	now := s.opts.Now()
	jobReq, err := buildJobRequest(row, now)
	if err != nil {
		log.Warn().Err(err).Int64("schedule_id", row.ID).Msg("export scheduler: invalid schedule")
		s.recordOutcome(ctx, row, scheduledStatusFailed, err.Error())
		return
	}

	result, err := s.proc.Process(rowCtx, jobReq)
	if err != nil {
		log.Warn().Err(err).Int64("schedule_id", row.ID).Msg("export scheduler: processor failed")
		s.recordOutcome(ctx, row, scheduledStatusFailed, err.Error())
		return
	}

	if err := s.delivery.Deliver(rowCtx, row, result); err != nil {
		log.Warn().Err(err).Int64("schedule_id", row.ID).Str("kind", string(row.Delivery.Kind)).Msg("export scheduler: delivery failed")
		s.recordOutcome(ctx, row, scheduledStatusFailed, err.Error())
		return
	}

	s.recordOutcome(ctx, row, scheduledStatusOK, "")
}

// scheduledStatusOK / scheduledStatusFailed mirror the literals
// MarkRunResult validates against. Constants here keep the
// scheduler implementation independent of any package-level rename.
const (
	scheduledStatusOK     = "ok"
	scheduledStatusFailed = "failed"
)

func (s *Scheduler) recordOutcome(ctx context.Context, row database.ScheduledExportRow, status, errMsg string) {
	now := s.opts.Now()
	var nextPtr *time.Time
	if next, nextErr := database.ComputeNextRun(row.ScheduleCron, now); nextErr == nil {
		n := next
		nextPtr = &n
	} else {
		// The cron parser already accepted this expression at write
		// time, but log the regression and keep the run anyway —
		// next_run_at will simply stay unchanged.
		log.Warn().Err(nextErr).Int64("schedule_id", row.ID).Msg("export scheduler: ComputeNextRun failed")
	}
	outcome := database.ScheduledExportRunOutcome{
		RanAt:     now,
		Status:    status,
		Err:       errMsg,
		NextRunAt: nextPtr,
	}
	if err := s.store.MarkRunResult(ctx, row.ID, outcome); err != nil {
		log.Warn().Err(err).Int64("schedule_id", row.ID).Msg("export scheduler: MarkRunResult failed")
	}
}

// buildJobRequest assembles a one-shot export job description from
// a schedule row. The relative range_window is anchored at now so
// every run produces a fresh window (e.g. "last 7d").
func buildJobRequest(row database.ScheduledExportRow, now time.Time) (*JobRequest, error) {
	window, err := database.ParseRangeWindow(row.RangeWindow)
	if err != nil {
		return nil, fmt.Errorf("range_window: %w", err)
	}
	end := now
	start := now.Add(-window)
	req := &JobRequest{
		ExportJobRequest: models.ExportJobRequest{
			// Synthesise a stable job-id so log lines can correlate
			// per-tick output with the parent schedule.
			JobID:     fmt.Sprintf("scheduled-%d-%d", row.ID, now.Unix()),
			Type:      row.ExportType,
			Format:    row.Format,
			VehicleID: row.VehicleID,
			StartDate: &start,
			EndDate:   &end,
		},
		Columns: row.Columns,
	}
	return req, nil
}

// noopDelivery is the fallback when no delivery dispatcher is
// wired (download-only mode).
type noopDelivery struct{}

func (noopDelivery) Deliver(_ context.Context, _ database.ScheduledExportRow, _ *ProcessResult) error {
	return nil
}

// LogDelivery is a development-friendly delivery that emits a log
// line per dispatched payload. Intended as the default wiring while
// real email + webhook drivers are scaffolded by future prompts.
type LogDelivery struct{}

// Deliver records the schedule + size and returns nil. Production
// integrations should replace this with real transports.
func (LogDelivery) Deliver(_ context.Context, row database.ScheduledExportRow, result *ProcessResult) error {
	size := 0
	records := 0
	if result != nil {
		size = len(result.Data)
		records = result.RecordCount
	}
	log.Info().
		Int64("schedule_id", row.ID).
		Str("name", row.Name).
		Str("delivery_kind", string(row.Delivery.Kind)).
		Str("delivery_target", row.Delivery.Target).
		Int("bytes", size).
		Int("records", records).
		Msg("scheduled export delivered (log delivery)")
	return nil
}
