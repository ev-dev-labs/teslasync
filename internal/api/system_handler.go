package api

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// MigrationStatus returns the current database migration version.
func MigrationStatus(db *database.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var version uint
		var dirty bool
		err := db.Pool.QueryRow(r.Context(), "SELECT version, dirty FROM schema_migrations LIMIT 1").Scan(&version, &dirty)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"version": 0,
				"dirty":   false,
				"error":   err.Error(),
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"version": version,
			"dirty":   dirty,
		})
	}
}

// ConfigValidation checks that essential configuration values are set.
func ConfigValidation(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		issues := []string{}
		if cfg.Tesla.ClientID == "" {
			issues = append(issues, "TESLA_CLIENT_ID not set")
		}
		if cfg.Tesla.ClientSecret == "" {
			issues = append(issues, "TESLA_CLIENT_SECRET not set")
		}
		if cfg.Database.Host == "" {
			issues = append(issues, "DATABASE_HOST not set")
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"valid":  len(issues) == 0,
			"issues": issues,
		})
	}
}

// HealthHistoryHandler returns the last N health check snapshots.
func HealthHistoryHandler(health *resilience.HealthMonitor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		history := health.GetHealthHistory()
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"history": history,
			"count":   len(history),
		})
	}
}

// DegradedStatusHandler returns whether the system is in degraded mode.
func DegradedStatusHandler(health *resilience.HealthMonitor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		degraded := health.IsDegraded()
		overall := health.OverallStatus()
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"degraded": degraded,
			"overall":  overall.String(),
		})
	}
}
