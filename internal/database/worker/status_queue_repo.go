// Package database provides per-worker queue counters and recent-job
// listings consumed by
// /system/queues. The aggregator queries the existing job tables —
// notification_logs, export_jobs, automation_history — without
// requiring schema changes.
//
// Counter semantics (consistent across workers):
//
//   - Pending             — job sits in queue, no worker has claimed
//                           it yet.
//   - InProgress          — a worker has claimed and is actively
//                           processing.
//   - Succeeded24h        — completed-OK rows in the last 24h.
//   - Failed24h           — failed/error rows in the last 24h.
//   - OldestPendingAgeSec — wall-clock seconds since the oldest
//                           pending row was created. Zero means no
//                           pending rows.
//
// Per-worker status mapping:
//
//   notification (notification_logs)
//     pending      = status='pending'
//     in_progress  = status='deferred_dnd'  (held until quiet-hours
//                                           window closes)
//     succeeded_24h = status='sent'   AND created_at > now()-24h
//     failed_24h    = status='failed' AND created_at > now()-24h
//
//   export (export_jobs)
//     pending      = status='queued'
//     in_progress  = status='processing'
//     succeeded_24h = status='ready'  AND created_at > now()-24h
//     failed_24h    = status='failed' AND created_at > now()-24h
//
//   automation (automation_history)
//     pending      = (none — no queue model)
//     in_progress  = status='running'
//     succeeded_24h = status='success' AND triggered_at > now()-24h
//     failed_24h    = status IN ('failed','partial')
//                     AND triggered_at > now()-24h
//
// All queries hit indexes that already exist in migration 000005,
// 000013, and 000109; no new indexes are required.

package worker

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ErrUnknownQueueWorker is returned when callers ask for counters or
// jobs for a worker name the aggregator doesn't know about.
var ErrUnknownQueueWorker = errors.New("unknown queue worker")

// QueueCounters captures the at-a-glance numbers shown on a worker
// card. Fields are intentionally typed wide enough (int64) for
// long-lived deployments where 24h "succeeded" can climb into the
// hundreds of thousands for high-churn fleets.
type QueueCounters struct {
	Pending                int64
	InProgress             int64
	Succeeded24h           int64
	Failed24h              int64
	OldestPendingAgeSecond int64
}

// QueueJob is the uniform shape returned by RecentJobs across all
// three workers. The string ID accommodates export_jobs (TEXT PK)
// alongside the BIGSERIAL automation_history / notification_logs
// without forcing the SPA to branch on type.
type QueueJob struct {
	ID         string
	Worker     string
	Status     string
	Title      string
	StartedAt  time.Time
	FinishedAt *time.Time
	DurationMs *int64
	Error      string
}

// WorkerQueueRepo is the read-side aggregator. Constructed once at
// router init time and shared across requests.
//
// It holds a database.DBTX execution seam (satisfied by *pgxpool.Pool
// in production) rather than the concrete *database.DB so the per-worker
// queries can be exercised against an in-package fake without a live
// PostgreSQL — the same approach used by internal/database/observability
// and internal/database/audit.
type WorkerQueueRepo struct {
	exec database.DBTX
}

// NewWorkerQueueRepo constructs the aggregator from the shared pool. A
// nil db (or nil pool) yields a repo whose query methods will fail fast
// on first use rather than at construction, mirroring the other adapter
// repos in this layer.
func NewWorkerQueueRepo(db *database.DB) *WorkerQueueRepo {
	var exec database.DBTX
	if db != nil && db.Pool != nil {
		exec = db.Pool
	}
	return &WorkerQueueRepo{exec: exec}
}

// Counters dispatches to the per-worker query. Returns
// ErrUnknownQueueWorker for names the aggregator doesn't ship a
// query for so the handler can map cleanly to a 404.
func (r *WorkerQueueRepo) Counters(ctx context.Context, worker string) (QueueCounters, error) {
	switch worker {
	case WorkerNameNotification:
		return r.notificationCounters(ctx)
	case WorkerNameExport:
		return r.exportCounters(ctx)
	case WorkerNameAutomation:
		return r.automationCounters(ctx)
	default:
		return QueueCounters{}, fmt.Errorf("worker_queue counters %q: %w", worker, ErrUnknownQueueWorker)
	}
}

// RecentJobs dispatches to the per-worker query for the drawer.
// limit is clamped server-side at 200 to keep the response bounded
// even if the SPA forgets to paginate.
func (r *WorkerQueueRepo) RecentJobs(ctx context.Context, worker string, limit int) ([]QueueJob, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	switch worker {
	case WorkerNameNotification:
		return r.notificationRecent(ctx, limit)
	case WorkerNameExport:
		return r.exportRecent(ctx, limit)
	case WorkerNameAutomation:
		return r.automationRecent(ctx, limit)
	default:
		return nil, fmt.Errorf("worker_queue recent %q: %w", worker, ErrUnknownQueueWorker)
	}
}

// ─── notification ──────────────────────────────────────────────────

func (r *WorkerQueueRepo) notificationCounters(ctx context.Context) (QueueCounters, error) {
	const q = `
SELECT
  COALESCE(SUM(CASE WHEN status = 'pending'                                 THEN 1 ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN status = 'deferred_dnd'                            THEN 1 ELSE 0 END), 0) AS in_progress,
  COALESCE(SUM(CASE WHEN status = 'sent'   AND created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) AS succeeded_24h,
  COALESCE(SUM(CASE WHEN status = 'failed' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) AS failed_24h,
  COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(CASE WHEN status = 'pending' THEN created_at END)))::BIGINT, 0) AS oldest_pending_age
FROM notification_logs`
	var c QueueCounters
	if err := r.exec.QueryRow(ctx, q).Scan(
		&c.Pending, &c.InProgress, &c.Succeeded24h, &c.Failed24h, &c.OldestPendingAgeSecond,
	); err != nil {
		return QueueCounters{}, fmt.Errorf("worker_queue notification counters: %w", err)
	}
	return c, nil
}

func (r *WorkerQueueRepo) notificationRecent(ctx context.Context, limit int) ([]QueueJob, error) {
	const q = `
SELECT id::TEXT, status, COALESCE(title, ''), created_at, sent_at, COALESCE(error, '')
FROM notification_logs
ORDER BY created_at DESC
LIMIT $1`
	rows, err := r.exec.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("worker_queue notification recent: %w", err)
	}
	defer rows.Close()
	out := make([]QueueJob, 0, limit)
	for rows.Next() {
		var (
			job        QueueJob
			finishedAt *time.Time
		)
		if err := rows.Scan(&job.ID, &job.Status, &job.Title, &job.StartedAt, &finishedAt, &job.Error); err != nil {
			return nil, fmt.Errorf("worker_queue notification scan: %w", err)
		}
		job.Worker = WorkerNameNotification
		if finishedAt != nil {
			t := *finishedAt
			job.FinishedAt = &t
			d := t.Sub(job.StartedAt).Milliseconds()
			job.DurationMs = &d
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

// ─── export ────────────────────────────────────────────────────────

func (r *WorkerQueueRepo) exportCounters(ctx context.Context) (QueueCounters, error) {
	const q = `
SELECT
  COALESCE(SUM(CASE WHEN status = 'queued'                                  THEN 1 ELSE 0 END), 0) AS pending,
  COALESCE(SUM(CASE WHEN status = 'processing'                              THEN 1 ELSE 0 END), 0) AS in_progress,
  COALESCE(SUM(CASE WHEN status = 'ready'  AND created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) AS succeeded_24h,
  COALESCE(SUM(CASE WHEN status = 'failed' AND created_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) AS failed_24h,
  COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(CASE WHEN status = 'queued' THEN created_at END)))::BIGINT, 0) AS oldest_pending_age
FROM export_jobs`
	var c QueueCounters
	if err := r.exec.QueryRow(ctx, q).Scan(
		&c.Pending, &c.InProgress, &c.Succeeded24h, &c.Failed24h, &c.OldestPendingAgeSecond,
	); err != nil {
		return QueueCounters{}, fmt.Errorf("worker_queue export counters: %w", err)
	}
	return c, nil
}

func (r *WorkerQueueRepo) exportRecent(ctx context.Context, limit int) ([]QueueJob, error) {
	const q = `
SELECT id, status, COALESCE(type, ''), created_at, completed_at, COALESCE(error_message, '')
FROM export_jobs
ORDER BY created_at DESC
LIMIT $1`
	rows, err := r.exec.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("worker_queue export recent: %w", err)
	}
	defer rows.Close()
	out := make([]QueueJob, 0, limit)
	for rows.Next() {
		var (
			job         QueueJob
			completedAt *time.Time
		)
		if err := rows.Scan(&job.ID, &job.Status, &job.Title, &job.StartedAt, &completedAt, &job.Error); err != nil {
			return nil, fmt.Errorf("worker_queue export scan: %w", err)
		}
		job.Worker = WorkerNameExport
		if completedAt != nil {
			t := *completedAt
			job.FinishedAt = &t
			d := t.Sub(job.StartedAt).Milliseconds()
			job.DurationMs = &d
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

// ─── automation ────────────────────────────────────────────────────

func (r *WorkerQueueRepo) automationCounters(ctx context.Context) (QueueCounters, error) {
	const q = `
SELECT
  COALESCE(SUM(CASE WHEN status = 'running'                                       THEN 1 ELSE 0 END), 0) AS in_progress,
  COALESCE(SUM(CASE WHEN status = 'success' AND triggered_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) AS succeeded_24h,
  COALESCE(SUM(CASE WHEN status IN ('failed','partial') AND triggered_at > NOW() - INTERVAL '24 hours' THEN 1 ELSE 0 END), 0) AS failed_24h,
  COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(CASE WHEN status = 'running' THEN triggered_at END)))::BIGINT, 0) AS oldest_running_age
FROM automation_history`
	var c QueueCounters
	if err := r.exec.QueryRow(ctx, q).Scan(
		&c.InProgress, &c.Succeeded24h, &c.Failed24h, &c.OldestPendingAgeSecond,
	); err != nil {
		return QueueCounters{}, fmt.Errorf("worker_queue automation counters: %w", err)
	}
	// Automations have no "queued" state — what looks like
	// pending in the SPA is actually long-running executions.
	return c, nil
}

func (r *WorkerQueueRepo) automationRecent(ctx context.Context, limit int) ([]QueueJob, error) {
	const q = `
SELECT id::TEXT, status, COALESCE(automation_name, ''), triggered_at, completed_at, duration_ms, COALESCE(error, '')
FROM automation_history
ORDER BY triggered_at DESC
LIMIT $1`
	rows, err := r.exec.Query(ctx, q, limit)
	if err != nil {
		return nil, fmt.Errorf("worker_queue automation recent: %w", err)
	}
	defer rows.Close()
	out := make([]QueueJob, 0, limit)
	for rows.Next() {
		var (
			job         QueueJob
			completedAt *time.Time
			durationMs  *int64
		)
		if err := rows.Scan(&job.ID, &job.Status, &job.Title, &job.StartedAt, &completedAt, &durationMs, &job.Error); err != nil {
			return nil, fmt.Errorf("worker_queue automation scan: %w", err)
		}
		job.Worker = WorkerNameAutomation
		if completedAt != nil {
			t := *completedAt
			job.FinishedAt = &t
		}
		if durationMs != nil {
			v := *durationMs
			job.DurationMs = &v
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

// ─── helpers ───────────────────────────────────────────────────────
//
// pgx already maps NULL TIMESTAMPTZ → *time.Time and NULL INTEGER →
// *int64 when the destination is a pointer. The Recent* functions
// above use those pointer types directly so no custom scanners are
// needed here.
