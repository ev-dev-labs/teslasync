package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/go-chi/chi/v5/middleware"
)

// Re-export metrics for use within the api package. Other packages should
// import internal/metrics directly.
var (
	// Telemetry
	TelemetrySignalsProcessed   = metrics.TelemetrySignalsProcessed
	TelemetryMessagesReceived   = metrics.TelemetryMessagesReceived
	TelemetryProcessingDuration = metrics.TelemetryProcessingDuration
	ActiveStreamingVehicles     = metrics.ActiveStreamingVehicles

	// Sessions
	DriveSessionsActive     = metrics.DriveSessionsActive
	DriveSessionsCompleted  = metrics.DriveSessionsCompleted
	ChargeSessionsActive    = metrics.ChargeSessionsActive
	ChargeSessionsCompleted = metrics.ChargeSessionsCompleted

	// Database
	DBQueryDuration      = metrics.DBQueryDuration
	DBConnectionPoolSize = metrics.DBConnectionPoolSize
	DBTransactionsTotal  = metrics.DBTransactionsTotal

	// Alerts
	AlertsEvaluated   = metrics.AlertsEvaluated
	AlertsFired       = metrics.AlertsFired
	NotificationsSent = metrics.NotificationsSent

	// API
	APIErrors          = metrics.APIErrors
	TeslaAPICallsTotal = metrics.TeslaAPICallsTotal

	// Vehicles
	VehiclesRegistered = metrics.VehiclesRegistered
	VehicleStateGauge  = metrics.VehicleStateGauge

	// Geocoding
	GeocodingTotal           = metrics.GeocodingTotal
	GeocodingDuration        = metrics.GeocodingDuration
	AddressBackfillRemaining = metrics.AddressBackfillRemaining
	AddressBackfillCompleted = metrics.AddressBackfillCompleted

	// Connections
	SSEConnectionsActive = metrics.SSEConnectionsActive
	SSEEventsSent        = metrics.SSEEventsSent
	SSEEventsDropped     = metrics.SSEEventsDropped
	SSEConnectionsTotal  = metrics.SSEConnectionsTotal
	SSEBroadcastDuration = metrics.SSEBroadcastDuration
	SSEBytesSent         = metrics.SSEBytesSent

	// Auth
	AuthAttempts   = metrics.AuthAttempts
	TokenRefreshes = metrics.TokenRefreshes

	// Business
	TotalDistanceKm = metrics.TotalDistanceKm
	TotalEnergyKwh  = metrics.TotalEnergyKwh
	TotalDrives     = metrics.TotalDrives
	TotalCharges    = metrics.TotalCharges
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

		metrics.HTTPRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
		metrics.HTTPRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
		metrics.HTTPResponseSize.WithLabelValues(r.Method, path).Observe(float64(ww.BytesWritten()))
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
	case strings.HasPrefix(path, "/api/v1/automations/webhook/"):
		return "/api/v1/automations/webhook/:token"
	default:
		return path
	}
}
