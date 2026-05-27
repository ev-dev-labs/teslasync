package router

import (
	"context"
	"sync"
	"testing"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
)

// Phase-10 router tracing contract:
//
//   - Router.Route emits exactly ONE tesla.router.route span per call.
//   - The span carries `field`, `destination`, `outcome`,
//     `dual_log_write` attributes.
//   - The span is a CHILD of the caller's parent ctx (no new root).
//   - The router propagates `write.role={primary,dual}` via a private
//     ctx-key (writeRoleCtxKey) that the writers package reads through
//     the exported WriteRoleFromContext helper. Writers are NOT
//     instrumented in this test (they're nopWriters) — we read the
//     role directly off the ctx the router passed.
//   - When the primary destination is NOT signal_log / unit_history
//     AND a signal_log writer is registered, the dual-write happens.

// roleRecordingWriter is a Writer fake that records the write.role
// marker present on the ctx the router invokes it with. Used to assert
// the router stamps primary on the primary-destination call AND dual
// on the secondary signal_log call.
type roleRecordingWriter struct {
	mu        sync.Mutex
	roles     []string
	fields    []string
	callCount int
}

func (w *roleRecordingWriter) Write(ctx context.Context, atomic codec.Atomic, dst Entry) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.roles = append(w.roles, WriteRoleFromContext(ctx))
	w.fields = append(w.fields, atomic.Field)
	w.callCount++
	return nil
}

// installSpanRecorder swaps the global TracerProvider for a
// tracetest.SpanRecorder and restores it on cleanup. Returns the
// recorder for span inspection.
func installSpanRecorder(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(tp)
	t.Cleanup(func() { otel.SetTracerProvider(prev) })
	return rec
}

// TestPhase10_RouterEmitsRouteSpanWithDualWriteRoles asserts the
// full router span contract for a representative hot-table route:
//   - tesla.router.route is a child of the parent ctx span,
//   - the primary writer receives write.role=primary on its ctx,
//   - the dual signal_log writer receives write.role=dual on its ctx,
//   - the span stamps dual_log_write=true + outcome=ok.
func TestPhase10_RouterEmitsRouteSpanWithDualWriteRoles(t *testing.T) {
	rec := installSpanRecorder(t)

	// Stand up writers for every destination routing.yaml references
	// so New() succeeds, then swap in role-recording writers for the
	// two destinations we want to assert against.
	entries, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	writers := map[Destination]Writer{}
	for _, e := range entries {
		if e.Destination == DestDrop {
			continue
		}
		if _, ok := writers[e.Destination]; !ok {
			writers[e.Destination] = nopWriter{}
		}
	}

	primary := &roleRecordingWriter{}
	secondary := &roleRecordingWriter{}
	writers[DestChargingTelemetry] = primary
	writers[DestSignalLog] = secondary

	r, err := New(writers)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// Synthesise the upstream mqtt.consume → normalize.process_atomics
	// span chain the same way production does, so we can assert
	// tesla.router.route inherits the trace_id.
	ctx, root := otel.Tracer("mqtt").Start(context.Background(), "mqtt.consume")
	rootTraceID := root.SpanContext().TraceID()

	// BatteryHeaterOn routes to charging_telemetry per routing.yaml,
	// which is NOT signal_log / unit_history, so the dual-write to
	// signal_log fires.
	if err := r.Route(ctx, codec.Atomic{Field: "BatteryHeaterOn", Value: true}); err != nil {
		t.Fatalf("Route: %v", err)
	}
	root.End()

	if primary.callCount != 1 {
		t.Fatalf("primary writer call count = %d, want 1", primary.callCount)
	}
	if secondary.callCount != 1 {
		t.Fatalf("secondary signal_log writer call count = %d, want 1 "+
			"(dual-write should fire for non-signal_log primaries)", secondary.callCount)
	}
	if got := primary.roles[0]; got != "primary" {
		t.Errorf("primary writer ctx write.role = %q, want \"primary\"", got)
	}
	if got := secondary.roles[0]; got != "dual" {
		t.Errorf("secondary writer ctx write.role = %q, want \"dual\"", got)
	}

	// Span tree assertions.
	spans := rec.Ended()
	var routeSpan, rootSpan sdktrace.ReadOnlySpan
	for _, s := range spans {
		switch s.Name() {
		case "tesla.router.route":
			routeSpan = s
		case "mqtt.consume":
			rootSpan = s
		}
	}
	if routeSpan == nil {
		t.Fatalf("missing tesla.router.route span; recorded: %v", spanNames(spans))
	}
	if rootSpan == nil {
		t.Fatalf("missing mqtt.consume span; recorded: %v", spanNames(spans))
	}
	if routeSpan.SpanContext().TraceID() != rootTraceID {
		t.Errorf("tesla.router.route trace_id = %s, want %s (parent's)",
			routeSpan.SpanContext().TraceID(), rootTraceID)
	}
	if routeSpan.Parent().SpanID() != rootSpan.SpanContext().SpanID() {
		t.Errorf("tesla.router.route parent span_id = %s, want %s "+
			"(must be a child of the caller's span, NOT a new root)",
			routeSpan.Parent().SpanID(), rootSpan.SpanContext().SpanID())
	}

	attrs := map[string]any{}
	for _, kv := range routeSpan.Attributes() {
		attrs[string(kv.Key)] = kv.Value.AsInterface()
	}
	if got := attrs["field"]; got != "BatteryHeaterOn" {
		t.Errorf("tesla.router.route field = %v, want \"BatteryHeaterOn\"", got)
	}
	if got := attrs["destination"]; got != "charging_telemetry" {
		t.Errorf("tesla.router.route destination = %v, want \"charging_telemetry\"", got)
	}
	if got := attrs["dual_log_write"]; got != true {
		t.Errorf("tesla.router.route dual_log_write = %v, want true", got)
	}
	if got := attrs["outcome"]; got != "ok" {
		t.Errorf("tesla.router.route outcome = %v, want \"ok\"", got)
	}
}

// TestPhase10_RouterNoRouteSpanCarriesNoRouteOutcome asserts the
// span's outcome attribute when ErrNoRoute is returned: the span
// ends with outcome=no_route + records the error.
func TestPhase10_RouterNoRouteSpanCarriesNoRouteOutcome(t *testing.T) {
	rec := installSpanRecorder(t)

	// routing.yaml is populated so we need a writer for every
	// destination it references; the unknown sentinel will short-
	// circuit on the lookup miss before any writer is invoked.
	entries, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	writers := map[Destination]Writer{}
	for _, e := range entries {
		if e.Destination == DestDrop {
			continue
		}
		if _, ok := writers[e.Destination]; !ok {
			writers[e.Destination] = nopWriter{}
		}
	}
	r, err := New(writers)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	_ = r.Route(context.Background(), codec.Atomic{Field: "TotallyUnknownPhase10Sentinel"})

	spans := rec.Ended()
	var routeSpan sdktrace.ReadOnlySpan
	for _, s := range spans {
		if s.Name() == "tesla.router.route" {
			routeSpan = s
			break
		}
	}
	if routeSpan == nil {
		t.Fatalf("missing tesla.router.route span; recorded: %v", spanNames(spans))
	}
	attrs := map[string]any{}
	for _, kv := range routeSpan.Attributes() {
		attrs[string(kv.Key)] = kv.Value.AsInterface()
	}
	if got := attrs["outcome"]; got != "no_route" {
		t.Errorf("tesla.router.route outcome = %v, want \"no_route\"", got)
	}
	if routeSpan.Status().Code.String() != "Error" {
		t.Errorf("tesla.router.route status = %s, want Error", routeSpan.Status().Code)
	}
}

func spanNames(spans []sdktrace.ReadOnlySpan) []string {
	out := make([]string, 0, len(spans))
	for _, s := range spans {
		out = append(out, s.Name())
	}
	return out
}
