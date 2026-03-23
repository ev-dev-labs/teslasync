package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// VersionHandler returns the application and Helm chart version.
func VersionHandler(appVersion string, cfg *config.Config) http.HandlerFunc {
	chartVersion := os.Getenv("HELM_CHART_VERSION")
	if chartVersion == "" {
		chartVersion = "unknown"
	}
	bootTime := time.Now()
	return func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]interface{}{
			"app_version":    appVersion,
			"chart_version":  chartVersion,
			"go_version":     runtime.Version(),
			"os":             runtime.GOOS,
			"arch":           runtime.GOARCH,
			"uptime_seconds": time.Since(bootTime).Seconds(),
			"goroutines":     runtime.NumGoroutine(),
		}

		// Endpoint configuration (read-only, from Helm/env)
		endpoints := map[string]string{}
		if v := os.Getenv("API_ENDPOINT"); v != "" {
			endpoints["api"] = v
		}
		if v := cfg.CORSOrigins; v != "" {
			endpoints["web"] = v
		}
		if v := cfg.Tesla.RedirectURI; v != "" {
			endpoints["oauth_callback"] = v
		}
		endpoints["tesla_api"] = cfg.Tesla.BaseURL
		resp["endpoints"] = endpoints

		writeJSON(w, http.StatusOK, resp)
	}
}

// UpdateCheckHandler checks whether a newer Helm chart version is available
// by querying the GitHub API for the latest release tag.
func UpdateCheckHandler() http.HandlerFunc {
	type updateCache struct {
		latest    string
		checkedAt time.Time
	}
	var cache *updateCache

	return func(w http.ResponseWriter, r *http.Request) {
		currentChart := os.Getenv("HELM_CHART_VERSION")
		if currentChart == "" {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"current":       "unknown",
				"latest":        "unknown",
				"update_available": false,
				"message":       "HELM_CHART_VERSION not set",
			})
			return
		}

		// Cache for 1 hour to avoid hammering GitHub API
		if cache != nil && time.Since(cache.checkedAt) < time.Hour {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"current":          currentChart,
				"latest":           cache.latest,
				"update_available": cache.latest != currentChart && cache.latest != "",
				"checked_at":       cache.checkedAt,
			})
			return
		}

		// Check GitHub releases
		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.Get("https://api.github.com/repos/ev-dev-labs/teslasync/releases/latest")
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"current":          currentChart,
				"latest":           "unknown",
				"update_available": false,
				"error":            fmt.Sprintf("failed to check: %v", err),
			})
			return
		}
		defer resp.Body.Close()

		var release struct {
			TagName string `json:"tag_name"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
			writeJSON(w, http.StatusOK, map[string]interface{}{
				"current":          currentChart,
				"latest":           "unknown",
				"update_available": false,
			})
			return
		}

		latest := release.TagName
		// Strip "v" prefix for comparison
		latestClean := latest
		if len(latestClean) > 0 && latestClean[0] == 'v' {
			latestClean = latestClean[1:]
		}

		cache = &updateCache{latest: latestClean, checkedAt: time.Now()}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"current":          currentChart,
			"latest":           latestClean,
			"update_available": latestClean != currentChart && latestClean != "",
			"checked_at":       cache.checkedAt,
		})
	}
}

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
