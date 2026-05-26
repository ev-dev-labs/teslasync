package metrics

import (
	"context"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

// newTestHistogram returns a freshly-registered Histogram so tests do not
// collide with the package-level promauto registrations.
func newTestHistogram(t *testing.T) prometheus.Histogram {
	t.Helper()
	h := prometheus.NewHistogram(prometheus.HistogramOpts{
		Namespace: "test_exemplar",
		Name:      "h",
		Help:      "test",
		Buckets:   []float64{0.1, 1, 10},
	})
	return h
}

func newTestHistogramVec(t *testing.T) *prometheus.HistogramVec {
	t.Helper()
	return prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "test_exemplar",
		Name:      "hv",
		Help:      "test",
		Buckets:   []float64{0.1, 1, 10},
	}, []string{"l"})
}

// installSampledSpanCtx returns a context carrying a sampled span context.
// Uses an SDK TracerProvider with AlwaysSample so SpanContext.IsSampled()
// returns true — the exemplar policy explicitly filters out unsampled spans.
func installSampledSpanCtx(t *testing.T) (context.Context, trace.SpanContext) {
	t.Helper()
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
		sdktrace.WithSpanProcessor(sdktrace.NewSimpleSpanProcessor(tracetest.NewInMemoryExporter())),
	)
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })
	tracer := tp.Tracer("test")
	ctx, span := tracer.Start(context.Background(), "test-span")
	t.Cleanup(func() { span.End() })
	return ctx, span.SpanContext()
}

func collectExemplar(t *testing.T, c prometheus.Collector) *dto.Exemplar {
	t.Helper()
	ch := make(chan prometheus.Metric, 8)
	c.Collect(ch)
	close(ch)
	for m := range ch {
		var pb dto.Metric
		if err := m.Write(&pb); err != nil {
			t.Fatalf("metric.Write: %v", err)
		}
		if pb.Histogram == nil {
			continue
		}
		for _, b := range pb.Histogram.Bucket {
			if b.GetExemplar() != nil {
				return b.GetExemplar()
			}
		}
	}
	return nil
}

func TestObserveDurationWithExemplar_AttachesTraceIDWhenSpanIsSampled(t *testing.T) {
	h := newTestHistogram(t)
	ctx, sc := installSampledSpanCtx(t)

	ObserveDurationWithExemplar(ctx, h, 0.05)

	ex := collectExemplar(t, h)
	if ex == nil {
		t.Fatalf("expected an exemplar to be attached but found none")
	}
	got := labelsToMap(ex.GetLabel())
	if got["trace_id"] != sc.TraceID().String() {
		t.Errorf("trace_id: got %q want %q", got["trace_id"], sc.TraceID().String())
	}
	if got["span_id"] != sc.SpanID().String() {
		t.Errorf("span_id: got %q want %q", got["span_id"], sc.SpanID().String())
	}
}

func TestObserveDurationWithExemplar_FallsBackToPlainObserveWhenNoSpan(t *testing.T) {
	h := newTestHistogram(t)
	ObserveDurationWithExemplar(context.Background(), h, 0.05)
	if ex := collectExemplar(t, h); ex != nil {
		t.Errorf("expected no exemplar with empty ctx, got %+v", ex)
	}
}

func TestObserveDurationWithExemplar_FallsBackWhenSpanIsNotSampled(t *testing.T) {
	h := newTestHistogram(t)
	tp := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.NeverSample()))
	t.Cleanup(func() { _ = tp.Shutdown(context.Background()) })
	ctx, span := tp.Tracer("t").Start(context.Background(), "no-sample")
	t.Cleanup(func() { span.End() })

	ObserveDurationWithExemplar(ctx, h, 0.05)
	if ex := collectExemplar(t, h); ex != nil {
		t.Errorf("expected no exemplar for an unsampled span, got %+v", ex)
	}
}

func TestObserveDurationWithExemplar_NilHistogramIsNoop(t *testing.T) {
	// Must not panic.
	ObserveDurationWithExemplar(context.Background(), nil, 0.05)
}

func TestObserveDurationWithExemplarVec_AttachesExemplarOnCorrectLabels(t *testing.T) {
	hv := newTestHistogramVec(t)
	ctx, sc := installSampledSpanCtx(t)

	ObserveDurationWithExemplarVec(ctx, hv, []string{"a"}, 0.05)
	ObserveDurationWithExemplarVec(context.Background(), hv, []string{"b"}, 0.05)

	// HistogramVec exposes the parent Collector — iterate over all metrics
	// to find each series' exemplar.
	all := collectAllExemplars(t, hv)
	exA, hasA := all["a"]
	if !hasA || exA == nil {
		t.Fatalf("expected exemplar on series a, got: %+v", all)
	}
	if labelsToMap(exA.GetLabel())["trace_id"] != sc.TraceID().String() {
		t.Errorf("series a exemplar trace_id mismatch")
	}
	if exB, ok := all["b"]; ok && exB != nil {
		t.Errorf("expected no exemplar on series b (no span), got %+v", exB)
	}
}

func TestObserveDurationWithExemplarVec_WrongArityIsDropped(t *testing.T) {
	hv := newTestHistogramVec(t)
	// 2 values for 1-label vec — must NOT panic and MUST NOT observe.
	ObserveDurationWithExemplarVec(context.Background(), hv, []string{"a", "b"}, 0.05)
	all := collectAllExemplars(t, hv)
	for _, ex := range all {
		if ex != nil {
			t.Errorf("expected no exemplar on arity mismatch, got %+v", ex)
		}
	}
}

// collectAllExemplars walks every metric produced by c and returns the first
// exemplar found for each `l` label value. nil entries mean the series exists
// but has no exemplar (a plain Observe was recorded).
func collectAllExemplars(t *testing.T, c prometheus.Collector) map[string]*dto.Exemplar {
	t.Helper()
	ch := make(chan prometheus.Metric, 16)
	c.Collect(ch)
	close(ch)
	out := map[string]*dto.Exemplar{}
	for m := range ch {
		var pb dto.Metric
		if err := m.Write(&pb); err != nil {
			t.Fatalf("metric.Write: %v", err)
		}
		labels := labelsToMap(pb.GetLabel())
		key := labels["l"]
		if pb.Histogram == nil {
			continue
		}
		var found *dto.Exemplar
		for _, b := range pb.Histogram.Bucket {
			if b.GetExemplar() != nil {
				found = b.GetExemplar()
				break
			}
		}
		out[key] = found
	}
	return out
}

func labelsToMap(lps []*dto.LabelPair) map[string]string {
	m := make(map[string]string, len(lps))
	for _, lp := range lps {
		m[lp.GetName()] = lp.GetValue()
	}
	return m
}
