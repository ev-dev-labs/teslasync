package api

import (
	"context"
	"math"
	"net/http"
	"runtime"
	"sync"
	"time"

	apiadminmnt "github.com/ev-dev-labs/teslasync/internal/api/adminmaintenance"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	systemdb "github.com/ev-dev-labs/teslasync/internal/database/system"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/ops"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/sony/gobreaker"

	apisignal "github.com/ev-dev-labs/teslasync/internal/api/signalinspect"
)

// MaintenanceView is the resolved service-mode snapshot returned by the
// system-state provider closure passed into ExtendedHealthCheck. Source
// indicates which input "won" — "env" when the operator set
// TESLASYNC_SYSTEM_MODE, "db" when an admin POSTed to
// /admin/maintenance, "default" when neither is set. The SPA uses
// `source == "env"` to disable the admin-panel write controls.
type MaintenanceView = apiadminmnt.MaintenanceView

var startTime = time.Now()

// LivenessCheck is an optional process-local dependency check. It is reserved
// for failures a pod restart can repair; shared dependency outages belong in
// readiness or status endpoints to avoid restart storms.
type LivenessCheck struct {
	Component string
	Check     func() error
}

// HealthHandler returns a simple health check.
//
// It is the LIVENESS probe, so it is wrapped by the drain watchdog: a
// pod that latched the one-way drain but was never terminated would
// otherwise sit forever as "unready but alive" — invisible dead
// capacity that nothing restarts. See ops.ReadinessGate.GuardLiveness.
func HealthHandler(db *database.DB, extraChecks ...LivenessCheck) http.HandlerFunc {
	return ShutdownGate.GuardLiveness(StuckDrainBudget, nil)(func(w http.ResponseWriter, r *http.Request) {
		if err := db.Health(r.Context()); err != nil {
			writeError(w, http.StatusServiceUnavailable, "database unhealthy")
			return
		}
		for _, check := range extraChecks {
			if check.Check == nil {
				continue
			}
			if err := check.Check(); err != nil {
				writeError(w, http.StatusServiceUnavailable, check.Component+" unhealthy")
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
}

// ReadyHandler checks if the service is ready to serve traffic.
//
// The returned handler is wrapped by a package-level [ReadinessGate] so
// that once the preStop hook has fired the endpoint answers 503
// unconditionally. Without that, the Pod keeps advertising itself as
// ready for the whole (asynchronous) endpoint-deregistration window and
// kube-proxy keeps routing new requests into a process that is shutting
// down.
func ReadyHandler(db *database.DB, tc *tesla.Client) http.HandlerFunc {
	return ShutdownGate.GuardReadiness(func(w http.ResponseWriter, r *http.Request) {
		checks := map[string]string{}

		if err := db.Health(r.Context()); err != nil {
			checks["database"] = "unhealthy"
		} else {
			checks["database"] = "ok"
		}

		// Check write circuit breaker — if open, DB writes are failing
		if db.WriteBreaker != nil {
			state := db.WriteBreaker.State()
			if state == gobreaker.StateOpen {
				checks["database_writes"] = "unhealthy"
			} else if state == gobreaker.StateHalfOpen {
				checks["database_writes"] = "degraded"
			} else {
				checks["database_writes"] = "ok"
			}
		}

		if tc.HasValidToken() {
			checks["tesla_auth"] = "ok"
		} else {
			checks["tesla_auth"] = "no_token"
		}

		for _, v := range checks {
			if v == "unhealthy" || v == "incomplete" {
				writeJSON(w, http.StatusServiceUnavailable, checks)
				return
			}
		}
		writeJSON(w, http.StatusOK, checks)
	})
}

// ShutdownGate is the process-wide readiness gate. The preStop hook
// (GET/POST /internal/flush on the ISOLATED internal drain listener, see
// internal/app/drain.go) flips it to draining; [ReadyHandler] then fails
// closed so Kubernetes removes this Pod from Service endpoints before
// the container is signalled.
var ShutdownGate = ops.NewReadinessGate()

// EndpointPropagationDelay is how long the preStop handler holds its
// response open after flipping the gate, giving the endpoint controller
// and every kube-proxy a chance to observe the failing readiness probe
// before the container receives SIGTERM.
//
// It is one term of the shutdown budget locked in
// ops/rollout/stages.yaml `shutdown` and asserted against
// terminationGracePeriodSeconds by TestShutdownBudgetFitsGracePeriod.
const EndpointPropagationDelay = 5 * time.Second

// StuckDrainBudget is how long a pod may sit drained before its LIVENESS
// probe starts failing.
//
// A real termination completes inside the shutdown budget (80s) and the
// container is gone, so this branch is unreachable during intentional
// shutdown. It only fires for a pod that latched the one-way drain and
// was then never terminated — an accidental preStop invocation, an
// operator curl, a bug — which would otherwise remain permanently
// unready, permanently alive, and permanently invisible. Generous
// headroom over the 80s budget keeps a slow-but-legitimate shutdown from
// tripping it.
const StuckDrainBudget = 3 * time.Minute

// DrainStatusHandler is the READ-ONLY drain contract mounted on the
// public router at /internal/drain-status.
//
// The mutating /internal/flush endpoint is deliberately NOT on this
// router: it is one-way and pod-fatal (permanent readiness 503, all SSE
// streams released), so a public route — or a post-deploy smoke probe —
// could take a healthy pod out of service. It lives on an isolated
// listener that no Service or Ingress targets; kubelet reaches it by
// dialling the pod IP directly.
func DrainStatusHandler(internalPort int) http.HandlerFunc {
	return ops.DrainStatusHandler(ShutdownGate, internalPort, EndpointPropagationDelay)
}

// teslaBreakerTimeout mirrors gobreaker.Settings.Timeout from
// tesla.NewClient — i.e. how long the breaker stays open before it tries
// a half-open probe. Held here as a constant so /system/status can
// surface an accurate breaker_reset_at without modifying the tesla
// client. Keep in sync with internal/tesla/client.go.
const teslaBreakerTimeout = 60 * time.Second

type systemStatusComponent struct {
	Status      string `json:"status"`
	ConsecFails int    `json:"consecutive_failures"`
	LastError   string `json:"last_error,omitempty"`
}

func mqttSystemStatus(mqttClient *mqtt.Client, components map[string]*resilience.Component) systemStatusComponent {
	if component, ok := components["mqtt"]; ok {
		return systemStatusComponent{
			Status:      component.Status.String(),
			ConsecFails: component.ConsecFails,
			LastError:   component.LastError,
		}
	}

	status := "disabled"
	if mqttClient != nil {
		status = "disconnected"
		if mqttClient.IsConnected() {
			status = "connected"
		}
	}
	return systemStatusComponent{Status: status}
}

// teslaBreakerObserver tracks the last open transition time of the Tesla
// circuit breaker so /system/status can compute an accurate
// breaker_reset_at without instrumenting the (vendored) gobreaker
// package. Embedded in the SystemStatusHandler closure so its lifetime
// matches the HTTP handler's.
type teslaBreakerObserver struct {
	mu        sync.Mutex
	lastState string
	openedAt  time.Time
}

// observe records the current state and returns the timestamp at which
// the breaker is expected to enter half-open and start probing the
// upstream again. Returns the zero time when the breaker is not open.
//
// timeout is the gobreaker.Settings.Timeout value — kept as a parameter
// so callers control the value (and tests can use a short window).
func (o *teslaBreakerObserver) observe(state string, now time.Time, timeout time.Duration) time.Time {
	o.mu.Lock()
	defer o.mu.Unlock()
	if state != o.lastState {
		if state == gobreaker.StateOpen.String() {
			o.openedAt = now
		}
		o.lastState = state
	}
	if state == gobreaker.StateOpen.String() && !o.openedAt.IsZero() {
		return o.openedAt.Add(timeout)
	}
	return time.Time{}
}

// SystemStatusHandler returns detailed system health for the frontend resilience dashboard.
func SystemStatusHandler(db *database.DB, tc *tesla.Client, mqttClient *mqtt.Client, health *resilience.HealthMonitor, cfg *config.Config) http.HandlerFunc {
	var (
		cacheMu  sync.Mutex
		cached   map[string]interface{}
		cachedAt time.Time
		cacheTTL = 10 * time.Second
	)

	// Tracks the Tesla circuit breaker's last open transition so the
	// /system/status response can advertise breaker_reset_at to the SPA.
	var teslaBreakerObs teslaBreakerObserver

	return func(w http.ResponseWriter, r *http.Request) {
		cacheMu.Lock()
		if cached != nil && time.Since(cachedAt) < cacheTTL {
			cacheMu.Unlock()
			writeJSON(w, http.StatusOK, cached)
			return
		}
		cacheMu.Unlock()

		components := health.GetStatus()
		overall := health.OverallStatus()
		dbStatus := "healthy"
		if err := db.Health(r.Context()); err != nil {
			dbStatus = "unhealthy"
			health.RecordFailure("database", err)
		} else {
			health.RecordSuccess("database")
		}

		teslaStatus := "no_token"
		if tc.HasValidToken() {
			teslaStatus = "authenticated"
		}
		cbState := tc.CircuitBreakerState()
		cbCounts := tc.CircuitBreakerCounts()
		mqttStatus := mqttSystemStatus(mqttClient, components)
		ftStatus := "disabled"
		ftDetails := map[string]interface{}{
			"enabled": false,
		}
		if cfg != nil && cfg.FleetTelemetry.Enabled {
			ftStatus = "enabled"
			ftDetails = map[string]interface{}{
				"enabled":           true,
				"host":              cfg.FleetTelemetry.Host,
				"port":              cfg.FleetTelemetry.Port,
				"endpoint":          "/api/v1/telemetry",
				"protocol":          "HTTP POST (JSON)",
				"supported_signals": apisignal.SubscribedSignals,
			}
		}

		// Surface breaker state and the reset window inside tesla_api so
		// the SPA's <RateLimitBanner> can show an
		// accurate countdown without polling a separate endpoint. The
		// existing top-level `circuit_breaker` block is kept for
		// backwards compatibility with consumers that already read it.
		breakerResetAt := teslaBreakerObs.observe(cbState, time.Now(), teslaBreakerTimeout)
		teslaInfo := map[string]interface{}{
			"status":  teslaStatus,
			"breaker": cbState,
		}
		if !breakerResetAt.IsZero() {
			teslaInfo["breaker_reset_at"] = breakerResetAt.UTC().Format(time.RFC3339)
		}

		result := map[string]interface{}{
			"overall": overall.String(),
			"database": systemStatusComponent{
				Status: dbStatus,
			},
			"tesla_api": teslaInfo,
			"mqtt":      mqttStatus,
			"fleet_telemetry": map[string]interface{}{
				"status":  ftStatus,
				"details": ftDetails,
			},
			"circuit_breaker": map[string]interface{}{
				"state":  cbState,
				"counts": cbCounts,
			},
		}

		for name, comp := range components {
			if _, exists := result[name]; !exists {
				result[name] = systemStatusComponent{
					Status:      comp.Status.String(),
					ConsecFails: comp.ConsecFails,
					LastError:   comp.LastError,
				}
			}
		}

		statusCode := http.StatusOK
		if overall == resilience.StatusUnhealthy {
			statusCode = http.StatusServiceUnavailable
		}
		cacheMu.Lock()
		cached = result
		cachedAt = time.Now()
		cacheMu.Unlock()

		writeJSON(w, statusCode, result)
	}
}

// ExtendedHealthCheck returns component latency, pool stats, and system metadata.
// Optional providers add telemetry buffer stats and the service-mode block
// so the SPA can render MaintenanceBanner without another round-trip.
func ExtendedHealthCheck(db *database.DB, health *resilience.HealthMonitor, bufferStats func() (int, int), systemState func(context.Context) MaintenanceView) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		results := make(map[string]interface{})
		dbStart := time.Now()
		var dbCheck int
		err := db.Pool.QueryRow(r.Context(), "SELECT 1").Scan(&dbCheck)
		dbLatency := time.Since(dbStart)
		if err != nil {
			results["database"] = map[string]interface{}{"status": "unhealthy", "error": err.Error(), "latency_ms": dbLatency.Milliseconds()}
		} else {
			results["database"] = map[string]interface{}{"status": "healthy", "latency_ms": dbLatency.Milliseconds()}
		}
		poolStatsMap := db.PoolStats()
		poolStatsMap["status"] = "healthy"
		results["database_pool"] = poolStatsMap
		if db.WriteBreaker != nil {
			counts := db.WriteBreaker.Counts()
			cbState := db.WriteBreaker.State().String()
			cbStatus := "healthy"
			if cbState == "half-open" {
				cbStatus = "degraded"
			} else if cbState == "open" {
				cbStatus = "unhealthy"
			}
			results["db_circuit_breaker"] = map[string]interface{}{
				"status":               cbStatus,
				"state":                cbState,
				"consecutive_failures": counts.ConsecutiveFailures,
				"total_failures":       counts.TotalFailures,
				"total_successes":      counts.TotalSuccesses,
			}
		}

		// Component statuses from health monitor — don't overwrite direct checks
		for name, comp := range health.GetStatus() {
			if _, exists := results[name]; !exists {
				results[name] = map[string]interface{}{
					"status":               comp.Status.String(),
					"last_check":           comp.LastCheck,
					"consecutive_failures": comp.ConsecFails,
				}
			}
		}
		if bufferStats != nil {
			driveBuf, chargeBuf := bufferStats()
			results["telemetry_buffers"] = map[string]interface{}{
				"status":          "healthy",
				"drive_buffered":  driveBuf,
				"charge_buffered": chargeBuf,
			}
		}
		results["system"] = map[string]interface{}{
			"status":         "healthy",
			"goroutines":     runtime.NumGoroutine(),
			"go_version":     runtime.Version(),
			"uptime_seconds": time.Since(startTime).Seconds(),
		}
		overall := "healthy"
		monitorStatus := health.OverallStatus()
		if monitorStatus == resilience.StatusDegraded {
			overall = "degraded"
		} else if monitorStatus == resilience.StatusUnhealthy {
			overall = "unhealthy"
		}
		if err != nil {
			overall = "degraded"
		}

		statusCode := http.StatusOK
		if overall != "healthy" {
			statusCode = http.StatusServiceUnavailable
		}

		body := map[string]interface{}{
			"status":     overall,
			"components": results,
			"checked_at": time.Now(),
			// Default service-mode block — overwritten below when systemState is wired.
			// Always emitted so SPA consumers can rely on the field's presence.
			"mode":   systemdb.SystemModeOK,
			"source": "default",
		}
		if systemState != nil {
			view := systemState(r.Context())
			body["mode"] = view.Mode
			body["source"] = view.Source
			if view.Message != "" {
				body["maintenance_message"] = view.Message
			}
			if view.Until != nil {
				body["maintenance_until"] = view.Until.UTC().Format(time.RFC3339)
			}
			if !view.UpdatedAt.IsZero() {
				body["maintenance_updated_at"] = view.UpdatedAt.UTC().Format(time.RFC3339)
			}
		}

		writeJSON(w, statusCode, body)
	}
}

// MetricsHandler returns Prometheus metrics.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// MetricsCatalogHandler returns a JSON catalog of all available Prometheus metrics.
// Helps users building dashboards discover what metrics TeslaSync exposes.
func MetricsCatalogHandler() http.HandlerFunc {
	type metricEntry struct {
		Name   string   `json:"name"`
		Type   string   `json:"type"`
		Help   string   `json:"help"`
		Labels []string `json:"labels,omitempty"`
	}

	catalog := []metricEntry{
		// App Info & Startup
		{Name: "teslasync_app_info", Type: "gauge", Help: "Application build information (always 1)", Labels: []string{"version", "go_version", "commit"}},
		{Name: "teslasync_uptime_seconds", Type: "gauge", Help: "Seconds since application startup"},
		{Name: "teslasync_migration_version", Type: "gauge", Help: "Current database migration version"},
		{Name: "teslasync_startup_duration_seconds", Type: "gauge", Help: "Time from process start to HTTP server ready"},

		// HTTP
		{Name: "teslasync_http_requests_total", Type: "counter", Help: "Total HTTP requests", Labels: []string{"method", "path", "status"}},
		{Name: "teslasync_http_request_duration_seconds", Type: "histogram", Help: "HTTP request duration in seconds", Labels: []string{"method", "path"}},
		{Name: "teslasync_http_response_size_bytes", Type: "histogram", Help: "HTTP response size in bytes", Labels: []string{"method", "path"}},

		// Telemetry
		{Name: "teslasync_telemetry_signals_processed_total", Type: "counter", Help: "Telemetry signals processed", Labels: []string{"signal"}},
		{Name: "teslasync_telemetry_messages_received_total", Type: "counter", Help: "MQTT telemetry messages received"},
		{Name: "teslasync_telemetry_processing_duration_seconds", Type: "histogram", Help: "Telemetry message batch processing time"},
		{Name: "teslasync_streaming_vehicles_active", Type: "gauge", Help: "Vehicles currently streaming telemetry"},

		// Sessions
		{Name: "teslasync_drive_sessions_active", Type: "gauge", Help: "Currently active drive sessions"},
		{Name: "teslasync_drive_sessions_completed_total", Type: "counter", Help: "Total completed drive sessions"},
		{Name: "teslasync_charge_sessions_active", Type: "gauge", Help: "Currently active charge sessions"},
		{Name: "teslasync_charge_sessions_completed_total", Type: "counter", Help: "Total completed charge sessions"},

		// Database
		{Name: "teslasync_db_query_duration_seconds", Type: "histogram", Help: "Database query duration", Labels: []string{"operation", "table"}},
		{Name: "teslasync_db_pool_connections", Type: "gauge", Help: "Database connection pool stats", Labels: []string{"state"}},
		{Name: "teslasync_db_transactions_total", Type: "counter", Help: "Database transactions", Labels: []string{"result"}},
		{Name: "teslasync_db_circuit_breaker_state", Type: "gauge", Help: "DB circuit breaker state: 0=closed, 1=half-open, 2=open", Labels: []string{"breaker"}},

		// Alerts & Notifications
		{Name: "teslasync_alerts_evaluated_total", Type: "counter", Help: "Total alert rule evaluations"},
		{Name: "teslasync_alerts_fired_total", Type: "counter", Help: "Alerts fired", Labels: []string{"severity"}},
		{Name: "teslasync_notifications_sent_total", Type: "counter", Help: "Notifications sent", Labels: []string{"channel_type", "result"}},

		// API
		{Name: "teslasync_api_errors_total", Type: "counter", Help: "API errors", Labels: []string{"code", "category"}},
		{Name: "teslasync_tesla_api_calls_total", Type: "counter", Help: "Tesla Fleet API calls", Labels: []string{"endpoint", "result"}},

		// Vehicles
		{Name: "teslasync_vehicles_registered", Type: "gauge", Help: "Total registered vehicles"},
		{Name: "teslasync_vehicles_by_state", Type: "gauge", Help: "Vehicles by state", Labels: []string{"state"}},

		// Geocoding
		{Name: "teslasync_geocoding_total", Type: "counter", Help: "Geocoding operations", Labels: []string{"result"}},
		{Name: "teslasync_geocoding_duration_seconds", Type: "histogram", Help: "Reverse geocoding API call duration"},
		{Name: "teslasync_address_backfill_remaining", Type: "gauge", Help: "Drives still needing address geocoding"},
		{Name: "teslasync_address_backfill_completed_total", Type: "counter", Help: "Addresses backfilled since startup"},

		// Connections
		{Name: "teslasync_mqtt_connected", Type: "gauge", Help: "MQTT broker connection state (1=connected, 0=disconnected)"},
		{Name: "teslasync_mqtt_messages_published_total", Type: "counter", Help: "MQTT messages published"},
		{Name: "teslasync_mqtt_reconnects_total", Type: "counter", Help: "MQTT reconnection attempts"},
		{Name: "teslasync_sse_connections_active", Type: "gauge", Help: "Active SSE client connections"},
		{Name: "teslasync_sse_events_sent_total", Type: "counter", Help: "SSE events sent", Labels: []string{"event_type"}},

		// Polling & Workers
		{Name: "teslasync_poll_cycle_duration_seconds", Type: "histogram", Help: "Vehicle poll cycle duration"},
		{Name: "teslasync_polls_total", Type: "counter", Help: "Vehicle polls", Labels: []string{"result"}},
		{Name: "teslasync_polls_saved_total", Type: "counter", Help: "Polls avoided by optimization", Labels: []string{"reason"}},
		{Name: "teslasync_export_jobs_total", Type: "counter", Help: "Export jobs", Labels: []string{"status"}},
		{Name: "teslasync_maintenance_runs_total", Type: "counter", Help: "Maintenance worker runs"},

		// Cache
		{Name: "teslasync_cache_operations_total", Type: "counter", Help: "Cache operations", Labels: []string{"cache", "result"}},
		{Name: "teslasync_cache_entries", Type: "gauge", Help: "Cache entry count", Labels: []string{"cache"}},
		{Name: "teslasync_cache_evictions_total", Type: "counter", Help: "Cache evictions", Labels: []string{"cache"}},

		// Auth & Security
		{Name: "teslasync_auth_attempts_total", Type: "counter", Help: "Authentication attempts", Labels: []string{"result"}},
		{Name: "teslasync_token_refreshes_total", Type: "counter", Help: "Tesla token refresh attempts", Labels: []string{"result"}},
		{Name: "teslasync_rate_limit_exceeded_total", Type: "counter", Help: "Rate limit exceeded", Labels: []string{"endpoint"}},

		// Data Freshness
		{Name: "teslasync_vehicle_last_seen_seconds", Type: "gauge", Help: "Seconds since last telemetry per vehicle", Labels: []string{"vehicle_id"}},
		{Name: "teslasync_signal_store_entries", Type: "gauge", Help: "Total entries in live signal store"},
		{Name: "teslasync_signal_flush_duration_seconds", Type: "histogram", Help: "Signal store flush to DB duration"},

		// Business
		{Name: "teslasync_total_distance_km", Type: "counter", Help: "Cumulative distance driven (km)"},
		{Name: "teslasync_total_energy_kwh", Type: "counter", Help: "Cumulative energy added (kWh)"},
		{Name: "teslasync_total_drives", Type: "counter", Help: "Lifetime completed drives"},
		{Name: "teslasync_total_charges", Type: "counter", Help: "Lifetime completed charge sessions"},
		{Name: "teslasync_geofence_events_total", Type: "counter", Help: "Geofence events", Labels: []string{"type"}},

		// Backup (from internal/backup/processor.go)
		{Name: "teslasync_backup_runs_total", Type: "counter", Help: "Backup runs", Labels: []string{"status", "provider"}},
		{Name: "teslasync_backup_duration_seconds", Type: "histogram", Help: "Backup duration"},
		{Name: "teslasync_backup_size_bytes", Type: "histogram", Help: "Backup size in bytes"},
	}

	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"total":   len(catalog),
			"metrics": catalog,
		})
	}
}

// APIUsageHandler returns Tesla API usage statistics for billing estimation.
// Queries the api_call_logs table for real request counts and calculates
// estimated costs based on the Tesla Fleet API pricing.
func APIUsageHandler(db *database.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		rows, err := db.Pool.Query(ctx, `
			SELECT http_method, endpoint, status_code
			FROM api_call_logs
			WHERE ts >= date_trunc('month', NOW())
			  AND service IN ('tesla-api', 'tesla-fleet')`)
		if err != nil {
			writeJSON(w, http.StatusOK, newAPIUsageSummary())
			return
		}
		defer rows.Close()

		summary := newAPIUsageSummary()
		for rows.Next() {
			var method, endpoint string
			var statusCode int
			if err := rows.Scan(&method, &endpoint, &statusCode); err != nil {
				writeJSON(w, http.StatusOK, newAPIUsageSummary())
				return
			}
			summary.add(method, endpoint, statusCode)
		}
		if rows.Err() != nil {
			writeJSON(w, http.StatusOK, newAPIUsageSummary())
			return
		}

		summary.complete()
		writeJSON(w, http.StatusOK, summary)
	}
}

const teslaMonthlyCreditUSD = 10.0

type apiUsageSummary struct {
	TotalRequests      int     `json:"total_requests"`
	SkippedPolls       int     `json:"skipped_polls"`
	EstimatedCost      float64 `json:"estimated_cost"`
	CostPerRequest     float64 `json:"cost_per_request"`
	MonthlyCredit      float64 `json:"monthly_credit"`
	EstimatedRemaining float64 `json:"estimated_remaining"`
}

func newAPIUsageSummary() *apiUsageSummary {
	return &apiUsageSummary{
		CostPerRequest:     tesla.EstimatedCostUSD(tesla.BudgetCategoryVehicleData),
		MonthlyCredit:      teslaMonthlyCreditUSD,
		EstimatedRemaining: teslaMonthlyCreditUSD,
	}
}

func (s *apiUsageSummary) add(method, endpoint string, statusCode int) {
	s.TotalRequests++
	if statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout {
		s.SkippedPolls++
	}
	charge := tesla.ClassifyBudgetCharge(method, endpoint)
	s.EstimatedCost += tesla.EstimatedCostUSD(charge.Category)
}

func (s *apiUsageSummary) complete() {
	if s.TotalRequests > 0 {
		s.CostPerRequest = s.EstimatedCost / float64(s.TotalRequests)
	}
	s.EstimatedRemaining = max(0, s.MonthlyCredit-s.EstimatedCost)
}

// CompressionStatsHandler returns position table statistics including
// total row count and how many rows have been compressed into hourly summaries.
func CompressionStatsHandler(db *database.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats, err := db.GetPositionStats(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get position stats")
			return
		}

		// Estimate storage savings: each uncompressed row ~200 bytes.
		// Compressed rows replaced N samples with 1, so savings ≈ (total_original - total_current).
		// We approximate original count as: total + compressed * (avg_samples_per_hour - 1).
		// A conservative estimate: ~6 samples/hour at 10-min polling.
		avgSamplesPerHour := 6
		estimatedOriginal := stats.Total + stats.Compressed*int64(avgSamplesPerHour-1)
		savedRows := estimatedOriginal - stats.Total
		savedBytes := savedRows * 200

		savingsPercent := 0.0
		if estimatedOriginal > 0 {
			savingsPercent = float64(savedRows) / float64(estimatedOriginal) * 100
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"total_positions":       stats.Total,
			"compressed_positions":  stats.Compressed,
			"estimated_saved_rows":  savedRows,
			"estimated_saved_bytes": savedBytes,
			"savings_percent":       math.Round(savingsPercent*100) / 100,
		})
	}
}
