package mqtt

import (
	"context"
	"encoding/json"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// withW3CPropagator installs the W3C TraceContext propagator globally for the
// duration of the test, restoring the previous one via t.Cleanup.
func withW3CPropagator(t *testing.T) {
	t.Helper()
	prev := otel.GetTextMapPropagator()
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() { otel.SetTextMapPropagator(prev) })
}

// startTracedContext begins a real span backed by an SDK tracer provider so
// trace.SpanContextFromContext returns a valid context. Returns the
// (ctx, end-func) pair; callers must defer the end func.
func startTracedContext(t *testing.T, name string) (context.Context, func()) {
	t.Helper()
	prev := otel.GetTracerProvider()
	tp := sdktrace.NewTracerProvider()
	otel.SetTracerProvider(tp)
	ctx, span := tp.Tracer("test").Start(context.Background(), name)
	return ctx, func() {
		span.End()
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(prev)
	}
}

func TestWrapJSONWithTraceContext_NoSpan_PassesThrough(t *testing.T) {
	t.Parallel()
	withW3CPropagator(t)
	in := []byte(`{"foo":"bar"}`)
	out := wrapJSONWithTraceContext(context.Background(), in)
	if string(out) != string(in) {
		t.Fatalf("expected pass-through when no span; got %s", out)
	}
}

func TestWrapJSONWithTraceContext_NilContext(t *testing.T) {
	t.Parallel()
	withW3CPropagator(t)
	in := []byte(`{"foo":"bar"}`)
	//nolint:staticcheck // SA1012: nil ctx is the explicit branch under test.
	out := wrapJSONWithTraceContext(nil, in)
	if string(out) != string(in) {
		t.Fatalf("expected pass-through for nil ctx; got %s", out)
	}
}

func TestWrapJSONWithTraceContext_WithSpan_EmbedsTraceparent(t *testing.T) {
	withW3CPropagator(t)
	ctx, end := startTracedContext(t, "publisher")
	defer end()

	in := []byte(`{"foo":"bar","n":1}`)
	out := wrapJSONWithTraceContext(ctx, in)
	if string(out) == string(in) {
		t.Fatalf("expected envelope wrap when span is active; got pass-through")
	}

	var env struct {
		TC      map[string]string `json:"_tc"`
		Payload json.RawMessage   `json:"payload"`
	}
	if err := json.Unmarshal(out, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if _, ok := env.TC["traceparent"]; !ok {
		t.Fatalf("expected traceparent in envelope; got %#v", env.TC)
	}
	if string(env.Payload) != string(in) {
		t.Fatalf("expected original payload preserved; got %s want %s", env.Payload, in)
	}
}

func TestUnwrapJSONTraceContext_NoEnvelope_PassesThrough(t *testing.T) {
	t.Parallel()
	withW3CPropagator(t)
	in := []byte(`{"foo":"bar"}`)
	out, _, had := unwrapJSONTraceContext(context.Background(), in)
	if had {
		t.Fatal("expected hadEnvelope=false for plain JSON object")
	}
	if string(out) != string(in) {
		t.Fatalf("expected pass-through; got %s", out)
	}
}

func TestUnwrapJSONTraceContext_NonJSON_PassesThrough(t *testing.T) {
	t.Parallel()
	withW3CPropagator(t)
	cases := [][]byte{
		[]byte("not-json"),
		[]byte("42"),
		[]byte("[1,2,3]"),
		{},
	}
	for _, in := range cases {
		out, _, had := unwrapJSONTraceContext(context.Background(), in)
		if had {
			t.Fatalf("expected hadEnvelope=false for %q", in)
		}
		if string(out) != string(in) {
			t.Fatalf("expected pass-through; in=%q out=%q", in, out)
		}
	}
}

func TestUnwrapJSONTraceContext_EnvelopeRoundtrip_PropagatesContext(t *testing.T) {
	withW3CPropagator(t)
	ctx, end := startTracedContext(t, "publisher")
	defer end()

	in := []byte(`{"foo":"bar"}`)
	wrapped := wrapJSONWithTraceContext(ctx, in)

	unwrapped, parentCtx, had := unwrapJSONTraceContext(context.Background(), wrapped)
	if !had {
		t.Fatal("expected hadEnvelope=true on round-trip")
	}
	if string(unwrapped) != string(in) {
		t.Fatalf("payload mismatch: got %s want %s", unwrapped, in)
	}

	// SpanContextFromContext should now reflect the publisher's trace ID.
	publisherSC := trace.SpanContextFromContext(ctx)
	parentSC := trace.SpanContextFromContext(parentCtx)
	if !parentSC.IsValid() {
		t.Fatal("expected propagated span context to be valid")
	}
	if parentSC.TraceID() != publisherSC.TraceID() {
		t.Fatalf("trace ID lost across envelope: got %s want %s",
			parentSC.TraceID(), publisherSC.TraceID())
	}
}

func TestUnwrapJSONTraceContext_LookalikeWithoutPayloadKey(t *testing.T) {
	t.Parallel()
	withW3CPropagator(t)
	// Object that has _tc but no payload key — must NOT be treated as an
	// envelope, otherwise we'd accidentally strip data from messages that
	// happen to share the key name.
	in := []byte(`{"_tc":{"traceparent":"00-x-y-01"},"data":[1,2]}`)
	out, _, had := unwrapJSONTraceContext(context.Background(), in)
	if had {
		t.Fatal("expected hadEnvelope=false when payload key is missing")
	}
	if string(out) != string(in) {
		t.Fatalf("expected pass-through; got %s", out)
	}
}
