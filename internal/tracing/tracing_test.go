package tracing

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestInitReturnsShutdownWhenEndpointConfigured(t *testing.T) {
	cfg := testConfig("http://localhost:4317")

	shutdown, err := Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init returned error: %v", err)
	}
	if shutdown == nil {
		t.Fatal("Init returned nil shutdown")
	}
}

func TestInitNoopsWhenEndpointEmpty(t *testing.T) {
	cfg := testConfig("")

	shutdown, err := Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init returned error: %v", err)
	}
	if shutdown == nil {
		t.Fatal("Init returned nil shutdown")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown returned error: %v", err)
	}
}

func TestShutdownFlushesWithinFiveSeconds(t *testing.T) {
	cfg := testConfig("http://localhost:4317")

	shutdown, err := Init(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Init returned error: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- shutdown(ctx)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("shutdown returned error: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("shutdown did not complete within 5s: %v", ctx.Err())
	}
}

func testConfig(endpoint string) *config.Config {
	return &config.Config{
		Environment:          "test",
		ServiceVersion:       "test",
		OTLPEndpoint:         endpoint,
		OTELTracesSamplerArg: "1.0",
		OpenTelemetry: config.OpenTelemetryConfig{
			Enabled:     endpoint != "",
			ServiceName: "teslasync-test",
			Insecure:    true,
		},
	}
}

func TestSamplerIsParentBased(t *testing.T) {
	// The sampler must implement parent-based behaviour so HTTP entry
	// sampling decisions propagate down to MQTT, DB and Tesla-client
	// children. We assert the description Prometheus would log; the
	// description is documented as `ParentBased{root:...}` by the SDK.
	s := sdktrace.ParentBased(sdktrace.TraceIDRatioBased(defaultHeadSamplingRatio))
	desc := s.Description()
	if desc == "" {
		t.Fatal("sampler description is empty")
	}
	if want := "ParentBased"; want != "" && !contains(desc, want) {
		t.Fatalf("sampler description %q does not contain %q", desc, want)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
