package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// ── HTTP Metrics ───────────────────────────────────────────

var (
	httpRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "http_requests_total",
		Help:      "Total HTTP requests by method, path, and status code",
	}, []string{"method", "path", "status"})

	httpRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "http_request_duration_seconds",
		Help:      "HTTP request duration in seconds",
		Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5},
	}, []string{"method", "path"})

	httpResponseSize = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "http_response_size_bytes",
		Help:      "HTTP response size in bytes",
		Buckets:   []float64{100, 1000, 10000, 100000, 1000000},
	}, []string{"method", "path"})
)

// ── Telemetry Metrics ──────────────────────────────────────

var (
	TelemetrySignalsProcessed = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "telemetry_signals_processed_total",
		Help:      "Total telemetry signals processed by signal name",
	}, []string{"signal"})

	TelemetryMessagesReceived = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "telemetry_messages_received_total",
		Help:      "Total MQTT telemetry messages received",
	})

	TelemetryProcessingDuration = promauto.NewHistogram(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "telemetry_processing_duration_seconds",
		Help:      "Time to process a telemetry message batch",
		Buckets:   []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1},
	})

	ActiveStreamingVehicles = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "streaming_vehicles_active",
		Help:      "Number of vehicles currently streaming telemetry",
	})
)

// ── Session Metrics ────────────────────────────────────────

var (
	DriveSessionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "drive_sessions_active",
		Help:      "Number of currently active drive sessions",
	})

	DriveSessionsCompleted = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "drive_sessions_completed_total",
		Help:      "Total drive sessions completed",
	})

	ChargeSessionsActive = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "charge_sessions_active",
		Help:      "Number of currently active charge sessions",
	})

	ChargeSessionsCompleted = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "charge_sessions_completed_total",
		Help:      "Total charge sessions completed",
	})
)

// ── Database Metrics ───────────────────────────────────────

var (
	DBQueryDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "db_query_duration_seconds",
		Help:      "Database query duration by operation and table",
		Buckets:   []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 5},
	}, []string{"operation", "table"})

	DBConnectionPoolSize = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "db_pool_connections",
		Help:      "Database connection pool stats",
	}, []string{"state"})

	DBTransactionsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "db_transactions_total",
		Help:      "Total database transactions by result",
	}, []string{"result"})
)

// ── Backup Metrics (defined in internal/backup/processor.go to avoid circular imports) ──

// ── Alert Metrics ──────────────────────────────────────────

var (
	AlertsEvaluated = promauto.NewCounter(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "alerts_evaluated_total",
		Help:      "Total alert rule evaluations",
	})

	AlertsFired = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "alerts_fired_total",
		Help:      "Total alerts fired by severity",
	}, []string{"severity"})

	NotificationsSent = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "notifications_sent_total",
		Help:      "Total notifications sent by channel type and result",
	}, []string{"channel_type", "result"})
)

// ── API Error Metrics ──────────────────────────────────────

var (
	APIErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "api_errors_total",
		Help:      "Total API errors by error code and category",
	}, []string{"code", "category"})

	TeslaAPICallsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "tesla_api_calls_total",
		Help:      "Total Tesla Fleet API calls by endpoint and result",
	}, []string{"endpoint", "result"})
)

// ── Vehicle Metrics ────────────────────────────────────────

var (
	VehiclesRegistered = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "vehicles_registered",
		Help:      "Total number of registered vehicles",
	})

	VehicleStateGauge = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Name:      "vehicles_by_state",
		Help:      "Number of vehicles by state (online, asleep, offline, driving, charging)",
	}, []string{"state"})
)

// PrometheusMiddleware records HTTP request metrics.
func PrometheusMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		duration := time.Since(start).Seconds()
		status := strconv.Itoa(ww.Status())

		// Normalize path to avoid high-cardinality label explosion
		path := normalizePath(r.URL.Path)

		httpRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
		httpRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
		httpResponseSize.WithLabelValues(r.Method, path).Observe(float64(ww.BytesWritten()))
	})
}

// normalizePath replaces dynamic path segments with placeholders
// to prevent high-cardinality metric label explosion.
func normalizePath(path string) string {
	// Keep known static paths as-is, replace IDs in dynamic segments
	switch {
	case len(path) > 20 && path[:15] == "/api/v1/drives/":
		return "/api/v1/drives/:id"
	case len(path) > 22 && path[:17] == "/api/v1/charging/":
		return "/api/v1/charging/:id"
	case len(path) > 22 && path[:17] == "/api/v1/vehicles/":
		return "/api/v1/vehicles/:id"
	case len(path) > 24 && path[:19] == "/api/v1/geofences/":
		return "/api/v1/geofences/:id"
	case len(path) > 20 && path[:16] == "/api/v1/backup/":
		return "/api/v1/backup/:sub"
	default:
		return path
	}
}
