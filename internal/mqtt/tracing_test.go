package mqtt

import (
	"context"
	"sync/atomic"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// installRecorder swaps the global TracerProvider for a tracetest-based
// SpanRecorder for the duration of the test, and restores the original
// provider via t.Cleanup. Returns the recorder so the test can read spans.
func installRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() {
		otel.SetTracerProvider(prev)
	})
	return rec
}

// fakePahoMessage implements pahomqtt.Message for tests so onPipelineMessage
// can be exercised without a live broker.
type fakePahoMessage struct {
	topic     string
	payload   []byte
	messageID uint16
	qos       byte
	acked     atomic.Int32
}

func (m *fakePahoMessage) Duplicate() bool   { return false }
func (m *fakePahoMessage) Qos() byte         { return m.qos }
func (m *fakePahoMessage) Retained() bool    { return false }
func (m *fakePahoMessage) Topic() string     { return m.topic }
func (m *fakePahoMessage) MessageID() uint16 { return m.messageID }
func (m *fakePahoMessage) Payload() []byte   { return m.payload }
func (m *fakePahoMessage) Ack()              { m.acked.Add(1) }

// ctxRecordingPipeline captures the context handed to Pipeline.ProcessAtomics
// so the test can assert that the consume span propagates as the parent span.
type ctxRecordingPipeline struct {
	ctx context.Context
}

func (p *ctxRecordingPipeline) ProcessAtomics(ctx context.Context, _ []codec.Atomic, _ int64) error {
	p.ctx = ctx
	return nil
}

// TestOnPipelineMessage_OpensConsumeSpan_PropagatesContext is the Phase-44
// prompt 0014 contract test:
//   - onPipelineMessage MUST open a span named "mqtt.consume".
//   - The span MUST carry attributes mqtt.topic and mqtt.message_size.
//   - The span MUST appear with SpanKind=Consumer.
//   - The ctx passed to Pipeline.ProcessAtomics MUST carry that span (so
//     downstream normalize / router / writer spans become children of
//     mqtt.consume).
//   - The span MUST be ended by the time the handler returns.
//   - The vehicle_id attribute MUST be set after VIN resolution.
func TestOnPipelineMessage_OpensConsumeSpan_PropagatesContext(t *testing.T) {
	rec := installRecorder(t)

	pipe := &ctxRecordingPipeline{}
	dlq := &fakeDLQ{}
	resolver := staticResolver(42)

	sub := newTestSubscriber(t, pipe, dlq, resolver)

	const wantTopic = "telemetry/5YJ3E1EA1LF000001/v/Soc"
	wantPayload := []byte("75.5") // valid JSON for the Soc float field
	msg := &fakePahoMessage{
		topic:     wantTopic,
		payload:   wantPayload,
		messageID: 7,
	}

	sub.onPipelineMessage(nil, msg)

	if msg.acked.Load() != 1 {
		t.Fatalf("message should be acked once after successful processing, got %d", msg.acked.Load())
	}

	if pipe.ctx == nil {
		t.Fatal("Pipeline.ProcessAtomics was not called or received nil context")
	}

	// Verify a span propagated to Pipeline.ProcessAtomics and points back at
	// the mqtt.consume span (same TraceID, valid SpanID).
	downstream := trace.SpanFromContext(pipe.ctx).SpanContext()
	if !downstream.IsValid() {
		t.Fatalf("expected a valid span on the context handed to Pipeline.ProcessAtomics, got invalid: %+v", downstream)
	}

	spans := rec.Ended()
	// Phase 10 added a codec.decode_json_field child span. The
	// mqtt.consume parent is still emitted exactly once — we look
	// it up by name now that the recorder captures the child too.
	// (mqtt.vin_resolve is only emitted when the resolver is wrapped
	// in a VINCache; the test injects a bare staticResolver so the
	// cache-level span is absent here.)
	var consume sdktrace.ReadOnlySpan
	var codecDecode sdktrace.ReadOnlySpan
	for _, s := range spans {
		switch s.Name() {
		case "mqtt.consume":
			consume = s
		case "codec.decode_json_field":
			codecDecode = s
		}
	}
	if consume == nil {
		t.Fatalf("expected an mqtt.consume span, got names: %v", spanNamesFromSpans(spans))
	}
	if codecDecode == nil {
		t.Fatalf("Phase 10: expected a codec.decode_json_field child span, got names: %v", spanNamesFromSpans(spans))
	}
	if codecDecode.Parent().SpanID() != consume.SpanContext().SpanID() {
		t.Fatalf("codec.decode_json_field parent span_id = %s, want %s (mqtt.consume)",
			codecDecode.Parent().SpanID(), consume.SpanContext().SpanID())
	}
	if consume.SpanKind() != trace.SpanKindConsumer {
		t.Fatalf("span kind = %v, want Consumer", consume.SpanKind())
	}
	if consume.SpanContext().TraceID() != downstream.TraceID() {
		t.Fatalf("Pipeline.ProcessAtomics ctx TraceID %s != mqtt.consume TraceID %s",
			downstream.TraceID(), consume.SpanContext().TraceID())
	}

	attrs := map[string]any{}
	for _, kv := range consume.Attributes() {
		attrs[string(kv.Key)] = kv.Value.AsInterface()
	}
	if got, ok := attrs["mqtt.topic"].(string); !ok || got != wantTopic {
		t.Errorf("mqtt.topic attribute = %v, want %q", attrs["mqtt.topic"], wantTopic)
	}
	if got, ok := attrs["mqtt.message_size"].(int64); !ok || got != int64(len(wantPayload)) {
		t.Errorf("mqtt.message_size attribute = %v, want %d", attrs["mqtt.message_size"], len(wantPayload))
	}
	if got, ok := attrs["mqtt.field"].(string); !ok || got != "Soc" {
		t.Errorf("mqtt.field attribute = %v, want %q", attrs["mqtt.field"], "Soc")
	}
	if got, ok := attrs["vehicle_id"].(int64); !ok || got != 42 {
		t.Errorf("vehicle_id attribute = %v, want 42", attrs["vehicle_id"])
	}
	if got, ok := attrs["mqtt.disposition"].(string); !ok || got != "ack" {
		t.Errorf("mqtt.disposition attribute = %v, want %q", attrs["mqtt.disposition"], "ack")
	}
}

// TestOnPipelineMessage_BadTopic_AckDropDisposition asserts that a topic that
// does not match {base}/{VIN}/v/{field} is annotated on the span as ack-drop.
func TestOnPipelineMessage_BadTopic_AckDropDisposition(t *testing.T) {
	rec := installRecorder(t)

	pipe := &ctxRecordingPipeline{}
	dlq := &fakeDLQ{}
	resolver := staticResolver(1)

	sub := newTestSubscriber(t, pipe, dlq, resolver)

	msg := &fakePahoMessage{
		topic:   "wrong/format",
		payload: []byte{0x01},
	}
	sub.onPipelineMessage(nil, msg)

	if pipe.ctx != nil {
		t.Fatal("Pipeline.ProcessAtomics must NOT be called for a bad topic")
	}
	if msg.acked.Load() != 1 {
		t.Fatalf("bad-topic message should be ack-dropped exactly once, got %d", msg.acked.Load())
	}

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected exactly 1 ended span, got %d", len(spans))
	}
	for _, kv := range spans[0].Attributes() {
		if string(kv.Key) == "mqtt.disposition" && kv.Value.AsString() == "ack-drop-bad-topic" {
			return
		}
	}
	t.Fatalf("expected mqtt.disposition=ack-drop-bad-topic on span attributes, got: %+v", spans[0].Attributes())
}

// spanNamesFromSpans returns the names of ended spans for use in
// diagnostic test failure messages.
func spanNamesFromSpans(spans []sdktrace.ReadOnlySpan) []string {
	out := make([]string, 0, len(spans))
	for _, s := range spans {
		out = append(out, s.Name())
	}
	return out
}
