package api

import (
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// Observability contract:
//   - Inbound API requests are traced once at the global chi middleware boundary
//     by TracingMiddleware via otelhttp.NewHandler.
//   - Outbound HTTP clients must wrap their RoundTripper with
//     otelhttp.NewTransport. Exceptions must be documented at the call site and
//     are limited to non-request operational probes such as local healthchecks
//     and Prometheus scrape clients.

// LoggerMiddleware logs HTTP requests using zerolog.
func LoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		defer func() {
			duration := time.Since(start)
			status := ww.Status()

			// Add response time header for API consumers
			ww.Header().Set("X-Response-Time", fmt.Sprintf("%dms", duration.Milliseconds()))

			logger := log.Info()
			if status >= 500 {
				logger = log.Error()
			} else if status >= 400 {
				logger = log.Warn()
			}
			logger.
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", status).
				Int("bytes", ww.BytesWritten()).
				Dur("duration", duration).
				Str("ip", r.RemoteAddr).
				Str("request_id", chimw.GetReqID(r.Context())).
				Msg("http request")
		}()

		next.ServeHTTP(ww, r)
	})
}

// RecoveryMiddleware catches panics in HTTP handlers and returns a 500 response
// with structured error logging including stack traces.
func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := string(debug.Stack())
				log.Error().
					Str("method", r.Method).
					Str("path", r.URL.Path).
					Str("request_id", chimw.GetReqID(r.Context())).
					Str("stack", stack).
					Str("panic", fmt.Sprintf("%v", rec)).
					Msg("panic recovered in HTTP handler")

				writeError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// TracingMiddleware adds OpenTelemetry spans to HTTP requests.
// When tracing is not initialized, otelhttp uses the noop provider with zero overhead.
func TracingMiddleware(next http.Handler) http.Handler {
	return otelhttp.NewHandler(next, "http.request",
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return fmt.Sprintf("%s %s", r.Method, r.URL.Path)
		}),
	)
}

func tracedTransport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return otelhttp.NewTransport(base)
}
