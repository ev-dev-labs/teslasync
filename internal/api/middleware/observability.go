package middleware

import (
	"context"
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// RED metrics (Rate / Errors / Duration) emitted exactly once per HTTP request
// by Metrics. Label vocabulary:
// - method: HTTP verb (GET/POST/...)
// - route: canonical chi route pattern (e.g. "/api/v1/drives/{driveID}")
// falls back to URL path when chi has no match (404 / unrouted).
// - status_class: "2xx" | "3xx" | "4xx" | "5xx" | "1xx"
//
// Names intentionally use the "red_" prefix so they coexist with the legacy
// HTTPRequestsTotal/HTTPRequestDuration counters declared in
// internal/metrics/metrics.go (which use {method,path,status} and remain to
// preserve backwards-compatible Grafana queries during the migration window).
// See the metrics conventions runbook for the full vocabulary.
var (
	redHTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "red_http_requests_total",
		Help:      "Total HTTP requests handled by the API (RED rate). Emitted by Metrics middleware exactly once per request. See docs/runbooks/phase-44-metrics-conventions.md.",
	}, []string{"method", "route", "status_class"})

	redHTTPRequestErrorsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Name:      "red_http_request_errors_total",
		Help:      "HTTP requests that ended with a 5xx response (RED errors). Emitted by Metrics middleware exactly once per request when status_class == 5xx.",
	}, []string{"method", "route", "status_class"})

	redHTTPRequestDurationSeconds = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "teslasync",
		Name:      "red_http_request_duration_seconds",
		Help:      "HTTP request latency in seconds (RED duration). Observed by Metrics middleware exactly once per request.",
		Buckets:   []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
	}, []string{"method", "route"})
)

// statusClass converts a HTTP status code to its RED bucket label
// (1xx/2xx/3xx/4xx/5xx). Codes outside the 100..599 range collapse to "5xx"
// so the cardinality of the status_class label is bounded to five values.
func statusClass(status int) string {
	switch {
	case status >= 500:
		return "5xx"
	case status >= 400:
		return "4xx"
	case status >= 300:
		return "3xx"
	case status >= 200:
		return "2xx"
	case status >= 100:
		return "1xx"
	default:
		return "5xx"
	}
}

// routeLabel returns the chi route pattern for the request (e.g.
// "/api/v1/drives/{driveID}") so high-cardinality URL paths collapse to a
// bounded set. When chi has no match (e.g. 404 before routing), it falls back
// to the existing normalizePath helper to keep cardinality bounded for
// unrouted traffic too.
func routeLabel(r *http.Request) string {
	if rc := chi.RouteContext(r.Context()); rc != nil {
		if pattern := rc.RoutePattern(); pattern != "" {
			return pattern
		}
	}
	return normalizePath(r.URL.Path)
}

// Metrics records the three RED metrics for every HTTP request:
//
// - http_requests_total{method,route,status_class} — counter
// - http_request_errors_total{method,route,status_class} — counter (5xx only)
// - http_request_duration_seconds{method,route} — histogram
//
// Wire this AFTER chi's RequestID/RealIP and AFTER any routing context
// initialisation so RoutePattern resolves. It is mutually exclusive with
// the legacy Prometheus middleware: chain only one to avoid double counting.
func Metrics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		defer func() {
			duration := time.Since(start).Seconds()
			route := routeLabel(r)
			class := statusClass(ww.Status())

			redHTTPRequestsTotal.WithLabelValues(r.Method, route, class).Inc()
			if class == "5xx" {
				redHTTPRequestErrorsTotal.WithLabelValues(r.Method, route, class).Inc()
			}
			observeDurationWithExemplar(r.Context(), r.Method, route, duration)
		}()

		next.ServeHTTP(ww, r)
	})
}

// observeDurationWithExemplar records a duration sample on the RED latency
// histogram and, when the active OTel span is sampled, attaches the trace ID
// as a Prometheus exemplar so operators can jump from a slow histogram bucket
// straight to the trace in Tempo/Jaeger. Falls back to a plain Observe when
// no sampled span context is present.
//
// Requires Prometheus to be started with --enable-feature=exemplar-storage so
// the server retains exemplars in the TSDB and exposes them on /api/v1/query;
// see the metrics conventions runbook.
func observeDurationWithExemplar(ctx context.Context, method, route string, duration float64) {
	obs, err := redHTTPRequestDurationSeconds.GetMetricWithLabelValues(method, route)
	if err != nil {
		return
	}
	sc := trace.SpanContextFromContext(ctx)
	if sc.IsValid() && sc.IsSampled() {
		if exObs, ok := obs.(prometheus.ExemplarObserver); ok {
			exObs.ObserveWithExemplar(duration, prometheus.Labels{
				"trace_id": sc.TraceID().String(),
				"span_id":  sc.SpanID().String(),
			})
			return
		}
	}
	obs.Observe(duration)
}

// Observability contract:
// - Inbound API requests are traced once at the global chi middleware boundary
// by Tracing middleware via otelhttp.NewHandler.
// - Outbound HTTP clients must wrap their RoundTripper with
// otelhttp.NewTransport. Exceptions must be documented at the call site and
// are limited to non-request operational probes such as local healthchecks
// and Prometheus scrape clients.

// Logger logs HTTP requests using zerolog.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)

		defer func() {
			duration := time.Since(start)
			status := ww.Status()

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

// Recovery catches panics in HTTP handlers and returns a 500 response
// with structured error logging including stack traces.
func Recovery(next http.Handler) http.Handler {
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

				httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// Tracing adds OpenTelemetry spans to HTTP requests.
// When tracing is not initialized, otelhttp uses the noop provider with zero overhead.
func Tracing(next http.Handler) http.Handler {
	// otelhttp cannot know chi's matched route until the downstream handler has
	// returned. Add it here after routing so Tempo's span-metrics generator gets
	// a bounded http.route dimension instead of a high-cardinality URL path.
	routeAware := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)

		route := routeLabel(r)
		span := trace.SpanFromContext(r.Context())
		span.SetName(fmt.Sprintf("%s %s", r.Method, route))
		span.SetAttributes(attribute.String("http.route", route))
	})

	return otelhttp.NewHandler(routeAware, "http.request",
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
			return fmt.Sprintf("%s %s", r.Method, normalizePath(r.URL.Path))
		}),
	)
}
