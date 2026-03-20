package api

import (
	"fmt"
	"net/http"
	"sync/atomic"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/teslasync/teslasync/internal/database"
	"github.com/teslasync/teslasync/internal/mqtt"
	"github.com/teslasync/teslasync/internal/resilience"
	"github.com/teslasync/teslasync/internal/tesla"
)

// startupComplete tracks whether the application has finished initialization.
var startupComplete atomic.Bool

// MarkStartupComplete should be called after DB migration and initial sync.
func MarkStartupComplete() {
	startupComplete.Store(true)
}

// IsStartupComplete returns whether the startup process is finished.
func IsStartupComplete() bool {
	return startupComplete.Load()
}

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

// ReadyHandler checks if the service is ready (startup complete + DB + Tesla auth).
func ReadyHandler(db *database.DB, tc *tesla.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !IsStartupComplete() {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"status": "not_ready",
				"reason": "startup in progress",
			})
			return
		}

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

// MetricsHandler returns Prometheus metrics.
func MetricsHandler() http.Handler {
	return promhttp.Handler()
}
