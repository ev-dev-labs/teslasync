package provider

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

// traceTestExp is the single in-memory exporter shared across every
// TestWithTrace_* function. OTel's global tracer delegate locks to the
// first installed TracerProvider for the lifetime of the package, so a
// per-test SetTracerProvider would silently drop spans for tests after
// the first one. TestMain installs the provider once; each test resets
// the exporter at start.
var traceTestExp = tracetest.NewInMemoryExporter()

func TestMain(m *testing.M) {
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(traceTestExp))
	otel.SetTracerProvider(tp)
	code := m.Run()
	_ = tp.Shutdown(context.Background())
	os.Exit(code)
}

// TestWithTrace_EmitsChatSpan asserts a Chat call emits a span named
// "ai.<name>.chat" with the standard attribute set.
func TestWithTrace_EmitsChatSpan(t *testing.T) {
	traceTestExp.Reset()

	calls := []string{}
	base := &stubProvider{name: "stub", calls: &calls}
	wrapped := WithTrace(base)
	_, _ = wrapped.Chat(context.Background(), ChatRequest{Model: "test-model"})

	spans := traceTestExp.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}
	s := spans[0]
	if s.Name != "ai.stub.chat" {
		t.Fatalf("span name=%q", s.Name)
	}
	gotAttrs := map[string]string{}
	for _, a := range s.Attributes {
		gotAttrs[string(a.Key)] = a.Value.Emit()
	}
	if gotAttrs["ai.provider"] != "stub" || gotAttrs["ai.model"] != "test-model" {
		t.Fatalf("missing standard attrs: %+v", gotAttrs)
	}
}

// TestWithTrace_RecordsErrorOnChatFailure asserts the span gets an
// error status when the inner provider returns an error.
func TestWithTrace_RecordsErrorOnChatFailure(t *testing.T) {
	traceTestExp.Reset()

	wrapped := WithTrace(failingProvider{err: errors.New("synthetic")})
	_, err := wrapped.Chat(context.Background(), ChatRequest{Model: "boom"})
	if err == nil {
		t.Fatalf("expected error to surface")
	}
	spans := traceTestExp.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}
	if spans[0].Status.Code.String() != "Error" {
		t.Fatalf("span status=%s", spans[0].Status.Code.String())
	}
}

// TestWithTrace_StreamForwardsAndEnds asserts the stream relay forwards
// chunks unchanged and closes the outbound channel after the upstream
// closes (so the span ends).
func TestWithTrace_StreamForwardsAndEnds(t *testing.T) {
	traceTestExp.Reset()

	src := make(chan Chunk, 3)
	src <- Chunk{Delta: "hello"}
	src <- Chunk{Delta: " "}
	src <- Chunk{Done: true}
	close(src)

	wrapped := WithTrace(streamingStub{src: src})
	out, err := wrapped.Stream(context.Background(), ChatRequest{Model: "stream-model"})
	if err != nil {
		t.Fatalf("Stream: %v", err)
	}
	got := []string{}
	for c := range out {
		if c.Done {
			break
		}
		got = append(got, c.Delta)
	}
	if len(got) != 2 || got[0] != "hello" || got[1] != " " {
		t.Fatalf("relay payload mismatch: %v", got)
	}
	// The relay goroutine ends the span asynchronously after the
	// done chunk is forwarded; poll briefly for the span to land.
	for retries := 0; retries < 100; retries++ {
		if len(traceTestExp.GetSpans()) > 0 {
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	spans := traceTestExp.GetSpans()
	if len(spans) == 0 {
		t.Fatalf("expected at least 1 span")
	}
	if spans[0].Name != "ai.stub.stream" {
		t.Fatalf("span name=%q", spans[0].Name)
	}
}

type failingProvider struct{ err error }

func (f failingProvider) Name() string               { return "failing" }
func (f failingProvider) Capabilities() Capabilities { return Capabilities{} }
func (f failingProvider) Chat(_ context.Context, _ ChatRequest) (*ChatResponse, error) {
	return nil, f.err
}
func (f failingProvider) Stream(_ context.Context, _ ChatRequest) (<-chan Chunk, error) {
	return nil, f.err
}
func (f failingProvider) Embed(_ context.Context, _ EmbedRequest) (*EmbedResponse, error) {
	return nil, f.err
}

type streamingStub struct{ src chan Chunk }

func (s streamingStub) Name() string               { return "stub" }
func (s streamingStub) Capabilities() Capabilities { return Capabilities{Streaming: true} }
func (s streamingStub) Chat(_ context.Context, _ ChatRequest) (*ChatResponse, error) {
	return &ChatResponse{}, nil
}
func (s streamingStub) Stream(_ context.Context, _ ChatRequest) (<-chan Chunk, error) {
	return s.src, nil
}
func (s streamingStub) Embed(_ context.Context, _ EmbedRequest) (*EmbedResponse, error) {
	return &EmbedResponse{}, nil
}
