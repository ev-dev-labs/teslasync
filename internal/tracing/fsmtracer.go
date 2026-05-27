package tracing

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/fsm"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// NewFSMTracer returns a fsm.Tracer implementation backed by an OTel
// tracer named `name` (e.g., "fsm.vehicle", "fsm.charging"). The adapter
// is kept in internal/tracing rather than internal/domain/fsm because
// ADR-006 forbids OTel imports inside the domain layer.
//
// The adapter:
//   - Maps fsm.SpanEnder.End/SetAttribute/RecordError/SetStatus to the
//     equivalent OTel trace.Span operations.
//   - Converts the map[string]string attribute bag passed by the FSM
//     engine into []attribute.KeyValue at span-start time so the OTel
//     SDK can hash + intern them.
//   - Uses SpanKindInternal because FSM transitions are intra-process
//     state-machine evaluations, not messaging operations.
//
// Per-vehicle entity IDs may end up on these spans (via the FSM caller's
// attribute map). That is acceptable on spans; what is NOT acceptable is
// using vehicle_id as a Prometheus metric label (cardinality explosion).
// See observability.instructions.md and the engine.go ADR-008 reference.
func NewFSMTracer(name string) fsm.Tracer {
	return &fsmTracer{tracer: otel.Tracer(name)}
}

type fsmTracer struct {
	tracer oteltrace.Tracer
}

func (f *fsmTracer) StartSpan(ctx context.Context, name string, attrs map[string]string) (context.Context, fsm.SpanEnder) {
	startOpts := []oteltrace.SpanStartOption{
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
	}
	if len(attrs) > 0 {
		kvs := make([]attribute.KeyValue, 0, len(attrs))
		for k, v := range attrs {
			kvs = append(kvs, attribute.String(k, v))
		}
		startOpts = append(startOpts, oteltrace.WithAttributes(kvs...))
	}
	newCtx, span := f.tracer.Start(ctx, name, startOpts...)
	return newCtx, &fsmSpanEnder{span: span}
}

type fsmSpanEnder struct {
	span oteltrace.Span
}

func (s *fsmSpanEnder) End() {
	s.span.End()
}

func (s *fsmSpanEnder) SetAttribute(key, value string) {
	s.span.SetAttributes(attribute.String(key, value))
}

func (s *fsmSpanEnder) RecordError(err error) {
	if err == nil {
		return
	}
	// RecordException emits an exception event with stack trace; the
	// span itself remains "unset" status until the caller invokes
	// SetStatus. The FSM engine always calls SetStatus(StatusError, …)
	// immediately after RecordError on the failure paths.
	s.span.RecordError(err)
}

func (s *fsmSpanEnder) SetStatus(status fsm.SpanStatus, description string) {
	switch status {
	case fsm.StatusOk:
		s.span.SetStatus(codes.Ok, description)
	case fsm.StatusError:
		s.span.SetStatus(codes.Error, description)
	case fsm.StatusUnset:
		// Leave status as default. OTel treats unset as "no opinion"
		// which is the correct semantics when the FSM engine has not
		// explicitly classified the outcome.
	}
}
