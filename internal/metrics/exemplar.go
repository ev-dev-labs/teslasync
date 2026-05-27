// Package metrics — exemplar helper.
//
// Phase-44 / observability-batch / Prompt F3 — exemplar generalisation.
//
// internal/api/middleware.go already attaches a Prometheus exemplar (trace_id +
// span_id) to the RED HTTP latency histogram so operators can jump from a
// slow latency bar in Grafana straight to the trace in Jaeger/Tempo. This
// file generalises that pattern so every histogram observation in the
// codebase can opt in WITHOUT duplicating the exemplar plumbing or
// pretending it works when no span context is present.
//
// Usage (the only correct way to call this):
//
//	metrics.ObserveDurationWithExemplar(
//	    ctx,
//	    metrics.AlertRuleEvalDuration,           // *prometheus.Histogram
//	    time.Since(evalStart).Seconds(),
//	)
//
//	metrics.ObserveDurationWithExemplarVec(
//	    ctx,
//	    metrics.HTTPRequestDuration,             // *prometheus.HistogramVec
//	    []string{r.Method, normalizePath(r.URL.Path)},
//	    duration,
//	)
//
// The helper is intentionally narrow:
//
//   - It NEVER fabricates a span. If ctx carries no sampled span context the
//     call falls back to a plain Observe(). This matches the policy laid down
//     by the rubber-duck critique (observability-batch / R7): no faking
//     context.Background(); every exemplar must be traceable.
//
//   - It performs ONE type-assertion to prometheus.ExemplarObserver. The
//     client_golang histograms implement this interface today; the assertion
//     guards against a future swap that breaks the link silently.
//
//   - It exposes both a vec helper (the common case) and a non-vec helper
//     (for plain Histograms like AlertRuleEvalDuration).
//
// Prometheus must be started with --enable-feature=exemplar-storage for the
// exemplars to round-trip through the TSDB. The dev docker-compose wires this
// flag on the prometheus service; the K8s helm chart wires it via the
// prometheus-operator's `additionalArgs`. The link breaks silently if the
// flag is missing — see docs/runbooks/phase-44-metrics-conventions.md for the
// verification recipe.
package metrics

import (
	"context"

	"github.com/prometheus/client_golang/prometheus"
	"go.opentelemetry.io/otel/trace"
)

// exemplarLabels returns the trace+span identifiers from the active OTel
// span context when (and only when) the span is sampled. An unsampled span
// MUST NOT contribute an exemplar — the exemplar would point at a trace
// the collector will never store, breaking the "View trace" link in
// Grafana with a 404. Returns nil when no usable exemplar is available; the
// caller falls back to a plain Observe in that case.
func exemplarLabels(ctx context.Context) prometheus.Labels {
	if ctx == nil {
		return nil
	}
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() || !sc.IsSampled() {
		return nil
	}
	return prometheus.Labels{
		"trace_id": sc.TraceID().String(),
		"span_id":  sc.SpanID().String(),
	}
}

// ObserveDurationWithExemplar records a single value on h. When ctx carries
// a sampled OTel span, the trace_id+span_id are attached as a Prometheus
// exemplar so operators can pivot from a slow histogram bucket to the
// originating trace. Falls back to a plain Observe when no sampled span
// is present — this is the honest, deliberate behaviour.
//
// Safe to call from any goroutine; both prometheus.Histogram and
// ExemplarObserver are concurrency-safe.
func ObserveDurationWithExemplar(ctx context.Context, h prometheus.Histogram, value float64) {
	if h == nil {
		return
	}
	if labels := exemplarLabels(ctx); labels != nil {
		if ex, ok := h.(prometheus.ExemplarObserver); ok {
			ex.ObserveWithExemplar(value, labels)
			return
		}
	}
	h.Observe(value)
}

// ObserveDurationWithExemplarVec is the histogram-vec twin of
// ObserveDurationWithExemplar. It resolves the label tuple once and then
// follows the same exemplar/plain-observe branching policy.
//
// The labels argument is positional and MUST match the variable label order
// declared on the underlying HistogramVec. Mismatched arity returns silently
// — Prometheus surfaces the misuse via its own internal error counter rather
// than crashing the request, so a mistake here shows up as a missing series
// in Grafana, not a 500.
func ObserveDurationWithExemplarVec(ctx context.Context, h *prometheus.HistogramVec, labelValues []string, value float64) {
	if h == nil {
		return
	}
	obs, err := h.GetMetricWithLabelValues(labelValues...)
	if err != nil {
		// Label arity mismatch. There is no useful caller fallback — observing
		// against the wrong vec would corrupt unrelated series. Drop the
		// observation rather than guess.
		return
	}
	if labels := exemplarLabels(ctx); labels != nil {
		if ex, ok := obs.(prometheus.ExemplarObserver); ok {
			ex.ObserveWithExemplar(value, labels)
			return
		}
	}
	obs.Observe(value)
}
