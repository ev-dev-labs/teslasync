package tracing

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// fsmTracerWithRecorder installs a temporary in-memory exporter and
// returns the recorder + cleanup. Cleanup restores the previous global
// TracerProvider so concurrent test packages cannot see each other's
// spans.
func fsmTracerWithRecorder(t *testing.T) (*tracetest.SpanRecorder, func()) {
	t.Helper()
	recorder := tracetest.NewSpanRecorder()
	prev := otel.GetTracerProvider()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	otel.SetTracerProvider(tp)
	return recorder, func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(prev)
	}
}

func TestFSMTracer_StartSpanCarriesAttributesAndKindInternal(t *testing.T) {
	recorder, cleanup := fsmTracerWithRecorder(t)
	defer cleanup()

	tracer := NewFSMTracer("fsm.test")
	_, span := tracer.StartSpan(context.Background(), "FSM.Fire", map[string]string{
		"fsm.name":          "vehicle",
		"fsm.current_state": "online",
		"fsm.event":         "start_drive",
	})
	span.SetAttribute("fsm.new_state", "driving")
	span.SetStatus(fsm.StatusOk, "")
	span.End()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 ended span, got %d", len(spans))
	}
	got := spans[0]
	if got.Name() != "FSM.Fire" {
		t.Fatalf("span name = %q, want FSM.Fire", got.Name())
	}
	if got.SpanKind() != oteltrace.SpanKindInternal {
		t.Fatalf("span kind = %v, want SpanKindInternal", got.SpanKind())
	}
	attrs := got.Attributes()
	wantKeys := map[string]string{
		"fsm.name":          "vehicle",
		"fsm.current_state": "online",
		"fsm.event":         "start_drive",
		"fsm.new_state":     "driving",
	}
	for _, kv := range attrs {
		want, ok := wantKeys[string(kv.Key)]
		if !ok {
			continue
		}
		if kv.Value.AsString() != want {
			t.Fatalf("attr %s = %q, want %q", kv.Key, kv.Value.AsString(), want)
		}
		delete(wantKeys, string(kv.Key))
	}
	if len(wantKeys) != 0 {
		t.Fatalf("missing expected attributes: %v", wantKeys)
	}
	if got.Status().Code != codes.Ok {
		t.Fatalf("status code = %v, want Ok", got.Status().Code)
	}
}

func TestFSMTracer_RecordErrorSetsExceptionEvent(t *testing.T) {
	recorder, cleanup := fsmTracerWithRecorder(t)
	defer cleanup()

	tracer := NewFSMTracer("fsm.test")
	_, span := tracer.StartSpan(context.Background(), "FSM.Fire", nil)
	span.RecordError(errors.New("guard rejected"))
	span.SetStatus(fsm.StatusError, "guard_rejected")
	span.End()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}
	got := spans[0]
	if got.Status().Code != codes.Error {
		t.Fatalf("status code = %v, want Error", got.Status().Code)
	}
	if got.Status().Description != "guard_rejected" {
		t.Fatalf("status description = %q, want guard_rejected", got.Status().Description)
	}
	events := got.Events()
	if len(events) != 1 {
		t.Fatalf("expected 1 exception event, got %d", len(events))
	}
	if events[0].Name != "exception" {
		t.Fatalf("event name = %q, want exception", events[0].Name)
	}
}

func TestFSMTracer_RecordErrorIgnoresNil(t *testing.T) {
	recorder, cleanup := fsmTracerWithRecorder(t)
	defer cleanup()

	tracer := NewFSMTracer("fsm.test")
	_, span := tracer.StartSpan(context.Background(), "FSM.Fire", nil)
	span.RecordError(nil)
	span.End()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}
	if events := spans[0].Events(); len(events) != 0 {
		t.Fatalf("expected 0 events for nil error, got %d", len(events))
	}
}

func TestFSMTracer_StatusUnsetIsNoOp(t *testing.T) {
	recorder, cleanup := fsmTracerWithRecorder(t)
	defer cleanup()

	tracer := NewFSMTracer("fsm.test")
	_, span := tracer.StartSpan(context.Background(), "FSM.Fire", nil)
	span.SetStatus(fsm.StatusUnset, "ignored")
	span.End()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}
	if code := spans[0].Status().Code; code != codes.Unset {
		t.Fatalf("status code = %v, want Unset", code)
	}
}
