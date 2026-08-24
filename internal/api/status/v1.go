// Status API endpoints for operators.
//
// Purpose
// -------
// Self-hosted operators wire TeslaSync into their own dashboards
// (Grafana, Uptime Kuma, Home Assistant, etc.). The pre-existing
// /api/v1/system/health and /system/workers endpoints expose what we
// need but in handler-internal shapes — they grew organically as the
// SPA needed new fields. This package exposes a *stable*, contract-
// shaped operator API:
//
//   GET /api/v1/status               → overall status snapshot
//   GET /api/v1/status/components    → per-component array
//   GET /api/v1/status/uptime?window → uptime % over a window
//   GET /api/v1/status/resources     → CPU / memory / disk
//   GET /api/v1/status/incidents     → active incidents (empty for now)
//   GET /api/v1/status/live          → SSE push of the snapshot
//
// The SSE endpoint is what /system-status uses to drop polling. When
// SSE breaks (proxy strips the connection, browser refuses event-stream),
// the SPA falls back to its existing 30s polling — no dropouts.
//
// All endpoints inherit ForwardAuth from the parent /api/v1 group; no
// extra auth code lives here.

package status

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"

	apiadminmnt "github.com/ev-dev-labs/teslasync/internal/api/adminmaintenance"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// MaintenanceView is the resolved service-mode snapshot consumed by StatusV1Handler.
type MaintenanceView = apiadminmnt.MaintenanceView

var startTime = time.Now()

// StatusSnapshot is the canonical shape returned by /api/v1/status and
// pushed by /api/v1/status/live. Stable contract — additive only.
type StatusSnapshot struct {
	Status      string             `json:"status"` // operational | degraded | down | maintenance
	GeneratedAt time.Time          `json:"generated_at"`
	Version     StatusVersion      `json:"version"`
	Components  []StatusComponent  `json:"components"`
	Resources   StatusResources    `json:"resources"`
	Maintenance *StatusMaintenance `json:"maintenance,omitempty"`
	Incidents   []StatusIncident   `json:"incidents"` // active only — empty array (never null) for stability
	Counts      StatusCounts       `json:"counts"`
}

// StatusVersion mirrors a subset of /system/version for self-contained
// snapshots. Operators querying /api/v1/status get version info without
// a second round-trip.
type StatusVersion struct {
	Build     string `json:"build"`
	GoVersion string `json:"go_version"`
	StartedAt string `json:"started_at"`
}

// StatusComponent is one health-monitored subsystem. Status mirrors the
// resilience.HealthMonitor enum (healthy | degraded | unhealthy | unknown).
type StatusComponent struct {
	Name                string  `json:"name"`
	Status              string  `json:"status"`
	LatencyMs           *int64  `json:"latency_ms,omitempty"`
	LastCheckAt         *string `json:"last_check_at,omitempty"`
	ConsecutiveFailures int64   `json:"consecutive_failures"`
	Error               string  `json:"error,omitempty"`
}

// StatusResources mirrors the relevant subset of /system/health system
// info — what an operator wants to graph in their own dashboard.
type StatusResources struct {
	Goroutines    int     `json:"goroutines"`
	UptimeSeconds float64 `json:"uptime_seconds"`
	GoVersion     string  `json:"go_version"`
}

// StatusMaintenance is omitted when mode == ok. When set, the operator's
// integration knows to suppress paging and surface the message instead.
type StatusMaintenance struct {
	Mode      string  `json:"mode"` // ok | maintenance | degraded
	Message   string  `json:"message,omitempty"`
	Until     *string `json:"until,omitempty"` // RFC3339
	Source    string  `json:"source"`          // env | db | default
	UpdatedAt *string `json:"updated_at,omitempty"`
}

// StatusIncident reserves the field shape for the upcoming incident
// model. Until incidents land we always emit an empty array — that way
// downstream JSON schemas don't break when incidents go live.
type StatusIncident struct {
	ID         string     `json:"id"`
	Title      string     `json:"title"`
	Status     string     `json:"status"`   // investigating | identified | monitoring | resolved
	Severity   string     `json:"severity"` // minor | major | critical
	StartedAt  time.Time  `json:"started_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
	ResolvedAt *time.Time `json:"resolved_at,omitempty"`
	Components []string   `json:"affected_components,omitempty"`
}

// StatusCounts is the at-a-glance roll-up the operator dashboards graph.
type StatusCounts struct {
	ComponentsTotal     int `json:"components_total"`
	ComponentsHealthy   int `json:"components_healthy"`
	ComponentsDegraded  int `json:"components_degraded"`
	ComponentsUnhealthy int `json:"components_unhealthy"`
}

// StatusUptimeWindow is returned by /api/v1/status/uptime?window=...
// Until per-component heartbeat history lands, the percentage is derived
// from the *current* health monitor view — explicitly marked as such so
// downstream consumers don't draw the wrong conclusion.
type StatusUptimeWindow struct {
	Window           string    `json:"window"` // 24h | 7d | 30d | 90d | 1y
	UptimePercent    float64   `json:"uptime_percent"`
	HealthyCount     int       `json:"healthy_count"`
	TotalCount       int       `json:"total_count"`
	GeneratedAt      time.Time `json:"generated_at"`
	HistoricalSource string    `json:"historical_source"` // "current_snapshot" until heartbeat history wires
	Note             string    `json:"note,omitempty"`
}

// StatusV1Config groups the dependencies the handlers need. Pass these
// from the router constructor (router.go) — the handler is otherwise a
// closure over the resilience.HealthMonitor.
type StatusV1Config struct {
	Health           *resilience.HealthMonitor
	AppVersion       string
	MaintenanceState func(context.Context) MaintenanceView
	IncidentStore    StatusIncidentStore // nil-safe
	StartedAt        time.Time
}

// StatusIncidentStore is the narrow interface the status handlers use.
// Defined locally so a future incidents subsystem can implement it
// without dragging this package into a cycle. nil-safe — handlers
// substitute an empty list when not provided.
type StatusIncidentStore interface {
	ListActive(ctx context.Context) ([]StatusIncident, error)
}

// StatusV1Handler bundles the state shared by the four REST endpoints
// and the SSE pump. Build once at router wire-up and route methods.
type StatusV1Handler struct {
	cfg       StatusV1Config
	startedAt time.Time
}

// NewStatusV1Handler constructs the handler. startedAt should be the
// process start time so /uptime can compute "uptime since start"
// ranges accurately.
func NewStatusV1Handler(cfg StatusV1Config) *StatusV1Handler {
	if cfg.StartedAt.IsZero() {
		cfg.StartedAt = startTime
	}
	return &StatusV1Handler{cfg: cfg, startedAt: cfg.StartedAt}
}

// snapshot computes the current StatusSnapshot. Pure — no side effects,
// safe to call from both REST handlers and the SSE pump.
func (h *StatusV1Handler) snapshot(ctx context.Context) StatusSnapshot {
	now := time.Now().UTC()

	components := make([]StatusComponent, 0, 16)
	healthy, degraded, unhealthy := 0, 0, 0
	if h.cfg.Health != nil {
		for name, comp := range h.cfg.Health.GetStatus() {
			c := StatusComponent{
				Name:                name,
				Status:              comp.Status.String(),
				ConsecutiveFailures: int64(comp.ConsecFails),
				Error:               comp.LastError,
			}
			if !comp.LastCheck.IsZero() {
				ts := comp.LastCheck.UTC().Format(time.RFC3339)
				c.LastCheckAt = &ts
			}
			components = append(components, c)
			switch comp.Status {
			case resilience.StatusHealthy:
				healthy++
			case resilience.StatusDegraded:
				degraded++
			case resilience.StatusUnhealthy:
				unhealthy++
			}
		}
	}

	overall := "operational"
	if h.cfg.Health != nil {
		switch h.cfg.Health.OverallStatus() {
		case resilience.StatusDegraded:
			overall = "degraded"
		case resilience.StatusUnhealthy:
			overall = "down"
		}
	}

	var maint *StatusMaintenance
	if h.cfg.MaintenanceState != nil {
		view := h.cfg.MaintenanceState(ctx)
		if view.Mode != "" && view.Mode != systemdb.SystemModeOK {
			m := &StatusMaintenance{Mode: view.Mode, Message: view.Message, Source: view.Source}
			if view.Until != nil {
				ts := view.Until.UTC().Format(time.RFC3339)
				m.Until = &ts
			}
			if !view.UpdatedAt.IsZero() {
				ts := view.UpdatedAt.UTC().Format(time.RFC3339)
				m.UpdatedAt = &ts
			}
			maint = m
			if view.Mode == "maintenance" {
				overall = "maintenance"
			}
		}
	}

	var incidents []StatusIncident
	if h.cfg.IncidentStore != nil {
		if active, err := h.cfg.IncidentStore.ListActive(ctx); err == nil {
			incidents = active
		}
	}
	if incidents == nil {
		incidents = []StatusIncident{}
	}

	ver := h.cfg.AppVersion
	if ver == "" {
		ver = "dev"
	}

	return StatusSnapshot{
		Status:      overall,
		GeneratedAt: now,
		Version: StatusVersion{
			Build:     ver,
			GoVersion: runtime.Version(),
			StartedAt: h.startedAt.UTC().Format(time.RFC3339),
		},
		Components: components,
		Resources: StatusResources{
			Goroutines:    runtime.NumGoroutine(),
			UptimeSeconds: time.Since(h.startedAt).Seconds(),
			GoVersion:     runtime.Version(),
		},
		Maintenance: maint,
		Incidents:   incidents,
		Counts: StatusCounts{
			ComponentsTotal:     healthy + degraded + unhealthy,
			ComponentsHealthy:   healthy,
			ComponentsDegraded:  degraded,
			ComponentsUnhealthy: unhealthy,
		},
	}
}

// Overall serves GET /api/v1/status.
func (h *StatusV1Handler) Overall(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, h.snapshot(r.Context()))
}

// Components serves GET /api/v1/status/components.
func (h *StatusV1Handler) Components(w http.ResponseWriter, r *http.Request) {
	snap := h.snapshot(r.Context())
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"generated_at": snap.GeneratedAt,
		"components":   snap.Components,
		"counts":       snap.Counts,
	})
}

// Resources serves GET /api/v1/status/resources.
func (h *StatusV1Handler) Resources(w http.ResponseWriter, r *http.Request) {
	snap := h.snapshot(r.Context())
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"generated_at": snap.GeneratedAt,
		"resources":    snap.Resources,
	})
}

// Incidents serves GET /api/v1/status/incidents only when the SPA is
// mounted without the full incidents subsystem (e.g. tests). When
// the real CRUD handler is wired into the router, that handler takes
// the route directly. Returns the active subset embedded in the
// snapshot so this stays useful as a fallback.
func (h *StatusV1Handler) Incidents(w http.ResponseWriter, r *http.Request) {
	snap := h.snapshot(r.Context())
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{
		"generated_at": snap.GeneratedAt,
		"incidents":    snap.Incidents,
	})
}

// Uptime serves GET /api/v1/status/uptime?window=...
//
// Until per-component heartbeat history lands, the percentage is derived
// from the *current* snapshot. Operators who need real per-window
// uptime should graph the Prometheus counters in the meantime — the
// `historical_source` field signals which is in play so dashboards
// don't silently draw the wrong line.
func (h *StatusV1Handler) Uptime(w http.ResponseWriter, r *http.Request) {
	window := strings.TrimSpace(r.URL.Query().Get("window"))
	if window == "" {
		window = "30d"
	}
	if !isValidUptimeWindow(window) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid window — use one of: 24h, 7d, 30d, 90d, 1y")
		return
	}
	snap := h.snapshot(r.Context())
	total := snap.Counts.ComponentsTotal
	healthy := snap.Counts.ComponentsHealthy
	pct := 100.0
	if total > 0 {
		pct = float64(healthy) / float64(total) * 100.0
	}
	httpx.WriteJSON(w, http.StatusOK, StatusUptimeWindow{
		Window:           window,
		UptimePercent:    pct,
		HealthyCount:     healthy,
		TotalCount:       total,
		GeneratedAt:      snap.GeneratedAt,
		HistoricalSource: "current_snapshot",
		Note:             "Per-window uptime requires the heartbeat history backend (planned). This value reflects the current snapshot only.",
	})
}

// Live serves GET /api/v1/status/live as a Server-Sent Events stream.
// Pushes a `status` event with the full StatusSnapshot at connect time
// and every push interval thereafter. Heartbeat events are emitted
// independently every 25s so reverse proxies don't garbage-collect the
// connection mid-flight.
func (h *StatusV1Handler) Live(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	pushInterval := statusV1LivePushInterval()
	heartbeat := 25 * time.Second

	send := func() bool {
		snap := h.snapshot(r.Context())
		buf, err := json.Marshal(snap)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "event: status\ndata: %s\n\n", buf); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	if !send() {
		return
	}

	pushTicker := time.NewTicker(pushInterval)
	defer pushTicker.Stop()
	hbTicker := time.NewTicker(heartbeat)
	defer hbTicker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-pushTicker.C:
			if !send() {
				return
			}
		case <-hbTicker.C:
			if _, err := fmt.Fprintf(w, "event: heartbeat\ndata: {\"time\":\"%s\"}\n\n", time.Now().UTC().Format(time.RFC3339)); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// statusV1LivePushInterval is exposed as a function (rather than a const)
// so tests can dial it down. Default mirrors the SPA's polling cadence —
// once SSE is wired the SPA stops polling, but the cadence stays the
// same so external graphs don't change resolution.
var statusV1LivePushIntervalOverride struct {
	mu sync.Mutex
	d  time.Duration
}

func statusV1LivePushInterval() time.Duration {
	statusV1LivePushIntervalOverride.mu.Lock()
	defer statusV1LivePushIntervalOverride.mu.Unlock()
	if statusV1LivePushIntervalOverride.d > 0 {
		return statusV1LivePushIntervalOverride.d
	}
	return 30 * time.Second
}

// SetStatusV1LivePushInterval is a test hook. Pass 0 to restore default.
func SetStatusV1LivePushInterval(d time.Duration) {
	statusV1LivePushIntervalOverride.mu.Lock()
	defer statusV1LivePushIntervalOverride.mu.Unlock()
	statusV1LivePushIntervalOverride.d = d
}

func isValidUptimeWindow(s string) bool {
	switch s {
	case "24h", "7d", "30d", "90d", "1y":
		return true
	}
	return false
}
