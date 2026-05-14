package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/ev-dev-labs/teslasync/internal/resilience"
)

// ---------------------------------------------------------------------------
// Outbound api_call_logs sink registry (Phase 38 / Prompt 13)
//
// Several handlers in package api (system_handler, notification_handler,
// devtools_handler) need to make outbound HTTP calls that should be
// recorded into api_call_logs alongside inbound traffic. They cannot accept
// the sink as a constructor argument because their entry points are loose
// http.HandlerFunc factories, so the sink lives here as package-level
// state. cmd/teslasync/main.go calls SetOutboundSink once at startup; per-
// call construction in each handler reads the current value via
// currentOutboundSink() when constructing httputil.NewClient.
//
// Disabled mode (cfg.APILogs.Enabled=false) installs a nil sink, which
// httputil.LoggedTransport tolerates — the call still flows zerolog logs.
// ---------------------------------------------------------------------------

var (
	apiOutboundSinkMu sync.RWMutex
	apiOutboundSink   httputil.APICallSink
)

// SetOutboundSink installs the package-level APICallSink consumed by every
// outbound HTTP client constructed inside package api (system_handler.go,
// notification_handler.go, devtools_handler.go). main.go calls this once
// after constructing the inbound async writer's adapter; passing nil
// reverts to the no-sink default (zerolog only).
func SetOutboundSink(sink httputil.APICallSink) {
	apiOutboundSinkMu.Lock()
	apiOutboundSink = sink
	apiOutboundSinkMu.Unlock()
}

// currentOutboundSink returns the most recently installed sink under the
// shared RWMutex so per-call helpers in sibling handler files build their
// httputil.NewClient with the latest wiring.
func currentOutboundSink() httputil.APICallSink {
	apiOutboundSinkMu.RLock()
	defer apiOutboundSinkMu.RUnlock()
	return apiOutboundSink
}

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
			// Phase-46 / Prompt 70 — surface the GDPR / ePrivacy
			// cookie-consent flag so the SPA knows whether to mount
			// its consent banner and whether to gate optional
			// reporters (web vitals, error reporter) on user
			// consent. False on every default deployment.
			"require_cookie_consent": cfg != nil && cfg.RequireCookieConsent,
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
				"current":          "unknown",
				"latest":           "unknown",
				"update_available": false,
				"message":          "HELM_CHART_VERSION not set",
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
		client := httputil.NewClient(httputil.ClientConfig{
			Name:          "github-releases",
			Timeout:       5 * time.Second,
			Sink:          currentOutboundSink(),
			EnableLogging: true,
		})
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

// WorkersHealthHandler checks the health of background worker services.
//
// Multi-instance support
// ----------------------
// Each worker (notification, export, automation) can be horizontally
// scaled. The handler discovers per-instance hosts in this order:
//
//  1. *_HOSTS (plural, comma-separated) — explicit list of hostnames.
//     Example: NOTIFICATION_WORKER_HOSTS="nw-1,nw-2,nw-3".
//  2. *_HOST (singular, comma-separated also accepted) — backward
//     compatible with single-host deployments. A comma-separated value
//     is split here too so operators can extend without renaming.
//  3. Built-in default (single hostname matching the docker-compose
//     service name).
//
// Each instance is probed independently and emitted as its own
// WorkerStatus row sharing the worker name. The frontend groups by
// name and renders per-instance status. Probes run sequentially;
// at 3s timeout × ~3 workers × ~3 instances worst case the total
// stays well under the panel's 30s refresh cadence.
func WorkersHealthHandler() http.HandlerFunc {
	type workerStatus struct {
		Name    string `json:"name"`
		Host    string `json:"host"`
		Status  string `json:"status"`
		Latency int64  `json:"latency_ms"`
		Error   string `json:"error,omitempty"`
	}

	envOrDefault := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}

	// resolveHosts honours the *_HOSTS plural override and also accepts
	// a comma-separated value in the singular *_HOST for forward
	// compatibility. Returns at least one entry (the fallback).
	resolveHosts := func(pluralKey, singularKey, fallback string) []string {
		raw := os.Getenv(pluralKey)
		if raw == "" {
			raw = envOrDefault(singularKey, fallback)
		}
		out := make([]string, 0, 2)
		seen := make(map[string]struct{})
		for _, part := range strings.Split(raw, ",") {
			h := strings.TrimSpace(part)
			if h == "" {
				continue
			}
			if _, dup := seen[h]; dup {
				continue
			}
			seen[h] = struct{}{}
			out = append(out, h)
		}
		if len(out) == 0 {
			out = append(out, fallback)
		}
		return out
	}

	type workerProbe struct {
		name string
		url  string
	}

	buildProbes := func(name, hostsKey, hostKey, hostFallback, portKey, portFallback string) []workerProbe {
		port := envOrDefault(portKey, portFallback)
		hosts := resolveHosts(hostsKey, hostKey, hostFallback)
		out := make([]workerProbe, 0, len(hosts))
		for _, host := range hosts {
			out = append(out, workerProbe{
				name: name,
				url:  fmt.Sprintf("http://%s:%s/healthz", host, port),
			})
		}
		return out
	}

	return func(w http.ResponseWriter, r *http.Request) {
		// Resolve per-request so test goroutines and operators changing
		// env at runtime see fresh values. Cost is trivial — three env
		// lookups + a slice walk.
		probes := make([]workerProbe, 0, 6)
		probes = append(probes,
			buildProbes("notification-worker",
				"NOTIFICATION_WORKER_HOSTS", "NOTIFICATION_WORKER_HOST", "notification-worker",
				"NOTIFICATION_WORKER_PORT", "8081")...)
		probes = append(probes,
			buildProbes("export-worker",
				"EXPORT_WORKER_HOSTS", "EXPORT_WORKER_HOST", "export-worker",
				"EXPORT_WORKER_PORT", "8082")...)
		probes = append(probes,
			buildProbes("automation-worker",
				"AUTOMATION_WORKER_HOSTS", "AUTOMATION_WORKER_HOST", "automation-worker",
				"AUTOMATION_WORKER_PORT", "8083")...)

		// system-dns-check is the prompt-mandated service name for this
		// per-call worker /healthz probe. The 3s timeout matches the
		// historical bare-client budget.
		client := httputil.NewClient(httputil.ClientConfig{
			Name:          "system-dns-check",
			Timeout:       3 * time.Second,
			Sink:          currentOutboundSink(),
			EnableLogging: true,
		})
		results := make([]workerStatus, len(probes))

		for i, wk := range probes {
			ws := workerStatus{Name: wk.name, Host: wk.url}
			start := time.Now()
			resp, err := client.Get(wk.url)
			ws.Latency = time.Since(start).Milliseconds()
			if err != nil {
				ws.Status = "down"
				ws.Error = err.Error()
			} else {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					ws.Status = "healthy"
				} else {
					ws.Status = "unhealthy"
					ws.Error = fmt.Sprintf("HTTP %d", resp.StatusCode)
				}
			}
			results[i] = ws
		}

		healthy := 0
		for _, ws := range results {
			if ws.Status == "healthy" {
				healthy++
			}
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"workers":       results,
			"total":         len(results),
			"healthy_count": healthy,
		})
	}
}

// MapConfigHandler returns the active map tile provider configuration.
// The frontend uses this to load the correct tile URLs.
func MapConfigHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		provider := "free" // CARTO/OSM/Esri (no key needed)
		apiKey := ""

		if cfg.GoogleMaps.APIKey != "" {
			provider = "google"
			apiKey = cfg.GoogleMaps.APIKey
		} else if cfg.AzureMaps.APIKey != "" {
			provider = "azure"
			apiKey = cfg.AzureMaps.APIKey
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"provider": provider,
			"api_key":  apiKey,
		})
	}
}
