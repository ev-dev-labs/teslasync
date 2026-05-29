package normalize

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

// normalizeTracerName is the OpenTelemetry tracer name for spans produced
// by the normalize pipeline. Pipeline.Process produces a parent
// "normalize.process" span with parse/route/write children and the
// normalize.duration_us, signal.count, vehicle_id, normalize.dropped, and
// normalize.errors attributes.
const normalizeTracerName = "normalize"

// startProcessSpan opens the parent span for Pipeline.Process or
// Pipeline.ProcessAtomics. The returned spanFinisher captures the per-batch
// counters via SetAttributes when stop() is invoked, so callers can update
// the counters lazily after the dispatch loop completes.
func startProcessSpan(ctx context.Context, name string, vehicleIntID int64) (context.Context, *batchSpan) {
	ctx, span := otel.Tracer(normalizeTracerName).Start(
		ctx,
		name,
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", vehicleIntID),
		),
	)
	return ctx, &batchSpan{span: span, start: time.Now()}
}

// batchSpan carries the parent normalize span plus the per-stage counters
// that the dispatch loop accumulates. The counters are stamped onto the
// span on stop() so a single defer at the top of Process / ProcessAtomics
// suffices.
type batchSpan struct {
	span        trace.Span
	start       time.Time
	signalCount int
	dropped     int
	errors      int
	err         error
}

func (b *batchSpan) addCounts(signalCount, dropped, errs int) {
	b.signalCount = signalCount
	b.dropped = dropped
	b.errors = errs
}

func (b *batchSpan) recordError(err error) {
	if err == nil {
		return
	}
	b.err = err
	b.span.RecordError(err)
	b.span.SetStatus(codes.Error, err.Error())
}

func (b *batchSpan) stop() {
	dur := time.Since(b.start)
	durUs := dur.Microseconds()
	b.span.SetAttributes(
		attribute.Int("signal.count", b.signalCount),
		attribute.Int64("normalize.duration_us", durUs),
		attribute.Int("normalize.dropped", b.dropped),
		attribute.Int("normalize.errors", b.errors),
	)
	b.span.End()
	// Publish instantaneous throughput so PromQL has a live value without
	// needing rate(). Empty and zero-duration batches are skipped to avoid
	// divide-by-zero / NaN.
	if b.signalCount > 0 && dur > 0 {
		throughput := float64(b.signalCount) / dur.Seconds()
		metrics.SetNormalizePipelineThroughput(throughput)
	}
}

// startChildSpan opens a child span with the given name inside the active
// normalize.process span. Use as: ctx, end := startChildSpan(ctx, "normalize.parse"); defer end().
func startChildSpan(ctx context.Context, name string) (context.Context, func()) {
	ctx, span := otel.Tracer(normalizeTracerName).Start(ctx, name, trace.WithSpanKind(trace.SpanKindInternal))
	return ctx, func() { span.End() }
}
