package tracing

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
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
