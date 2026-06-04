package writers

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
)

// writersTracerName is the OpenTelemetry tracer name used by every
// router.Writer implementation in this package. Spans are named
// tesla.writer.<destination> (e.g. tesla.writer.signal_log,
// tesla.writer.positions) so dashboards can group by destination
// regardless of the underlying writer struct.
const writersTracerName = "tesla.writers"

// startWriterSpan is the single helper every writer's Write method calls
// at its entry to emit a tesla.writer.<destination> child span. Returns
// the new ctx, the span (for attribute stamping inside the writer), and
// an end() closure that records error+status before End().
//
// Attributes set automatically:
//   - destination: the routing.yaml destination string (e.g. "signal_log")
//   - field:       the codec.Atomic.Field name
//   - write.role:  primary | dual (when the router propagated it via ctx;
//     omitted when called directly from a test)
//
// The writer is expected to ADD attributes that describe the DB
// operation it just performed:
//   - rows_affected: int64 from pgconn.CommandTag.RowsAffected
//   - column / value_kind / table: writer-specific shape attrs
//
// Span kind is Client because every Write call ultimately issues a SQL
// statement against the TimescaleDB pool — the network round-trip
// makes Client the semconv-appropriate kind.
func startWriterSpan(ctx context.Context, destination, field string) (context.Context, trace.Span, func(err error)) {
	role := router.WriteRoleFromContext(ctx)
	attrs := make([]attribute.KeyValue, 0, 3)
	attrs = append(attrs,
		attribute.String("destination", destination),
		attribute.String("field", field),
	)
	if role != "" {
		attrs = append(attrs, attribute.String("write.role", role))
	}
	ctx, span := otel.Tracer(writersTracerName).Start(
		ctx,
		"tesla.writer."+destination,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attrs...),
	)
	end := func(err error) {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "writer.write")
		}
		span.End()
	}
	return ctx, span, end
}
