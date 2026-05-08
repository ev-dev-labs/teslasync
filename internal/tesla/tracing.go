// Package tesla — tracing helpers.
//
// Phase-44 / Prompt 0013: every exported method that initiates a Tesla
// Fleet API call, OAuth exchange, or Vehicle Command Proxy call opens an
// OpenTelemetry span so the entire car → Fleet API → DB hop is a single
// trace.
//
// Spans are produced by tracerName ("tesla") so a Tempo / Jaeger search
// for service.name=teslasync AND name~tesla.* surfaces every outbound
// Tesla interaction. The chokepoints (doRequest, doRequestWithToken,
// doProxyRequest, doProxyRequestWithResponse, tokenRequest) wrap the
// actual HTTP work; the per-method wrappers above them give a stable,
// human-readable parent span name for cross-trace navigation.
package tesla

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// tracerName is the OpenTelemetry tracer name used for every span emitted
// by this package. Operators search Tempo for `service.name=teslasync` and
// scope by tracer name = "tesla" to isolate Tesla-API + Fleet Telemetry
// activity from internal handler / DB work.
const tracerName = "tesla"

// teslaTracer returns the configured OpenTelemetry tracer for this
// package. We thread the lookup through a function (rather than a
// package-level var) so tests that swap the global TracerProvider via
// otel.SetTracerProvider take effect at call time, not at init time.
func teslaTracer() trace.Tracer {
	return otel.Tracer(tracerName)
}

// startSpan opens a child span of ctx. Callers MUST call endSpan with the
// same span and the operation's terminal error so failed Fleet API calls
// surface as red spans in the trace UI.
func startSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	opts := []trace.SpanStartOption{trace.WithSpanKind(trace.SpanKindClient)}
	if len(attrs) > 0 {
		opts = append(opts, trace.WithAttributes(attrs...))
	}
	return teslaTracer().Start(ctx, name, opts...)
}

// endSpan records err (if non-nil) on the span and ends it. Use as
// `defer endSpan(span, &err)` from methods whose return values include a
// named `err error` so the deferred read sees the final error value.
//
// For methods without a named error return, call endSpan(span, nil) on
// the success path and endSpan(span, errVal) on each error path
// explicitly.
func endSpan(span trace.Span, errPtr *error) {
	if errPtr != nil && *errPtr != nil {
		span.RecordError(*errPtr)
		span.SetStatus(codes.Error, (*errPtr).Error())
	}
	span.End()
}

// recordHTTPStatus tags a span with HTTP semantic-convention attributes
// and flips the span to Error status for 5xx responses (4xx is left as
// OK because client-induced errors aren't service failures from a SLO
// standpoint — they still get RecordError via endSpan when the caller
// returns a Go error to its parent).
func recordHTTPStatus(span trace.Span, method, url string, statusCode int) {
	span.SetAttributes(
		attribute.String("http.request.method", method),
		attribute.String("http.url", url),
	)
	if statusCode > 0 {
		span.SetAttributes(attribute.Int("http.response.status_code", statusCode))
		if statusCode >= 500 {
			span.SetStatus(codes.Error, "server error")
		}
	}
}
