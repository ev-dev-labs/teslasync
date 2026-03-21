package api

import (
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/mqtt"
	"github.com/teslasync/teslasync/internal/resilience"
	"github.com/teslasync/teslasync/internal/tesla"
	"github.com/teslasync/teslasync/internal/worker"
)

var startTime = time.Now()

// HealthHandler returns a simple health check.
func HealthHandler(db *database.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := db.Health(r.Context()); err != nil {
			writeError(w, http.StatusServiceUnavailable, "database unhealthy")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
}

// ReadyHandler checks if the service is ready (DB + Tesla auth).
func ReadyHandler(db *database.DB, tc *tesla.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		checks := map[string]string{}

		if err := db.Health(r.Context()); err != nil {
			checks["database"] = "unhealthy"
		} else {
			checks["database"] = "ok"
		}

		if tc.HasValidToken() {
			checks["tesla_auth"] = "ok"
		} else {
			checks["tesla_auth"] = "no_token"
		}

		for _, v := range checks {
			if v != "ok" && v != "no_token" {
				writeJSON(w, http.StatusServiceUnavailable, checks)
				return
			}
		}
		writeJSON(w, http.StatusOK, checks)
	}
}

// SystemStatusHandler returns detailed system health for the frontend resilience dashboard.
func SystemStatusHandler(db *database.DB, tc *tesla.Client, mqttClient *mqtt.Client, health *resilience.HealthMonitor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		components := health.GetStatus()
		overall := health.OverallStatus()

		// Enriched component statuses with live checks
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

		// MQTT connectivity check
		mqttStatus := "disabled"
		if mqttClient != nil {
			if mqttClient.IsConnected() {
				mqttStatus = "connected"
				health.RecordSuccess("mqtt")
			} else {
				mqttStatus = "disconnected"
				health.RecordFailure("mqtt", fmt.Errorf("MQTT broker not connected"))
			}
		}

		type componentInfo struct {
			Status      string `json:"status"`
			ConsecFails int    `json:"consecutive_failures"`
			LastError   string `json:"last_error,omitempty"`
		}

		result := map[string]interface{}{
			"overall": overall.String(),
			"database": componentInfo{
				Status: dbStatus,
			},
			"tesla_api": componentInfo{
				Status: teslaStatus,
			},
			"mqtt": componentInfo{
				Status: mqttStatus,
			},
		}

		for name, comp := range components {
			if _, exists := result[name]; !exists {
				result[name] = componentInfo{
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
		writeJSON(w, statusCode, result)
	}
}

// ExtendedHealthCheck returns a detailed health check with per-component latency,
// pool stats, and system information.
func ExtendedHealthCheck(db *database.DB, health *resilience.HealthMonitor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		results := make(map[string]interface{})
		overall := "healthy"

		// Database check with latency
		dbStart := time.Now()
		var dbOk bool
		err := db.Pool.QueryRow(r.Context(), "SELECT 1").Scan(&dbOk)
		dbLatency := time.Since(dbStart)
		if err != nil {
			results["database"] = map[string]interface{}{"status": "unhealthy", "error": err.Error(), "latency_ms": dbLatency.Milliseconds()}
			overall = "degraded"
		} else {
			results["database"] = map[string]interface{}{"status": "healthy", "latency_ms": dbLatency.Milliseconds()}
		}

		// DB pool stats
		poolStats := db.Pool.Stat()
		results["database_pool"] = map[string]interface{}{
			"total_conns":    poolStats.TotalConns(),
			"idle_conns":     poolStats.IdleConns(),
			"acquired_conns": poolStats.AcquiredConns(),
		}

		// Component statuses from health monitor
		for name, comp := range health.GetStatus() {
			results[name] = map[string]interface{}{
				"status":               comp.Status.String(),
				"last_check":           comp.LastCheck,
				"consecutive_failures": comp.ConsecFails,
			}
			if comp.Status != resilience.StatusHealthy {
				overall = "degraded"
			}
		}

		// System info
		results["system"] = map[string]interface{}{
			"goroutines":     runtime.NumGoroutine(),
			"go_version":     runtime.Version(),
			"uptime_seconds": time.Since(startTime).Seconds(),
		}

		statusCode := http.StatusOK
		if overall != "healthy" {
			statusCode = http.StatusServiceUnavailable
		}

		writeJSON(w, statusCode, map[string]interface{}{
			"status":     overall,
			"components": results,
			"checked_at": time.Now(),
		})
	}
}

// MetricsHandler returns Prometheus metrics.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}

// APIUsageHandler returns Tesla API usage statistics for billing estimation.
func APIUsageHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		requestCount := tesla.GetAPIRequestCount()
		skippedPolls := worker.GetSkippedPolls()
		costPerRequest := 0.00222 // ~$10 / 4500 requests

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"total_requests":           requestCount,
			"skipped_polls":            skippedPolls,
			"estimated_cost":           float64(requestCount) * costPerRequest,
			"cost_per_request":         costPerRequest,
			"monthly_credit":           10.0,
			"estimated_remaining":      10.0 - float64(requestCount)*costPerRequest,
		})
	}
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

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"total_positions":      stats.Total,
			"compressed_positions": stats.Compressed,
			"estimated_saved_rows": savedRows,
			"estimated_saved_bytes": savedBytes,
		})
	}
}
