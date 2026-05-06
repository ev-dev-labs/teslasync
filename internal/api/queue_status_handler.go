// Phase-46 / Prompt 41 — Job queue status feed.
//
// Two read-only endpoints:
//
//   GET /api/v1/system/queues
//     Returns a list of QueueStat rows, one per known worker
//     (notification, export, automation). Each row carries the
//     latest heartbeat (if any) plus pending / in-progress /
//     succeeded-24h / failed-24h / oldest-pending counts pulled
//     from the worker's domain table.
//
//   GET /api/v1/system/queues/{worker}/jobs?limit=N
//     Returns up to N recent jobs for the named worker for the
//     drawer view. limit defaults to 20 and is clamped at 200.
//
// Heartbeat staleness ladder mirrors the operator-facing color
// coding the panel uses:
//
//   ok       — last_heartbeat_at within 60 seconds.
//   warn     — 60s ≤ stale_age ≤ 300s
//   critical — stale_age > 300s OR no heartbeat at all.
//
// Both endpoints are cheap — small SQL aggregates over indexed
// columns plus one Redis MGET. Polled at the panel's 30-second
// cadence with no measurable overhead.

package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Heartbeat staleness thresholds (seconds). Exposed as package vars
// rather than constants so the test file can perturb them without
// forking the handler logic.
var (
	queueHeartbeatWarnThresholdSec     int64 = 60
	queueHeartbeatCriticalThresholdSec int64 = 300
)

// Severity values returned in QueueStat.HeartbeatSeverity. Mirrors
// the rate-limit panel's enum so the SPA can re-use its severity
// → colour map.
const (
	QueueHeartbeatSeverityOK       = "ok"
	QueueHeartbeatSeverityWarn     = "warn"
	QueueHeartbeatSeverityCritical = "critical"
	QueueHeartbeatSeverityDown     = "down"
)

// QueueStatusResponse is the JSON envelope for GET /system/queues.
// Wrapping the slice keeps future fields (cluster-wide totals,
// alerts, etc.) additive without breaking the SPA.
type QueueStatusResponse struct {
	GeneratedAt time.Time   `json:"generated_at"`
	Workers     []QueueStat `json:"workers"`
}

// QueueStat is one row of the panel — one card per worker.
type QueueStat struct {
	Worker                  string     `json:"worker"`
	DisplayName             string     `json:"display_name"`
	Pending                 int64      `json:"pending"`
	InProgress              int64      `json:"in_progress"`
	Succeeded24h            int64      `json:"succeeded_24h"`
	Failed24h               int64      `json:"failed_24h"`
	OldestPendingAgeSeconds int64      `json:"oldest_pending_age_seconds"`
	HeartbeatSeverity       string     `json:"heartbeat_severity"`
	HeartbeatDetail         string     `json:"heartbeat_detail"`
	LastHeartbeatAt         *time.Time `json:"last_heartbeat_at,omitempty"`
	StartedAt               *time.Time `json:"started_at,omitempty"`
	Host                    string     `json:"host,omitempty"`
	Version                 string     `json:"version,omitempty"`
}

// QueueJobsResponse is the JSON envelope for GET
// /system/queues/{worker}/jobs. Wrapping keeps room for a future
// cursor without breaking the SPA.
type QueueJobsResponse struct {
	Worker string         `json:"worker"`
	Jobs   []QueueJobView `json:"jobs"`
}

// QueueJobView is the row shape rendered inside the drawer. Mirrors
// database.QueueJob 1:1 but the view layer chooses the JSON
// presentation (e.g. the empty error → empty string vs. null).
type QueueJobView struct {
	ID         string     `json:"id"`
	Worker     string     `json:"worker"`
	Status     string     `json:"status"`
	Title      string     `json:"title"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	DurationMs *int64     `json:"duration_ms,omitempty"`
	Error      string     `json:"error,omitempty"`
}

// queueDisplayNames render a human-readable label per worker. The
// SPA also has its own i18n strings — this fallback keeps the API
// useful from curl / Postman without needing a translation layer.
var queueDisplayNames = map[string]string{
	database.WorkerNameNotification: "Notification worker",
	database.WorkerNameExport:       "Export worker",
	database.WorkerNameAutomation:   "Automation worker",
}

// QueueStatusHandlerConfig groups the constructor dependencies.
// Pass nil for any of the stores when the corresponding subsystem
// is intentionally disabled — the handler degrades gracefully (a
// nil queue repo produces zero counters; a nil heartbeat store
// reports every worker as "down").
type QueueStatusHandlerConfig struct {
	QueueRepo         queueStatusRepo
	HeartbeatStore    queueStatusHeartbeatStore
	KnownWorkerNames  []string
	NowFunc           func() time.Time
}

// queueStatusRepo is the narrow read interface the handler uses.
// Defined locally so tests can inject a fake without dragging in a
// full *database.WorkerQueueRepo.
type queueStatusRepo interface {
	Counters(ctx context.Context, worker string) (database.QueueCounters, error)
	RecentJobs(ctx context.Context, worker string, limit int) ([]database.QueueJob, error)
}

// queueStatusHeartbeatStore mirrors the relevant subset of
// database.WorkerStatusStore. Same rationale as queueStatusRepo.
type queueStatusHeartbeatStore interface {
	GetMany(ctx context.Context, workers []string) (map[string]*database.WorkerHeartbeat, error)
}

// QueueStatusHandler serves /system/queues and /system/queues/{worker}/jobs.
type QueueStatusHandler struct {
	repo      queueStatusRepo
	heartbeat queueStatusHeartbeatStore
	workers   []string
	now       func() time.Time
}

// NewQueueStatusHandler wires the production handler.
func NewQueueStatusHandler(cfg QueueStatusHandlerConfig) *QueueStatusHandler {
	workers := cfg.KnownWorkerNames
	if len(workers) == 0 {
		workers = database.KnownWorkerNames
	}
	nowFn := cfg.NowFunc
	if nowFn == nil {
		nowFn = func() time.Time { return time.Now().UTC() }
	}
	return &QueueStatusHandler{
		repo:      cfg.QueueRepo,
		heartbeat: cfg.HeartbeatStore,
		workers:   workers,
		now:       nowFn,
	}
}

// ServeStatus answers GET /system/queues.
func (h *QueueStatusHandler) ServeStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	resp := h.buildStatus(r.Context())
	writeJSON(w, http.StatusOK, resp)
}

// ServeJobs answers GET /system/queues/{worker}/jobs.
func (h *QueueStatusHandler) ServeJobs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	worker := chi.URLParam(r, "worker")
	if !h.isKnownWorker(worker) {
		writeError(w, http.StatusNotFound, "unknown worker")
		return
	}
	limit := parseQueueLimit(r.URL.Query().Get("limit"))
	if h.repo == nil {
		writeJSON(w, http.StatusOK, QueueJobsResponse{Worker: worker, Jobs: []QueueJobView{}})
		return
	}
	jobs, err := h.repo.RecentJobs(r.Context(), worker, limit)
	if err != nil {
		if errors.Is(err, database.ErrUnknownQueueWorker) {
			writeError(w, http.StatusNotFound, "unknown worker")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to load recent jobs")
		return
	}
	views := make([]QueueJobView, 0, len(jobs))
	for _, j := range jobs {
		views = append(views, queueJobToView(j))
	}
	writeJSON(w, http.StatusOK, QueueJobsResponse{Worker: worker, Jobs: views})
}

// buildStatus is the pure aggregation step — exposed (lower-case but
// reachable from tests) so the round-trip-free unit tests can assert
// shape without an httptest call.
func (h *QueueStatusHandler) buildStatus(ctx context.Context) QueueStatusResponse {
	beats := map[string]*database.WorkerHeartbeat{}
	if h.heartbeat != nil {
		got, err := h.heartbeat.GetMany(ctx, h.workers)
		if err == nil {
			beats = got
		}
	}
	rows := make([]QueueStat, 0, len(h.workers))
	for _, name := range h.workers {
		stat := QueueStat{
			Worker:      name,
			DisplayName: queueDisplayNames[name],
		}
		if h.repo != nil {
			counters, err := h.repo.Counters(ctx, name)
			if err == nil {
				stat.Pending = counters.Pending
				stat.InProgress = counters.InProgress
				stat.Succeeded24h = counters.Succeeded24h
				stat.Failed24h = counters.Failed24h
				stat.OldestPendingAgeSeconds = counters.OldestPendingAgeSecond
			}
		}
		hb := beats[name]
		applyHeartbeatStatus(&stat, hb, h.now())
		rows = append(rows, stat)
	}
	return QueueStatusResponse{GeneratedAt: h.now(), Workers: rows}
}

// applyHeartbeatStatus sets the severity / detail / timestamp fields
// on stat based on hb. hb may be nil — treated as "no heartbeat,
// down".
func applyHeartbeatStatus(stat *QueueStat, hb *database.WorkerHeartbeat, now time.Time) {
	if hb == nil {
		stat.HeartbeatSeverity = QueueHeartbeatSeverityDown
		stat.HeartbeatDetail = "no heartbeat received"
		return
	}
	stat.LastHeartbeatAt = &hb.LastHeartbeatAt
	if !hb.StartedAt.IsZero() {
		started := hb.StartedAt
		stat.StartedAt = &started
	}
	stat.Host = hb.Host
	stat.Version = hb.Version
	if hb.LastHeartbeatAt.IsZero() {
		stat.HeartbeatSeverity = QueueHeartbeatSeverityDown
		stat.HeartbeatDetail = "heartbeat document missing timestamp"
		return
	}
	ageSec := int64(now.Sub(hb.LastHeartbeatAt).Seconds())
	if ageSec < 0 {
		ageSec = 0
	}
	switch {
	case ageSec <= queueHeartbeatWarnThresholdSec:
		stat.HeartbeatSeverity = QueueHeartbeatSeverityOK
	case ageSec <= queueHeartbeatCriticalThresholdSec:
		stat.HeartbeatSeverity = QueueHeartbeatSeverityWarn
		stat.HeartbeatDetail = "heartbeat is delayed"
	default:
		stat.HeartbeatSeverity = QueueHeartbeatSeverityCritical
		stat.HeartbeatDetail = "heartbeat is stale"
	}
}

// isKnownWorker reports whether name is one of the workers this
// handler is configured for. Linear scan is fine — the slice is
// fixed at three entries.
func (h *QueueStatusHandler) isKnownWorker(name string) bool {
	for _, w := range h.workers {
		if w == name {
			return true
		}
	}
	return false
}

// parseQueueLimit clamps a query-string limit to [1, 200]. Empty or
// invalid values fall back to 20 so the drawer always renders
// something even when the SPA forgets to set the parameter.
func parseQueueLimit(raw string) int {
	if raw == "" {
		return 20
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 20
	}
	if n > 200 {
		return 200
	}
	return n
}

// queueJobToView is the per-row presentation transform. Kept as a
// free function so tests can pin the mapping in isolation.
func queueJobToView(j database.QueueJob) QueueJobView {
	return QueueJobView{
		ID:         j.ID,
		Worker:     j.Worker,
		Status:     j.Status,
		Title:      j.Title,
		StartedAt:  j.StartedAt,
		FinishedAt: j.FinishedAt,
		DurationMs: j.DurationMs,
		Error:      j.Error,
	}
}
