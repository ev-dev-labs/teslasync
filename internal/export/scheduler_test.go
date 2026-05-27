// Phase-46 / Prompt 65 — Scheduler unit tests.
//
// The tests exercise the scheduler in isolation by stubbing its
// three collaborators (store / processor / delivery) so we never
// touch a real DB or filesystem. The goal is to pin three
// behaviours the production deployment must keep:
//
//  1. Per-row try/catch — one panicking or erroring row MUST NOT
//     block its siblings.
//  2. Outcome propagation — every row finishes by writing exactly
//     one MarkRunResult call carrying the recomputed next_run_at.
//  3. Cancellation — a cancelled context drops the in-flight tick
//     cleanly.
package export

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ---------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------

type stubSchedulerStore struct {
	mu        sync.Mutex
	queued    []database.ScheduledExportRow
	consumed  bool
	dueErr    error
	markErr   error
	outcomes  map[int64]database.ScheduledExportRunOutcome
	markCalls int
}

func newStubSchedulerStore(rows ...database.ScheduledExportRow) *stubSchedulerStore {
	return &stubSchedulerStore{
		queued:   rows,
		outcomes: make(map[int64]database.ScheduledExportRunOutcome),
	}
}

func (s *stubSchedulerStore) DueBefore(_ context.Context, _ time.Time, _ int) ([]database.ScheduledExportRow, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.dueErr != nil {
		return nil, s.dueErr
	}
	if s.consumed {
		return nil, nil
	}
	s.consumed = true
	out := make([]database.ScheduledExportRow, len(s.queued))
	copy(out, s.queued)
	return out, nil
}

func (s *stubSchedulerStore) MarkRunResult(_ context.Context, id int64, outcome database.ScheduledExportRunOutcome) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.markCalls++
	if s.markErr != nil {
		return s.markErr
	}
	s.outcomes[id] = outcome
	return nil
}

type stubProcessor struct {
	mu      sync.Mutex
	calls   []*JobRequest
	results map[int64]*ProcessResult
	errors  map[int64]error
	// panicOn fires a panic when the corresponding ID arrives.
	panicOn map[int64]string
}

func newStubProcessor() *stubProcessor {
	return &stubProcessor{
		results: make(map[int64]*ProcessResult),
		errors:  make(map[int64]error),
		panicOn: make(map[int64]string),
	}
}

// rowIDFromJob extracts the schedule id back out of the synthesised
// job-id ("scheduled-{ID}-{ts}") so the stub can dispatch results
// without us threading the ID through extra fields.
func rowIDFromJob(req *JobRequest) int64 {
	if req == nil {
		return 0
	}
	var id int64
	for _, run := range []string{req.JobID} {
		const prefix = "scheduled-"
		if len(run) <= len(prefix) || run[:len(prefix)] != prefix {
			continue
		}
		rest := run[len(prefix):]
		// rest is "{ID}-{unix}". Walk until the first '-'.
		for i := 0; i < len(rest); i++ {
			if rest[i] == '-' {
				rest = rest[:i]
				break
			}
		}
		// strconv to keep the helper string-only would shadow the
		// real strconv import in the package. Use a hand-rolled
		// parser to keep this file dependency-free.
		for _, c := range rest {
			if c < '0' || c > '9' {
				return 0
			}
			id = id*10 + int64(c-'0')
		}
	}
	return id
}

func (p *stubProcessor) Process(_ context.Context, req *JobRequest) (*ProcessResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls = append(p.calls, req)
	id := rowIDFromJob(req)
	if msg, ok := p.panicOn[id]; ok {
		panic(msg)
	}
	if err, ok := p.errors[id]; ok {
		return nil, err
	}
	if res, ok := p.results[id]; ok {
		return res, nil
	}
	return &ProcessResult{FileName: "default.csv", Data: []byte("default"), RecordCount: 0}, nil
}

type stubDelivery struct {
	mu    sync.Mutex
	calls []deliveryCall
	errs  map[int64]error
}

type deliveryCall struct {
	row    database.ScheduledExportRow
	result *ProcessResult
}

func newStubDelivery() *stubDelivery {
	return &stubDelivery{errs: make(map[int64]error)}
}

func (d *stubDelivery) Deliver(_ context.Context, row database.ScheduledExportRow, result *ProcessResult) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.calls = append(d.calls, deliveryCall{row: row, result: result})
	if err, ok := d.errs[row.ID]; ok {
		return err
	}
	return nil
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

func makeRow(id int64, name string) database.ScheduledExportRow {
	return database.ScheduledExportRow{
		ID:           id,
		OwnerSubject: "alice",
		Name:         name,
		ExportType:   "drives",
		Format:       "csv",
		ScheduleCron: "0 9 * * 0",
		Delivery:     database.ScheduledExportDelivery{Kind: database.DeliveryKindDownload},
		RangeWindow:  "7d",
		Enabled:      true,
	}
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------

func TestScheduler_PerRowFailureIsolation(t *testing.T) {
	rows := []database.ScheduledExportRow{
		makeRow(1, "ok-row-A"),
		makeRow(2, "panicking-row"),
		makeRow(3, "errored-row"),
		makeRow(4, "ok-row-B"),
	}
	store := newStubSchedulerStore(rows...)
	proc := newStubProcessor()
	proc.panicOn[2] = "boom"
	proc.errors[3] = errors.New("processor failed")
	delivery := newStubDelivery()

	now := time.Date(2025, 6, 15, 9, 0, 0, 0, time.UTC)
	sch := NewScheduler(store, proc, delivery, SchedulerOptions{
		Interval: time.Hour, // unused — we drive Tick directly
		Now:      func() time.Time { return now },
	})
	sch.Tick(context.Background())

	// All 4 rows must have been ack'd via MarkRunResult.
	if store.markCalls != 4 {
		t.Fatalf("MarkRunResult calls = %d, want 4", store.markCalls)
	}
	wantStatus := map[int64]string{
		1: scheduledStatusOK,
		2: scheduledStatusFailed,
		3: scheduledStatusFailed,
		4: scheduledStatusOK,
	}
	for id, want := range wantStatus {
		got, ok := store.outcomes[id]
		if !ok {
			t.Fatalf("row %d: missing outcome", id)
		}
		if got.Status != want {
			t.Errorf("row %d status = %q, want %q (err=%q)", id, got.Status, want, got.Err)
		}
	}
	// Failed row carries the original error message.
	if got := store.outcomes[3].Err; got == "" || got != "processor failed" {
		t.Errorf("row 3 err = %q, want %q", got, "processor failed")
	}
	// Panicking row records the panic value, not a generic message.
	if got := store.outcomes[2].Err; got == "" || got[:6] != "panic:" {
		t.Errorf("row 2 err = %q, want panic-prefixed", got)
	}
	// Successful rows triggered delivery; failed rows did not.
	if len(delivery.calls) != 2 {
		t.Errorf("delivery calls = %d, want 2 (rows 1 and 4)", len(delivery.calls))
	}
}

func TestScheduler_NextRunRecomputed(t *testing.T) {
	row := makeRow(7, "weekly")
	row.ScheduleCron = "0 9 * * 0" // Sundays at 09:00
	store := newStubSchedulerStore(row)
	proc := newStubProcessor()
	delivery := newStubDelivery()

	// Friday 2025-06-13 09:00 UTC → next Sunday at 09:00 UTC.
	now := time.Date(2025, 6, 13, 9, 0, 0, 0, time.UTC)
	sch := NewScheduler(store, proc, delivery, SchedulerOptions{
		Now: func() time.Time { return now },
	})
	sch.Tick(context.Background())

	out, ok := store.outcomes[7]
	if !ok {
		t.Fatal("missing outcome for row 7")
	}
	if out.NextRunAt == nil {
		t.Fatal("NextRunAt nil")
	}
	want := time.Date(2025, 6, 15, 9, 0, 0, 0, time.UTC)
	if !out.NextRunAt.Equal(want) {
		t.Fatalf("next_run_at = %v, want %v", out.NextRunAt, want)
	}
	if !out.RanAt.Equal(now) {
		t.Fatalf("ran_at = %v, want %v", out.RanAt, now)
	}
}

func TestScheduler_DeliveryFailureMarksRowFailed(t *testing.T) {
	row := makeRow(11, "delivery-fail")
	store := newStubSchedulerStore(row)
	proc := newStubProcessor()
	delivery := newStubDelivery()
	delivery.errs[11] = errors.New("smtp 5xx")

	now := time.Date(2025, 6, 15, 9, 0, 0, 0, time.UTC)
	sch := NewScheduler(store, proc, delivery, SchedulerOptions{Now: func() time.Time { return now }})
	sch.Tick(context.Background())

	out := store.outcomes[11]
	if out.Status != scheduledStatusFailed {
		t.Fatalf("status = %q, want failed", out.Status)
	}
	if out.Err != "smtp 5xx" {
		t.Fatalf("err = %q, want smtp 5xx", out.Err)
	}
}

func TestScheduler_NoRowsDoesNothing(t *testing.T) {
	store := newStubSchedulerStore()
	proc := newStubProcessor()
	delivery := newStubDelivery()
	sch := NewScheduler(store, proc, delivery, SchedulerOptions{})
	if got := sch.Tick(context.Background()); got != 0 {
		t.Fatalf("processed %d rows, want 0", got)
	}
	if store.markCalls != 0 {
		t.Fatalf("MarkRunResult calls = %d, want 0", store.markCalls)
	}
}

func TestScheduler_DueBeforeErrorReturnsZero(t *testing.T) {
	store := newStubSchedulerStore()
	store.dueErr = errors.New("db down")
	proc := newStubProcessor()
	delivery := newStubDelivery()
	sch := NewScheduler(store, proc, delivery, SchedulerOptions{})
	if got := sch.Tick(context.Background()); got != 0 {
		t.Fatalf("processed %d rows, want 0 on DueBefore error", got)
	}
}

func TestScheduler_StartHonoursContext(t *testing.T) {
	store := newStubSchedulerStore()
	proc := newStubProcessor()
	delivery := newStubDelivery()
	sch := NewScheduler(store, proc, delivery, SchedulerOptions{Interval: 50 * time.Millisecond})
	ctx, cancel := context.WithCancel(context.Background())
	startErr := make(chan error, 1)
	go func() { startErr <- sch.Start(ctx) }()
	// Let one tick land then cancel.
	time.Sleep(120 * time.Millisecond)
	cancel()
	select {
	case err := <-startErr:
		if err != nil {
			t.Fatalf("Start returned %v, want nil after cancel", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Start did not return within 2s of context cancel")
	}
	select {
	case <-sch.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("Done channel never closed")
	}
}

func TestScheduler_BuildJobRequestUsesRangeWindow(t *testing.T) {
	row := makeRow(42, "drives-7d")
	row.RangeWindow = "7d"
	now := time.Date(2025, 6, 15, 12, 0, 0, 0, time.UTC)
	jobReq, err := buildJobRequest(row, now)
	if err != nil {
		t.Fatal(err)
	}
	wantStart := now.Add(-7 * 24 * time.Hour)
	if jobReq.StartDate == nil || !jobReq.StartDate.Equal(wantStart) {
		t.Fatalf("StartDate = %v, want %v", jobReq.StartDate, wantStart)
	}
	if jobReq.EndDate == nil || !jobReq.EndDate.Equal(now) {
		t.Fatalf("EndDate = %v, want %v", jobReq.EndDate, now)
	}
	if jobReq.Type != "drives" || jobReq.Format != "csv" {
		t.Fatalf("Type/Format = %q/%q, want drives/csv", jobReq.Type, jobReq.Format)
	}
}

func TestScheduler_NilSafe(t *testing.T) {
	// nil scheduler: methods are no-ops.
	var sch *Scheduler
	if got := sch.Tick(context.Background()); got != 0 {
		t.Fatalf("nil Tick = %d, want 0", got)
	}
	if err := sch.Start(context.Background()); err != nil {
		t.Fatalf("nil Start = %v, want nil", err)
	}

	// Scheduler with no store/proc: Start returns immediately.
	sch2 := NewScheduler(nil, nil, nil, SchedulerOptions{Interval: 10 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	if err := sch2.Start(ctx); err != nil {
		t.Fatalf("Start with nil deps = %v, want nil", err)
	}
}

func TestLogDelivery_AcceptsAllInputs(t *testing.T) {
	d := LogDelivery{}
	if err := d.Deliver(context.Background(), makeRow(1, "foo"), nil); err != nil {
		t.Fatalf("LogDelivery nil result = %v, want nil", err)
	}
	if err := d.Deliver(context.Background(), makeRow(1, "foo"), &ProcessResult{Data: []byte("x"), RecordCount: 1}); err != nil {
		t.Fatalf("LogDelivery non-nil result = %v, want nil", err)
	}
}
