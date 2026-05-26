package tracing

import (
	"context"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// TestStartProfiler_DisabledIsNoop verifies the profiler returns a
// callable no-op shutdown when profiling is disabled — workers can defer
// the result without nil-checking.
func TestStartProfiler_DisabledIsNoop(t *testing.T) {
	t.Parallel()
	cfg := &config.Config{Profiling: config.ProfilingConfig{Enabled: false, ServerAddress: ""}}
	shutdown, err := StartProfiler(context.Background(), cfg, "test")
	if err != nil {
		t.Fatalf("disabled profiler should not error: %v", err)
	}
	if shutdown == nil {
		t.Fatal("disabled profiler must return non-nil shutdown")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("no-op shutdown should succeed: %v", err)
	}
}

// TestStartProfiler_EmptyAddressIsNoop guards the second branch — even
// when Enabled=true, an empty ServerAddress should refuse to start the
// pyroscope SDK rather than hanging on a DNS lookup at boot.
func TestStartProfiler_EmptyAddressIsNoop(t *testing.T) {
	t.Parallel()
	cfg := &config.Config{Profiling: config.ProfilingConfig{Enabled: true, ServerAddress: ""}}
	shutdown, err := StartProfiler(context.Background(), cfg, "test")
	if err != nil {
		t.Fatalf("empty address should not error: %v", err)
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown should succeed: %v", err)
	}
}

// TestStartProfiler_NilConfigIsSafe — defensive: tracing.StartProfiler is
// called from worker mains where a partial config build could pass nil.
func TestStartProfiler_NilConfigIsSafe(t *testing.T) {
	t.Parallel()
	shutdown, err := StartProfiler(context.Background(), nil, "test")
	if err != nil {
		t.Fatalf("nil cfg should not error: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := shutdown(ctx); err != nil {
		t.Fatalf("nil-cfg shutdown should succeed: %v", err)
	}
}
