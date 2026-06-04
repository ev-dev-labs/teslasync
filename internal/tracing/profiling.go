package tracing

import (
	"context"
	"fmt"
	"runtime"
	"strings"

	"github.com/grafana/pyroscope-go"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// StartProfiler initializes Pyroscope continuous profiling against the
// configured server. When the profiler is disabled or unconfigured the
// returned shutdown function is a no-op so callers can defer it
// unconditionally.
//
// Pyroscope sits alongside OTel tracing and Prometheus metrics: the same
// data plane, but a different signal. CPU, allocation, goroutine, mutex,
// and block profiles are uploaded as godeltaprof deltas to keep overhead
// under 1% CPU for typical TeslaSync workloads.
//
// Service name follows the same per-binary discipline as
// tracing.Init+WithServiceName: workers MUST pass their own
// teslasync-<worker> name so the Pyroscope UI can separate them.
//
// The function is safe to call from worker main() blocks: failure to
// reach the Pyroscope server is logged at WARN by the caller and never
// blocks startup. The Go default runtime profiler is not disturbed.
func StartProfiler(ctx context.Context, cfg *config.Config, serviceName string) (func(context.Context) error, error) {
	if cfg == nil || !cfg.Profiling.Enabled || strings.TrimSpace(cfg.Profiling.ServerAddress) == "" {
		return func(context.Context) error { return nil }, nil
	}

	svc := strings.TrimSpace(serviceName)
	if svc == "" {
		svc = strings.TrimSpace(cfg.OpenTelemetry.ServiceName)
	}
	if svc == "" {
		svc = "teslasync"
	}

	// Mutex + block profile rates must be >0 for the runtime to record
	// samples at all. The values chosen below sample 1 in 5 contention
	// events, which matches Pyroscope's documented "low overhead" guidance
	// (https://grafana.com/docs/pyroscope/latest/configure-client/go/).
	runtime.SetMutexProfileFraction(5)
	runtime.SetBlockProfileRate(5)

	profiler, err := pyroscope.Start(pyroscope.Config{
		ApplicationName: svc,
		ServerAddress:   cfg.Profiling.ServerAddress,
		Logger:          nil, // intentionally silent; surface failures via the upload metric instead
		Tags: map[string]string{
			"env":     cfg.Environment,
			"version": cfg.ServiceVersion,
		},
		ProfileTypes: []pyroscope.ProfileType{
			pyroscope.ProfileCPU,
			pyroscope.ProfileAllocObjects,
			pyroscope.ProfileAllocSpace,
			pyroscope.ProfileInuseObjects,
			pyroscope.ProfileInuseSpace,
			pyroscope.ProfileGoroutines,
			pyroscope.ProfileMutexCount,
			pyroscope.ProfileMutexDuration,
			pyroscope.ProfileBlockCount,
			pyroscope.ProfileBlockDuration,
		},
		UploadRate: cfg.Profiling.UploadRate,
	})
	if err != nil {
		return func(context.Context) error { return nil }, fmt.Errorf("start pyroscope profiler: %w", err)
	}

	return func(_ context.Context) error {
		return profiler.Stop()
	}, nil
}
