package mqtt

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// installPropagatorAndRecorder is a thin wrapper around the existing
// installRecorder helper (tracing_test.go) that ALSO swaps in W3C
// TraceContext + Baggage propagators for the duration of the test —
// matching what internal/tracing.Init wires in production. The
// SpanRecorder cleanup is already registered by installRecorder.
func installPropagatorAndRecorder(t *testing.T) (*sdktrace.TracerProvider, oteltrace.Tracer) {
	t.Helper()
	_ = installRecorder(t)
	prevProp := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))
	t.Cleanup(func() { otel.SetTextMapPropagator(prevProp) })
	tp, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider)
	if !ok {
		t.Fatalf("expected SDK TracerProvider, got %T", otel.GetTracerProvider())
	}
	return tp, tp.Tracer("mqtt.propagation_test")
}

func TestInjectExtract_RoundTripPreservesTraceID(t *testing.T) {
	_, tracer := installPropagatorAndRecorder(t)

	publisherCtx, publisherSpan := tracer.Start(context.Background(), "publish")
	wantTraceID := publisherSpan.SpanContext().TraceID().String()

	payload := []byte(`{"job_id":"abc","type":"trip"}`)
	wrapped, err := InjectTraceContext(publisherCtx, payload)
	if err != nil {
		t.Fatalf("inject: %v", err)
	}
	if !strings.Contains(string(wrapped), `"_v":1`) {
		t.Fatalf("envelope missing version: %s", wrapped)
	}
	if !strings.Contains(string(wrapped), `"_trace"`) {
		t.Fatalf("envelope missing _trace: %s", wrapped)
	}

	consumerCtx, unwrapped := ExtractTraceContext(context.Background(), wrapped)
	if string(unwrapped) != string(payload) {
		t.Fatalf("payload mismatch:\ngot %s\nwant %s", unwrapped, payload)
	}
	gotSC := oteltrace.SpanContextFromContext(consumerCtx)
	if !gotSC.IsValid() {
		t.Fatalf("extracted span context is invalid")
	}
	if gotSC.TraceID().String() != wantTraceID {
		t.Fatalf("trace id mismatch: got %s want %s", gotSC.TraceID(), wantTraceID)
	}

	// End spans so the consumer-side child gets a parent that the test
	// can confirm carries the publisher's trace id.
	_, consumerSpan := tracer.Start(consumerCtx, "consume")
	consumerParent := oteltrace.SpanContextFromContext(consumerCtx).TraceID().String()
	consumerSpan.End()
	publisherSpan.End()
	if consumerParent != wantTraceID {
		t.Fatalf("consumer child parent trace id = %s, want %s", consumerParent, wantTraceID)
	}
}

func TestExtract_LegacyPassthroughOnMissingEnvelope(t *testing.T) {
	installPropagatorAndRecorder(t)

	raw := []byte(`{"job_id":"legacy","type":"trip"}`)
	ctx, unwrapped := ExtractTraceContext(context.Background(), raw)
	if string(unwrapped) != string(raw) {
		t.Fatalf("legacy payload mutated: got %s want %s", unwrapped, raw)
	}
	if sc := oteltrace.SpanContextFromContext(ctx); sc.IsValid() {
		t.Fatalf("legacy passthrough should not produce a remote span context, got %s", sc.TraceID())
	}
}

func TestExtract_NonJSONPassthrough(t *testing.T) {
	installPropagatorAndRecorder(t)

	raw := []byte("not even json")
	_, unwrapped := ExtractTraceContext(context.Background(), raw)
	if string(unwrapped) != string(raw) {
		t.Fatalf("non-JSON mutated: got %s want %s", unwrapped, raw)
	}
}

func TestExtract_MalformedEnvelopeFallsBackToRaw(t *testing.T) {
	installPropagatorAndRecorder(t)

	// Looks like JSON, parses as JSON, but the _trace value is wrong
	// shape (string instead of object). Unmarshal will fail; we must
	// passthrough.
	raw := []byte(`{"_v":1,"_trace":"oops","payload":{}}`)
	_, unwrapped := ExtractTraceContext(context.Background(), raw)
	if string(unwrapped) != string(raw) {
		t.Fatalf("malformed envelope mutated: got %s want %s", unwrapped, raw)
	}
}

func TestInject_NoActiveSpan_EmitsEnvelopeWithEmptyTrace(t *testing.T) {
	installPropagatorAndRecorder(t)

	payload := []byte(`{"x":1}`)
	wrapped, err := InjectTraceContext(context.Background(), payload)
	if err != nil {
		t.Fatalf("inject: %v", err)
	}
	if !strings.Contains(string(wrapped), `"_v":1`) {
		t.Fatalf("envelope missing version: %s", wrapped)
	}
	var env map[string]json.RawMessage
	if err := json.Unmarshal(wrapped, &env); err != nil {
		t.Fatalf("envelope not valid JSON: %v", err)
	}
	if _, ok := env["payload"]; !ok {
		t.Fatalf("envelope missing payload key: %s", wrapped)
	}
}
