package redaction

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// RedactingExporter is a SpanExporter decorator that applies the ADR-0074
// Redactor to every span before delegating to the wrapped exporter. Wrapping
// the exporter (rather than implementing a SpanProcessor) is the only place
// the Go SDK lets us rewrite span contents — OnEnd hands a read-only span —
// and it keeps the redaction symmetric across whatever exporter the provider
// is configured with (OTLP → collector → Tempo/Loki).
//
// Redaction is applied to every sensitive surface of the span, not just the
// top-level attributes: the span name, status description, event attributes
// and names, link attributes, and resource attributes are all scrubbed so a
// raw VIN / coordinate / token cannot escape via, e.g., an error message
// captured by span.RecordError or SetStatus.
//
// It is wired mandatorily in tracing.Init; there is no per-service opt-in,
// per ADR-0074's rejection of opt-in redaction.
type RedactingExporter struct {
	next     sdktrace.SpanExporter
	redactor *Redactor
}

// NewRedactingExporter wraps next so that all exported spans pass through r.
// If r is nil the decorator is a transparent pass-through.
func NewRedactingExporter(next sdktrace.SpanExporter, r *Redactor) *RedactingExporter {
	return &RedactingExporter{next: next, redactor: r}
}

// ExportSpans redacts each span and forwards to the wrapped exporter.
func (e *RedactingExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	if e.redactor == nil || len(spans) == 0 {
		return e.next.ExportSpans(ctx, spans)
	}
	wrapped := make([]sdktrace.ReadOnlySpan, len(spans))
	for i, s := range spans {
		wrapped[i] = e.redactor.redactSpan(s)
	}
	return e.next.ExportSpans(ctx, wrapped)
}

// Shutdown delegates to the wrapped exporter.
func (e *RedactingExporter) Shutdown(ctx context.Context) error {
	return e.next.Shutdown(ctx)
}

// redactSpan builds a redacted view of s. Every sensitive field is rewritten
// up front and served by the redactedSpan wrapper.
func (r *Redactor) redactSpan(s sdktrace.ReadOnlySpan) redactedSpan {
	return redactedSpan{
		ReadOnlySpan: s,
		name:         r.ScrubText(s.Name()),
		attrs:        r.RedactAttributes(s.Attributes()),
		status:       r.redactStatus(s.Status()),
		events:       r.redactEvents(s.Events()),
		links:        r.redactLinks(s.Links()),
		resource:     r.redactResource(s.Resource()),
	}
}

func (r *Redactor) redactStatus(st sdktrace.Status) sdktrace.Status {
	st.Description = r.ScrubText(st.Description)
	return st
}

func (r *Redactor) redactEvents(in []sdktrace.Event) []sdktrace.Event {
	if len(in) == 0 {
		return in
	}
	out := make([]sdktrace.Event, len(in))
	for i, ev := range in {
		ev.Name = r.ScrubText(ev.Name)
		ev.Attributes = r.RedactAttributes(ev.Attributes)
		out[i] = ev
	}
	return out
}

func (r *Redactor) redactLinks(in []sdktrace.Link) []sdktrace.Link {
	if len(in) == 0 {
		return in
	}
	out := make([]sdktrace.Link, len(in))
	for i, ln := range in {
		ln.Attributes = r.RedactAttributes(ln.Attributes)
		out[i] = ln
	}
	return out
}

// redactResource scrubs resource attributes. The resource is usually shared
// across many spans and contains mostly benign metadata (service.name,
// deployment.environment), but env- or process-derived attributes could carry
// a host/user identifier, so it is run through the same redactor for safety.
func (r *Redactor) redactResource(res *resource.Resource) *resource.Resource {
	if res == nil {
		return nil
	}
	attrs := res.Attributes()
	redacted := r.RedactAttributes(attrs)
	if sameAttributes(redacted, attrs) {
		return res
	}
	return resource.NewWithAttributes(res.SchemaURL(), redacted...)
}

// sameAttributes reports whether RedactAttributes returned the identical slice
// header it was given (the no-change fast path returns the input slice as-is,
// so a pointer/len comparison is sufficient).
func sameAttributes(a, b []attribute.KeyValue) bool {
	if len(a) != len(b) {
		return false
	}
	if len(a) == 0 {
		return true
	}
	return &a[0] == &b[0]
}

// redactedSpan wraps a ReadOnlySpan and serves redacted copies of every
// sensitive field. Methods not overridden here are promoted from the embedded
// span, so the exporter sees an otherwise-identical span. Embedding the
// interface (rather than re-implementing it) is what lets us satisfy the SDK's
// sealed ReadOnlySpan interface, which carries an unexported method.
type redactedSpan struct {
	sdktrace.ReadOnlySpan
	name     string
	attrs    []attribute.KeyValue
	status   sdktrace.Status
	events   []sdktrace.Event
	links    []sdktrace.Link
	resource *resource.Resource
}

func (s redactedSpan) Name() string                     { return s.name }
func (s redactedSpan) Attributes() []attribute.KeyValue { return s.attrs }
func (s redactedSpan) Status() sdktrace.Status          { return s.status }
func (s redactedSpan) Events() []sdktrace.Event         { return s.events }
func (s redactedSpan) Links() []sdktrace.Link           { return s.links }
func (s redactedSpan) Resource() *resource.Resource     { return s.resource }
