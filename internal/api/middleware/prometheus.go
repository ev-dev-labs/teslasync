package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5/middleware"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// Prometheus records HTTP request metrics on the legacy
// {method,path,status} series declared in internal/metrics. Mutually
// exclusive with Metrics (RED) at the data layer — both are chained today
// during the migration window because both metric families are scraped
// by existing Grafana dashboards. See the metrics conventions runbook.
func Prometheus(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)

		duration := time.Since(start).Seconds()
		status := strconv.Itoa(ww.Status())

		path := normalizePath(r.URL.Path)

		metrics.HTTPRequestsTotal.WithLabelValues(r.Method, path, status).Inc()
		metrics.HTTPRequestDuration.WithLabelValues(r.Method, path).Observe(duration)
		metrics.HTTPResponseSize.WithLabelValues(r.Method, path).Observe(float64(ww.BytesWritten()))
	})
}

// normalizePath replaces dynamic path segments with placeholders
// to prevent high-cardinality metric label explosion. Used by both Prometheus
// (legacy series label) and routeLabel as the unrouted-path fallback.
func normalizePath(path string) string {
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
