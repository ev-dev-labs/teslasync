package teslapipeline

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// Runtime contract tests for the Tesla signal-ingest trace tree.
//
// These tests pair with the static cmd/trace-coverage-audit
// `tesla_signal_ingest_to_db` flow.
// The audit proves every required source file CONTAINS span creation
// code; these tests prove the SHAPE of the runtime trace tree by
// installing a tracetest.SpanRecorder, driving the observer with a
// real parent ctx, and asserting parent linkage + locked attributes.
//
// What this test asserts:
//
//  1. SideEffectsObserver.OnPayloadProcessed emits a parent
//     "observer.side_effects" span.
//  2. Each cross-cutting side-effect emits a NAMED child span:
//     signal.live_store.update_all, fsm.dispatch_signals,
//     signal.live_store.get_all, observer.vin_resolve,
//     sessions.process_signals_at, alerts.evaluate.
//  3. The 6 children are CHILDREN of observer.side_effects (parent
//     span_id matches), not peers. The implementation must use the ctx
//     returned by Start() for each child; reusing the original ctx would make
//     them peers.
//  4. observer.side_effects is itself a child of the synthesised
//     "mqtt.consume" parent we install at the call-site. This is
//     the end-to-end linkage proof: a real production trace from
//     mqtt.consume through to alerts.evaluate shares a single
//     trace_id and forms an unbroken parent-child chain.
//  5. The parent stamps vehicle_id + atomic_count attributes; each child stamps
//     vehicle_id + signal_count where applicable. No VIN and no raw values.

// installSpanRecorder swaps the global TracerProvider for a
// tracetest.SpanRecorder for the lifetime of the test. The Cleanup
// restores the previous provider so parallel tests don't fight over
// the global. The recorder is returned for span inspection.
func installSpanRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() { otel.SetTracerProvider(prev) })
	return rec
}

// This test verifies the end-to-end runtime trace shape for the
// SideEffectsObserver pipeline. See file-level godoc for the full assertion
// list.
func TestPhase10_ObserverEmitsParentAndSixChildren(t *testing.T) {
	rec := installSpanRecorder(t)

	obs, _, _, _, _, _, _ := newDefaultObserver(t)

	// Synthesize the "mqtt.consume" root span the same way the real
	// MQTT consumer does at internal/mqtt/mqtt.go::onPipelineMessage.
	// This lets us assert the entire observer subtree links back to
	// the same trace_id.
	ctx, rootSpan := otel.Tracer("mqtt").Start(context.Background(), "mqtt.consume")
	rootSpanID := rootSpan.SpanContext().SpanID()
	rootTraceID := rootSpan.SpanContext().TraceID()

	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 12.5, EmittedAt: time.Unix(1700000000, 0).UTC(), VehicleID: "VIN-A"},
		{Field: "BatteryHeaterOn", Value: true, EmittedAt: time.Unix(1700000001, 0).UTC(), VehicleID: "VIN-A"},
	}
	obs.OnPayloadProcessed(ctx, 42, atomics)

	rootSpan.End()

	spans := rec.Ended()
	// Index recorded spans by name for assertion convenience.
	byName := make(map[string]sdktrace.ReadOnlySpan, len(spans))
	for _, s := range spans {
		byName[s.Name()] = s
	}

	expectedChildren := []string{
		"signal.live_store.update_all",
		"fsm.dispatch_signals",
		"signal.live_store.get_all",
		"observer.vin_resolve",
		"sessions.process_signals_at",
		"alerts.evaluate",
	}
	requiredSpans := append([]string{"mqtt.consume", "observer.side_effects"}, expectedChildren...)
	for _, name := range requiredSpans {
		if _, ok := byName[name]; !ok {
			t.Errorf("missing required span %q; recorded spans: %v", name, spanNamesList(spans))
		}
	}
	if t.Failed() {
		return
	}

	// All recorded spans must share the trace_id of the root.
	for _, s := range spans {
		if s.SpanContext().TraceID() != rootTraceID {
			t.Errorf("span %q trace_id = %s, want %s (root); spans must inherit the mqtt.consume trace",
				s.Name(), s.SpanContext().TraceID(), rootTraceID)
		}
	}

	// observer.side_effects must be a child of mqtt.consume.
	parent := byName["observer.side_effects"]
	if got := parent.Parent().SpanID(); got != rootSpanID {
		t.Errorf("observer.side_effects parent span_id = %s, want %s (mqtt.consume); "+
			"the observer must NOT start a new root — it must inherit ctx",
			got, rootSpanID)
	}

	// All 6 cross-cutting children must be direct children of
	// observer.side_effects. Using the original ctx instead of the
	// parent-returned ctx makes the children peers, breaking the visual tree in
	// Tempo.
	parentSpanID := parent.SpanContext().SpanID()
	for _, name := range expectedChildren {
		child := byName[name]
		if got := child.Parent().SpanID(); got != parentSpanID {
			t.Errorf("span %q parent span_id = %s, want %s (observer.side_effects); "+
				"Decision #9 — use ctx RETURNED by Start(), not the original ctx",
				name, got, parentSpanID)
		}
	}

	// Parent attributes — atomic_count is observable directly,
	// signal_count is added post-reduce.
	parentAttrs := attrMap(parent)
	if got := parentAttrs["vehicle_id"]; got != int64(42) {
		t.Errorf("observer.side_effects vehicle_id = %v, want 42", got)
	}
	if got := parentAttrs["atomic_count"]; got != int64(2) {
		t.Errorf("observer.side_effects atomic_count = %v, want 2", got)
	}
	if got := parentAttrs["signal_count"]; got != int64(2) {
		t.Errorf("observer.side_effects signal_count = %v, want 2", got)
	}

	// VIN resolve span must report ok with the default fakeVINResolver
	// returning "VIN-DEFAULT".
	vinAttrs := attrMap(byName["observer.vin_resolve"])
	if got := vinAttrs["result"]; got != "ok" {
		t.Errorf("observer.vin_resolve result = %v, want \"ok\"", got)
	}
	if got := vinAttrs["sessions_alerts_skipped"]; got != false {
		t.Errorf("observer.vin_resolve sessions_alerts_skipped = %v, want false", got)
	}

	// PII guard: no VIN, no raw values, and no per-field lists in span attrs.
	for _, s := range spans {
		for _, kv := range s.Attributes() {
			k := string(kv.Key)
			switch k {
			case "vin", "vehicle_vin", "raw_value", "value", "field_list", "signals":
				t.Errorf("span %q stamps forbidden PII attr %q (Decision #5/#11)", s.Name(), k)
			}
		}
	}
}

// This test asserts the post-failure span tree: observer.vin_resolve records an
// error, sets sessions_alerts_skipped=true, and sessions.process_signals_at +
// alerts.evaluate are absent. The live_store and fsm spans still emit because
// they do not depend on VIN.
func TestPhase10_VINResolveFailureSkipsSessionsAndAlerts(t *testing.T) {
	rec := installSpanRecorder(t)

	live, fsm, sess, alerts, vin, bcast, _ := newFakeKit()
	vin.err = errVINLookupFailed // injected failure
	obs := New(Config{
		Live:         live,
		FSM:          fsm,
		Sessions:     sess,
		Alerts:       alerts,
		VINResolver:  vin,
		BroadcastSSE: bcast.call,
	})

	atomics := []codec.Atomic{
		{Field: "VehicleSpeed", Value: 25.0, EmittedAt: time.Unix(1700000000, 0).UTC()},
	}
	obs.OnPayloadProcessed(context.Background(), 99, atomics)

	spans := rec.Ended()
	names := spanNameSet(spans)
	mustHave := []string{
		"observer.side_effects",
		"signal.live_store.update_all",
		"fsm.dispatch_signals",
		"signal.live_store.get_all",
		"observer.vin_resolve",
	}
	for _, n := range mustHave {
		if !names[n] {
			t.Errorf("missing required span %q; got: %v", n, spanNamesList(spans))
		}
	}
	mustNotHave := []string{
		"sessions.process_signals_at",
		"alerts.evaluate",
	}
	for _, n := range mustNotHave {
		if names[n] {
			t.Errorf("unexpected span %q emitted after VIN lookup failure; "+
				"sessions + alerts must be skipped per Step 5 contract", n)
		}
	}

	// VIN span must carry result=error + skipped=true.
	var vinSpan sdktrace.ReadOnlySpan
	for _, s := range spans {
		if s.Name() == "observer.vin_resolve" {
			vinSpan = s
			break
		}
	}
	if vinSpan == nil {
		return
	}
	a := attrMap(vinSpan)
	if got := a["result"]; got != "error" {
		t.Errorf("observer.vin_resolve result = %v, want \"error\"", got)
	}
	if got := a["sessions_alerts_skipped"]; got != true {
		t.Errorf("observer.vin_resolve sessions_alerts_skipped = %v, want true", got)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// errVINLookupFailed is a sentinel error for the VIN failure path.
// Using a typed value rather than errors.New("...") inline avoids
// allocating a fresh error per test invocation and gives the lint
// "use ErrFoo" pattern a single target if other tests need to assert
// errors.Is.
var errVINLookupFailed = vinLookupErr("vin lookup failed (test)")

type vinLookupErr string

func (e vinLookupErr) Error() string { return string(e) }

func attrMap(s sdktrace.ReadOnlySpan) map[string]any {
	out := make(map[string]any, len(s.Attributes()))
	for _, kv := range s.Attributes() {
		out[string(kv.Key)] = kv.Value.AsInterface()
	}
	return out
}

func spanNamesList(spans []sdktrace.ReadOnlySpan) []string {
	names := make([]string, 0, len(spans))
	for _, s := range spans {
		names = append(names, s.Name())
	}
	return names
}

func spanNameSet(spans []sdktrace.ReadOnlySpan) map[string]bool {
	out := make(map[string]bool, len(spans))
	for _, s := range spans {
		out[s.Name()] = true
	}
	return out
}

// Compile-time guard that trace.SpanKindInternal is referenced so a
// future cleanup of unused imports leaves the OTel API hooked even
// when the test body shrinks.
var _ = trace.SpanKindInternal
