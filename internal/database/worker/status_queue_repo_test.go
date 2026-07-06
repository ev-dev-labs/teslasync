package worker

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// errBoom is a reusable sentinel so error-path assertions can use errors.Is
// through the fmt.Errorf("...: %w", err) wrapping the repo applies.
var errBoom = errors.New("boom")

// newQueueRepo wires a WorkerQueueRepo onto a fresh recording fake. The
// exec field is unexported, so constructing the struct literal directly (in
// the same package) is the seam the production NewWorkerQueueRepo uses too.
func newQueueRepo() (*WorkerQueueRepo, *fakeDBTX) {
	f := &fakeDBTX{}
	return &WorkerQueueRepo{exec: f}, f
}

var (
	tStart    = time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	tFinish   = tStart.Add(1500 * time.Millisecond)
	tFinishMs = int64(1500)
)

// ─── constructor ───────────────────────────────────────────────────

func TestNewWorkerQueueRepo(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		db      *database.DB
		wantNil bool // whether the exec seam should end up nil
	}{
		{"nil db", nil, true},
		{"db with nil pool", &database.DB{}, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r := NewWorkerQueueRepo(tt.db)
			if r == nil {
				t.Fatal("NewWorkerQueueRepo returned nil repo")
			}
			if (r.exec == nil) != tt.wantNil {
				t.Errorf("exec nil = %v, want %v", r.exec == nil, tt.wantNil)
			}
		})
	}
}

// ─── Counters ──────────────────────────────────────────────────────

func TestCounters(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		worker    string
		row       *fakeRow // canned QueryRow result; nil means "no row expected"
		want      QueueCounters
		wantErrIs error
		wantTable string // substring expected in the issued SQL
	}{
		{
			name:      "notification",
			worker:    WorkerNameNotification,
			row:       rowWith(int64(3), int64(1), int64(10), int64(2), int64(45)),
			want:      QueueCounters{Pending: 3, InProgress: 1, Succeeded24h: 10, Failed24h: 2, OldestPendingAgeSecond: 45},
			wantTable: "notification_logs",
		},
		{
			name:      "export",
			worker:    WorkerNameExport,
			row:       rowWith(int64(5), int64(2), int64(20), int64(0), int64(120)),
			want:      QueueCounters{Pending: 5, InProgress: 2, Succeeded24h: 20, Failed24h: 0, OldestPendingAgeSecond: 120},
			wantTable: "export_jobs",
		},
		{
			name:   "automation has no pending column",
			worker: WorkerNameAutomation,
			// automationCounters scans only 4 columns (no pending).
			row:       rowWith(int64(4), int64(30), int64(1), int64(600)),
			want:      QueueCounters{Pending: 0, InProgress: 4, Succeeded24h: 30, Failed24h: 1, OldestPendingAgeSecond: 600},
			wantTable: "automation_history",
		},
		{
			name:      "unknown worker",
			worker:    "gremlin",
			wantErrIs: ErrUnknownQueueWorker,
		},
		{
			name:      "empty worker name",
			worker:    "",
			wantErrIs: ErrUnknownQueueWorker,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r, f := newQueueRepo()
			if tt.row != nil {
				f.pushRow(tt.row)
			}
			got, err := r.Counters(context.Background(), tt.worker)

			if tt.wantErrIs != nil {
				if !errors.Is(err, tt.wantErrIs) {
					t.Fatalf("Counters err = %v, want Is %v", err, tt.wantErrIs)
				}
				if got != (QueueCounters{}) {
					t.Errorf("on error, counters = %+v, want zero value", got)
				}
				// Unknown workers must short-circuit before hitting the DB.
				if len(f.rowCalls) != 0 {
					t.Errorf("unknown worker issued %d queries, want 0", len(f.rowCalls))
				}
				return
			}
			if err != nil {
				t.Fatalf("Counters(%q) unexpected err = %v", tt.worker, err)
			}
			if got != tt.want {
				t.Errorf("Counters(%q) = %+v, want %+v", tt.worker, got, tt.want)
			}
			if sql := f.lastRow().SQL; !contains(sql, tt.wantTable) {
				t.Errorf("SQL missing table %q:\n%s", tt.wantTable, sql)
			}
		})
	}
}

func TestCounters_ScanError(t *testing.T) {
	t.Parallel()
	for _, worker := range KnownWorkerNames {
		worker := worker
		t.Run(worker, func(t *testing.T) {
			t.Parallel()
			r, f := newQueueRepo()
			f.pushRow(rowErr(errBoom))
			got, err := r.Counters(context.Background(), worker)
			if !errors.Is(err, errBoom) {
				t.Fatalf("Counters err = %v, want Is errBoom", err)
			}
			if got != (QueueCounters{}) {
				t.Errorf("counters = %+v, want zero value on scan error", got)
			}
		})
	}
}

// ─── RecentJobs: limit clamping ────────────────────────────────────

func TestRecentJobs_LimitClamp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		in    int
		wantN int64
	}{
		{"zero defaults to 20", 0, 20},
		{"negative defaults to 20", -7, 20},
		{"one is honoured", 1, 1},
		{"mid-range is honoured", 50, 50},
		{"upper bound honoured", 200, 200},
		{"over cap clamps to 200", 250, 200},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r, f := newQueueRepo()
			f.pushQuery(rowsFrom(), nil) // empty result set
			if _, err := r.RecentJobs(context.Background(), WorkerNameNotification, tt.in); err != nil {
				t.Fatalf("RecentJobs err = %v", err)
			}
			args := f.lastQuery().Args
			if len(args) != 1 {
				t.Fatalf("expected 1 query arg (limit), got %d", len(args))
			}
			got, ok := args[0].(int)
			if !ok {
				t.Fatalf("limit arg type = %T, want int", args[0])
			}
			if int64(got) != tt.wantN {
				t.Errorf("clamped limit = %d, want %d", got, tt.wantN)
			}
		})
	}
}

func TestRecentJobs_UnknownWorker(t *testing.T) {
	t.Parallel()
	r, f := newQueueRepo()
	got, err := r.RecentJobs(context.Background(), "gremlin", 10)
	if !errors.Is(err, ErrUnknownQueueWorker) {
		t.Fatalf("err = %v, want Is ErrUnknownQueueWorker", err)
	}
	if got != nil {
		t.Errorf("jobs = %v, want nil on unknown worker", got)
	}
	if len(f.queryCalls) != 0 {
		t.Errorf("unknown worker issued %d queries, want 0", len(f.queryCalls))
	}
}

// ─── RecentJobs: per-worker mapping ────────────────────────────────

func TestNotificationRecent(t *testing.T) {
	t.Parallel()
	r, f := newQueueRepo()
	f.pushQuery(rowsFrom(
		// finished job: sent_at present -> DurationMs computed
		scanRow("42", "sent", "Charge complete", tStart, ptr(tFinish), ""),
		// pending job: sent_at NULL -> no FinishedAt / DurationMs; error carried
		scanRow("43", "failed", "Low battery", tStart, nil, "smtp timeout"),
	), nil)

	jobs, err := r.RecentJobs(context.Background(), WorkerNameNotification, 10)
	if err != nil {
		t.Fatalf("RecentJobs err = %v", err)
	}
	if len(jobs) != 2 {
		t.Fatalf("len(jobs) = %d, want 2", len(jobs))
	}

	fin := jobs[0]
	if fin.ID != "42" || fin.Worker != WorkerNameNotification || fin.Status != "sent" || fin.Title != "Charge complete" {
		t.Errorf("finished job mismatch: %+v", fin)
	}
	if fin.FinishedAt == nil || !fin.FinishedAt.Equal(tFinish) {
		t.Errorf("FinishedAt = %v, want %v", fin.FinishedAt, tFinish)
	}
	if fin.DurationMs == nil || *fin.DurationMs != tFinishMs {
		t.Errorf("DurationMs = %v, want %d", fin.DurationMs, tFinishMs)
	}

	pend := jobs[1]
	if pend.Worker != WorkerNameNotification || pend.Status != "failed" || pend.Error != "smtp timeout" {
		t.Errorf("pending job mismatch: %+v", pend)
	}
	if pend.FinishedAt != nil || pend.DurationMs != nil {
		t.Errorf("pending job should have no finish: FinishedAt=%v DurationMs=%v", pend.FinishedAt, pend.DurationMs)
	}
	if sql := f.lastQuery().SQL; !contains(sql, "notification_logs") || !contains(sql, "ORDER BY created_at DESC") {
		t.Errorf("unexpected SQL:\n%s", sql)
	}
}

func TestExportRecent(t *testing.T) {
	t.Parallel()
	r, f := newQueueRepo()
	f.pushQuery(rowsFrom(
		scanRow("exp-1", "ready", "csv", tStart, ptr(tFinish), ""),
		scanRow("exp-2", "queued", "json", tStart, nil, ""),
	), nil)

	jobs, err := r.RecentJobs(context.Background(), WorkerNameExport, 10)
	if err != nil {
		t.Fatalf("RecentJobs err = %v", err)
	}
	if len(jobs) != 2 {
		t.Fatalf("len(jobs) = %d, want 2", len(jobs))
	}
	if jobs[0].Worker != WorkerNameExport || jobs[0].Title != "csv" {
		t.Errorf("export job[0] mismatch: %+v", jobs[0])
	}
	if jobs[0].DurationMs == nil || *jobs[0].DurationMs != tFinishMs {
		t.Errorf("export DurationMs = %v, want %d", jobs[0].DurationMs, tFinishMs)
	}
	if jobs[1].FinishedAt != nil {
		t.Errorf("queued export should have nil FinishedAt, got %v", jobs[1].FinishedAt)
	}
	if sql := f.lastQuery().SQL; !contains(sql, "export_jobs") {
		t.Errorf("unexpected SQL:\n%s", sql)
	}
}

func TestAutomationRecent(t *testing.T) {
	t.Parallel()
	r, f := newQueueRepo()
	f.pushQuery(rowsFrom(
		// completed + duration column populated
		scanRow("7", "success", "Nightly precondition", tStart, ptr(tFinish), ptr(int64(910)), ""),
		// running: completed_at + duration NULL -> both pointers stay nil
		scanRow("8", "running", "Sentry sweep", tStart, nil, nil, ""),
	), nil)

	jobs, err := r.RecentJobs(context.Background(), WorkerNameAutomation, 10)
	if err != nil {
		t.Fatalf("RecentJobs err = %v", err)
	}
	if len(jobs) != 2 {
		t.Fatalf("len(jobs) = %d, want 2", len(jobs))
	}
	done := jobs[0]
	if done.Worker != WorkerNameAutomation || done.Title != "Nightly precondition" {
		t.Errorf("automation job[0] mismatch: %+v", done)
	}
	// DurationMs comes from the column, NOT computed from timestamps.
	if done.DurationMs == nil || *done.DurationMs != 910 {
		t.Errorf("automation DurationMs = %v, want 910 (from column)", done.DurationMs)
	}
	if done.FinishedAt == nil || !done.FinishedAt.Equal(tFinish) {
		t.Errorf("automation FinishedAt = %v, want %v", done.FinishedAt, tFinish)
	}
	running := jobs[1]
	if running.FinishedAt != nil || running.DurationMs != nil {
		t.Errorf("running automation should have no finish: %+v", running)
	}
}

// ─── RecentJobs: error branches ────────────────────────────────────

func TestRecentJobs_QueryError(t *testing.T) {
	t.Parallel()
	for _, worker := range KnownWorkerNames {
		worker := worker
		t.Run(worker, func(t *testing.T) {
			t.Parallel()
			r, f := newQueueRepo()
			f.pushQuery(nil, errBoom)
			jobs, err := r.RecentJobs(context.Background(), worker, 10)
			if !errors.Is(err, errBoom) {
				t.Fatalf("err = %v, want Is errBoom", err)
			}
			if jobs != nil {
				t.Errorf("jobs = %v, want nil on query error", jobs)
			}
		})
	}
}

func TestRecentJobs_ScanError(t *testing.T) {
	t.Parallel()
	// Each worker's Recent* has its own row-scan error return; drive them all.
	for _, worker := range KnownWorkerNames {
		worker := worker
		t.Run(worker, func(t *testing.T) {
			t.Parallel()
			r, f := newQueueRepo()
			f.pushQuery(rowsFrom(func(...any) error { return errBoom }), nil)
			jobs, err := r.RecentJobs(context.Background(), worker, 10)
			if !errors.Is(err, errBoom) {
				t.Fatalf("err = %v, want Is errBoom", err)
			}
			if jobs != nil {
				t.Errorf("jobs = %v, want nil on scan error", jobs)
			}
		})
	}
}

func TestRecentJobs_RowsErr(t *testing.T) {
	t.Parallel()
	r, f := newQueueRepo()
	// One row scans fine, then Err() surfaces a post-iteration failure.
	f.pushQuery(rowsErr(errBoom,
		scanRow("1", "sent", "ok", tStart, nil, ""),
	), nil)
	jobs, err := r.RecentJobs(context.Background(), WorkerNameNotification, 10)
	if !errors.Is(err, errBoom) {
		t.Fatalf("err = %v, want Is errBoom (rows.Err)", err)
	}
	// The one successfully-scanned row is still returned alongside the error.
	if len(jobs) != 1 {
		t.Errorf("len(jobs) = %d, want 1 (rows scanned before Err)", len(jobs))
	}
}

// ─── value types ───────────────────────────────────────────────────

func TestQueueJob_ZeroValue(t *testing.T) {
	t.Parallel()
	var j QueueJob
	if j.FinishedAt != nil || j.DurationMs != nil {
		t.Errorf("zero QueueJob should have nil optional pointers, got %+v", j)
	}
	if j.ID != "" || j.Worker != "" {
		t.Errorf("zero QueueJob should have empty strings, got %+v", j)
	}
}
