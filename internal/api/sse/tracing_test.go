// Phase-44b — runtime smoke tests for SSE BroadcastWithContext span
// emission. Verifies that:
//
//  1. Every call to BroadcastWithContext produces exactly one sse.broadcast
//     span with the expected attributes (event_type, delivered/dropped counts).
//  2. The span is a child of the caller's ctx — i.e. parent linkage works
//     end-to-end so MQTT → normalize → SSE renders as one trace in Tempo.
//  3. The deprecated Broadcast shim still emits a root span (back-compat).
//
// Uses tracetest.SpanRecorder to capture spans in-memory without requiring
// an OTel collector. Each test restores the global TracerProvider via
// t.Cleanup so suites running in parallel don't leak state.
package sse

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func installTestTracerProvider(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(recorder),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		otel.SetTracerProvider(prev)
		_ = tp.Shutdown(context.Background())
	})
	return recorder
}

func TestEventHub_BroadcastWithContext_EmitsSSEBroadcastSpan(t *testing.T) {
	recorder := installTestTracerProvider(t)
	hub := NewEventHub()
	ch, unsub := hub.Subscribe("test-client")
	defer unsub()

	hub.BroadcastWithContext(context.Background(), "vehicle_update", map[string]int{"x": 1})

	select {
	case <-ch:
	default:
		t.Fatal("expected message on subscriber channel")
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 ended span, got %d", len(spans))
	}
	got := spans[0]
	if got.Name() != "sse.broadcast" {
		t.Errorf("span name = %q, want %q", got.Name(), "sse.broadcast")
	}
	attrs := got.Attributes()
	mustAttr := map[string]bool{
		"sse.event_type":         false,
		"sse.client_count":       false,
		"sse.delivered_count":    false,
		"sse.dropped_count":      false,
		"sse.message_size_bytes": false,
	}
	for _, a := range attrs {
		if _, ok := mustAttr[string(a.Key)]; ok {
			mustAttr[string(a.Key)] = true
		}
	}
	for k, present := range mustAttr {
		if !present {
			t.Errorf("missing attribute %q on sse.broadcast span", k)
		}
	}
}

func TestEventHub_BroadcastWithContext_NestsUnderParentSpan(t *testing.T) {
	recorder := installTestTracerProvider(t)
	hub := NewEventHub()

	parentCtx, parentSpan := otel.Tracer("test").Start(context.Background(), "parent.op")
	hub.BroadcastWithContext(parentCtx, "alert", map[string]string{"k": "v"})
	parentSpan.End()

	spans := recorder.Ended()
	if len(spans) != 2 {
		t.Fatalf("want 2 spans (sse.broadcast + parent.op), got %d", len(spans))
	}

	var child, parent sdktraceSpanLike
	for _, s := range spans {
		if s.Name() == "sse.broadcast" {
			child = s
		} else if s.Name() == "parent.op" {
			parent = s
		}
	}
	if child == nil || parent == nil {
		t.Fatal("missing one of the expected spans")
	}
	if child.Parent().SpanID() != parent.SpanContext().SpanID() {
		t.Errorf("sse.broadcast parent span ID = %s, want %s", child.Parent().SpanID(), parent.SpanContext().SpanID())
	}
	if child.SpanContext().TraceID() != parent.SpanContext().TraceID() {
		t.Errorf("trace id mismatch: child=%s parent=%s", child.SpanContext().TraceID(), parent.SpanContext().TraceID())
	}
}

func TestEventHub_DeprecatedBroadcast_EmitsRootSpan(t *testing.T) {
	recorder := installTestTracerProvider(t)
	hub := NewEventHub()

	hub.Broadcast("legacy_event", map[string]int{"x": 1})

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 ended span, got %d", len(spans))
	}
	got := spans[0]
	if got.Name() != "sse.broadcast" {
		t.Errorf("span name = %q, want %q", got.Name(), "sse.broadcast")
	}
	// Deprecated shim uses context.Background — span is a root (no parent).
	if got.Parent().IsValid() {
		t.Errorf("deprecated shim must emit root span; got parent %s", got.Parent().SpanID())
	}
}

// sdktraceSpanLike is the minimal interface the tests need; this avoids
// importing sdktrace.ReadOnlySpan in the test file's signatures while still
// keeping the assertions strongly typed.
type sdktraceSpanLike = sdktrace.ReadOnlySpan
