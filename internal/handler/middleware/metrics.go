package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/telemetry"
)

// Metrics returns middleware that records Prometheus RED metrics.
func Metrics(m *telemetry.Metrics) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			next.ServeHTTP(wrapped, r)

			duration := time.Since(start).Seconds()
			endpoint := r.URL.Path
			method := r.Method
			statusCode := strconv.Itoa(wrapped.statusCode)

			m.HTTPRequestsTotal.WithLabelValues(method, endpoint, statusCode).Inc()
			m.HTTPRequestDuration.WithLabelValues(method, endpoint).Observe(duration)
		})
	}
}
