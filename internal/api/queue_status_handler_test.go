package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeQueueRepo implements queueStatusRepo for the handler tests.
type fakeQueueRepo struct {
	counters map[string]database.QueueCounters
	jobs     map[string][]database.QueueJob
	err      error
}

func (f *fakeQueueRepo) Counters(_ context.Context, worker string) (database.QueueCounters, error) {
	if f.err != nil {
		return database.QueueCounters{}, f.err
	}
	c, ok := f.counters[worker]
	if !ok {
		return database.QueueCounters{}, database.ErrUnknownQueueWorker
	}
	return c, nil
}

func (f *fakeQueueRepo) RecentJobs(_ context.Context, worker string, _ int) ([]database.QueueJob, error) {
	if f.err != nil {
		return nil, f.err
	}
	js, ok := f.jobs[worker]
	if !ok {
		return nil, database.ErrUnknownQueueWorker
	}
	return js, nil
}

// fakeHeartbeatStore implements queueStatusHeartbeatStore.
type fakeHeartbeatStore struct {
	beats map[string]*database.WorkerHeartbeat
	err   error
}

func (f *fakeHeartbeatStore) GetMany(_ context.Context, workers []string) (map[string]*database.WorkerHeartbeat, error) {
	if f.err != nil {
		return nil, f.err
	}
	out := make(map[string]*database.WorkerHeartbeat, len(workers))
	for _, w := range workers {
		if hb, ok := f.beats[w]; ok {
			out[w] = hb
		}
	}
	return out, nil
}

func newTestQueueHandler(repo queueStatusRepo, hb queueStatusHeartbeatStore, now time.Time) *QueueStatusHandler {
	return NewQueueStatusHandler(QueueStatusHandlerConfig{
		QueueRepo:        repo,
		HeartbeatStore:   hb,
		KnownWorkerNames: database.KnownWorkerNames,
		NowFunc:          func() time.Time { return now },
	})
}

func TestQueueStatusHandler_BuildStatus_AllWorkers(t *testing.T) {
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	notif := now.Add(-15 * time.Second)
	exportHB := now.Add(-2 * time.Minute) // 120s → warn
	repo := &fakeQueueRepo{
		counters: map[string]database.QueueCounters{
			database.WorkerNameNotification: {Pending: 5, InProgress: 2, Succeeded24h: 100, Failed24h: 1, OldestPendingAgeSecond: 30},
			database.WorkerNameExport:       {Pending: 0, InProgress: 1, Succeeded24h: 17, Failed24h: 3, OldestPendingAgeSecond: 0},
			database.WorkerNameAutomation:   {Pending: 0, InProgress: 0, Succeeded24h: 42, Failed24h: 0, OldestPendingAgeSecond: 0},
		},
	}
	hb := &fakeHeartbeatStore{
		beats: map[string]*database.WorkerHeartbeat{
			database.WorkerNameNotification: {Worker: database.WorkerNameNotification, LastHeartbeatAt: notif, StartedAt: notif.Add(-time.Hour), Host: "n1", Version: "1.2.3"},
			database.WorkerNameExport:       {Worker: database.WorkerNameExport, LastHeartbeatAt: exportHB, StartedAt: exportHB.Add(-time.Hour)},
			// automation: no heartbeat → down
		},
	}
	h := newTestQueueHandler(repo, hb, now)
	resp := h.buildStatus(context.Background())

	if len(resp.Workers) != 3 {
		t.Fatalf("expected 3 worker rows, got %d", len(resp.Workers))
	}
	byName := map[string]QueueStat{}
	for _, w := range resp.Workers {
		byName[w.Worker] = w
	}

	gotNotif := byName[database.WorkerNameNotification]
	if gotNotif.HeartbeatSeverity != QueueHeartbeatSeverityOK {
		t.Errorf("notification severity = %q, want ok", gotNotif.HeartbeatSeverity)
	}
	if gotNotif.Pending != 5 || gotNotif.Succeeded24h != 100 {
		t.Errorf("notification counters = %+v, want pending=5 succeeded=100", gotNotif)
	}
	if gotNotif.Host != "n1" || gotNotif.Version != "1.2.3" {
		t.Errorf("notification provenance = %s/%s, want n1/1.2.3", gotNotif.Host, gotNotif.Version)
	}

	gotExport := byName[database.WorkerNameExport]
	if gotExport.HeartbeatSeverity != QueueHeartbeatSeverityWarn {
		t.Errorf("export severity = %q, want warn", gotExport.HeartbeatSeverity)
	}
	if gotExport.HeartbeatDetail == "" {
		t.Errorf("export warn must carry a detail string")
	}

	gotAutomation := byName[database.WorkerNameAutomation]
	if gotAutomation.HeartbeatSeverity != QueueHeartbeatSeverityDown {
		t.Errorf("automation severity = %q, want down", gotAutomation.HeartbeatSeverity)
	}
	if gotAutomation.LastHeartbeatAt != nil {
		t.Errorf("automation must have nil LastHeartbeatAt when no beat present")
	}
	if gotAutomation.Succeeded24h != 42 {
		t.Errorf("automation counters not preserved: %+v", gotAutomation)
	}
}

func TestQueueStatusHandler_BuildStatus_StaleHeartbeat(t *testing.T) {
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	stale := now.Add(-10 * time.Minute) // 600s → critical
	repo := &fakeQueueRepo{
		counters: map[string]database.QueueCounters{
			database.WorkerNameNotification: {},
			database.WorkerNameExport:       {},
			database.WorkerNameAutomation:   {},
		},
	}
	hb := &fakeHeartbeatStore{
		beats: map[string]*database.WorkerHeartbeat{
			database.WorkerNameExport: {Worker: database.WorkerNameExport, LastHeartbeatAt: stale},
		},
	}
	h := newTestQueueHandler(repo, hb, now)
	resp := h.buildStatus(context.Background())

	for _, w := range resp.Workers {
		if w.Worker != database.WorkerNameExport {
			continue
		}
		if w.HeartbeatSeverity != QueueHeartbeatSeverityCritical {
			t.Errorf("expected critical severity for 10m-stale heartbeat, got %q", w.HeartbeatSeverity)
		}
		return
	}
	t.Fatal("export worker missing from response")
}

func TestQueueStatusHandler_BuildStatus_NoHeartbeatStore(t *testing.T) {
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	repo := &fakeQueueRepo{
		counters: map[string]database.QueueCounters{
			database.WorkerNameNotification: {},
			database.WorkerNameExport:       {},
			database.WorkerNameAutomation:   {},
		},
	}
	h := newTestQueueHandler(repo, nil, now)
	resp := h.buildStatus(context.Background())
	if len(resp.Workers) != 3 {
		t.Fatalf("expected 3 worker rows, got %d", len(resp.Workers))
	}
	for _, w := range resp.Workers {
		if w.HeartbeatSeverity != QueueHeartbeatSeverityDown {
			t.Errorf("worker %s expected down severity (no store), got %q", w.Worker, w.HeartbeatSeverity)
		}
	}
}

func TestQueueStatusHandler_ServeStatus_HTTP(t *testing.T) {
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	repo := &fakeQueueRepo{
		counters: map[string]database.QueueCounters{
			database.WorkerNameNotification: {Pending: 1},
			database.WorkerNameExport:       {Pending: 2},
			database.WorkerNameAutomation:   {Pending: 0},
		},
	}
	h := newTestQueueHandler(repo, nil, now)

	req := httptest.NewRequest(http.MethodGet, "/system/queues", nil)
	rr := httptest.NewRecorder()
	h.ServeStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var got QueueStatusResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.GeneratedAt.Equal(now) {
		t.Errorf("generated_at = %v, want %v", got.GeneratedAt, now)
	}
	if len(got.Workers) != 3 {
		t.Fatalf("workers = %d, want 3", len(got.Workers))
	}
}

func TestQueueStatusHandler_ServeStatus_RejectsNonGet(t *testing.T) {
	h := newTestQueueHandler(&fakeQueueRepo{}, nil, time.Now())

	req := httptest.NewRequest(http.MethodPost, "/system/queues", nil)
	rr := httptest.NewRecorder()
	h.ServeStatus(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rr.Code)
	}
}

func TestQueueStatusHandler_ServeJobs_OK(t *testing.T) {
	now := time.Date(2026, 5, 5, 12, 0, 0, 0, time.UTC)
	finished := now.Add(-30 * time.Second)
	dur := int64(1500)
	repo := &fakeQueueRepo{
		jobs: map[string][]database.QueueJob{
			database.WorkerNameExport: {
				{
					ID: "job-1", Worker: database.WorkerNameExport, Status: "ready",
					Title: "drives-csv", StartedAt: now.Add(-2 * time.Minute),
					FinishedAt: &finished, DurationMs: &dur,
				},
			},
		},
	}
	h := newTestQueueHandler(repo, nil, now)

	req := httptest.NewRequest(http.MethodGet, "/system/queues/export/jobs?limit=10", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("worker", database.WorkerNameExport)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.ServeJobs(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, body=%s", rr.Code, rr.Body.String())
	}
	var got QueueJobsResponse
	if err := json.NewDecoder(rr.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Worker != database.WorkerNameExport {
		t.Errorf("worker = %q, want %q", got.Worker, database.WorkerNameExport)
	}
	if len(got.Jobs) != 1 {
		t.Fatalf("jobs = %d, want 1", len(got.Jobs))
	}
	if got.Jobs[0].ID != "job-1" {
		t.Errorf("job id = %q, want job-1", got.Jobs[0].ID)
	}
	if got.Jobs[0].DurationMs == nil || *got.Jobs[0].DurationMs != 1500 {
		t.Errorf("duration_ms not preserved: %+v", got.Jobs[0])
	}
}

func TestQueueStatusHandler_ServeJobs_UnknownWorker(t *testing.T) {
	h := newTestQueueHandler(&fakeQueueRepo{jobs: map[string][]database.QueueJob{}}, nil, time.Now())

	req := httptest.NewRequest(http.MethodGet, "/system/queues/wat/jobs", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("worker", "wat")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.ServeJobs(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rr.Code)
	}
}

func TestQueueStatusHandler_ServeJobs_RepoUnknownWorker(t *testing.T) {
	// Worker is in the configured set but the repo claims it
	// doesn't know it (e.g. due to a future mismatch). Handler
	// must surface a 404 rather than a generic 500.
	repo := &fakeQueueRepo{
		jobs: map[string][]database.QueueJob{},
	}
	h := newTestQueueHandler(repo, nil, time.Now())

	req := httptest.NewRequest(http.MethodGet, "/system/queues/notification/jobs", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("worker", database.WorkerNameNotification)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.ServeJobs(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

func TestQueueStatusHandler_ServeJobs_RepoErrorBecomes500(t *testing.T) {
	repo := &fakeQueueRepo{err: errors.New("db down"), jobs: map[string][]database.QueueJob{database.WorkerNameExport: nil}}
	h := newTestQueueHandler(repo, nil, time.Now())

	req := httptest.NewRequest(http.MethodGet, "/system/queues/export/jobs", nil)
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("worker", database.WorkerNameExport)
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))

	rr := httptest.NewRecorder()
	h.ServeJobs(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rr.Code)
	}
}

func TestParseQueueLimit(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want int
	}{
		{"", 20},
		{"abc", 20},
		{"-5", 20},
		{"0", 20},
		{"1", 1},
		{"50", 50},
		{"199", 199},
		{"200", 200},
		{"500", 200},
	} {
		if got := parseQueueLimit(tc.in); got != tc.want {
			t.Errorf("parseQueueLimit(%q) = %d, want %d", tc.in, got, tc.want)
		}
	}
}

func TestQueueStatusHandler_ServeJobs_LimitInUrl(t *testing.T) {
	// Simply verifies the limit query param plumbs through without
	// exploding — the actual clamping logic is unit-tested above.
	repo := &fakeQueueRepo{
		jobs: map[string][]database.QueueJob{database.WorkerNameExport: nil},
	}
	h := newTestQueueHandler(repo, nil, time.Now())

	for _, raw := range []string{"", "1", "999", "garbage"} {
		req := httptest.NewRequest(http.MethodGet, "/system/queues/export/jobs?limit="+raw, nil)
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("worker", database.WorkerNameExport)
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
		rr := httptest.NewRecorder()
		h.ServeJobs(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("limit=%q: status=%d, body=%s", raw, rr.Code, rr.Body.String())
		}
		if !strings.Contains(rr.Body.String(), `"jobs"`) {
			t.Fatalf("limit=%q: body missing jobs envelope: %s", raw, rr.Body.String())
		}
	}
}

func TestNewQueueStatusHandler_DefaultsToKnownWorkers(t *testing.T) {
	h := NewQueueStatusHandler(QueueStatusHandlerConfig{})
	if len(h.workers) != len(database.KnownWorkerNames) {
		t.Errorf("expected default worker list to match database.KnownWorkerNames")
	}
}
