package tracing

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// defaultHeadSamplingRatio is the head-sampling ratio applied when the
// caller did not provide a valid OTEL_TRACES_SAMPLER_ARG. We always
// head-sample by default (ratio = 1.0) because TeslaSync is a
// self-hosted single-tenant tool with negligible trace volume.
// The OTel collector applies tail-based sampling on top of this
// baseline (see helm/teslasync/files/otel-collector/config.yaml:
// errors + slow >1s are always kept; OK traces are downsampled to 10%).
// Operators can override with OTEL_TRACES_SAMPLER_ARG (e.g., 0.1 for
// high-volume fleets).
const defaultHeadSamplingRatio = 1.0

// Option configures Init via functional options. Use WithServiceName to
// override the default service.name resource attribute (per-binary,
// e.g. "teslasync-notification-worker" so Tempo can separate worker
// spans from API spans).
type Option func(*options)

type options struct {
	serviceName string
}

// WithServiceName overrides the OTel resource service.name attribute.
// When unset, Init falls back to cfg.OpenTelemetry.ServiceName.
// Workers MUST set this so traces emitted by, e.g.,
// teslasync-notification-worker do not get bucketed under
// teslasync-api in Tempo. The override is required because all binaries
// share one config.Config — the OpenTelemetry block in config carries
// the API's service name and is not safe to mutate.
func WithServiceName(name string) Option {
	return func(o *options) { o.serviceName = strings.TrimSpace(name) }
}

// Init initializes the OpenTelemetry tracer provider with an OTLP gRPC exporter.
// It returns a shutdown function that must be called on application exit.
func Init(ctx context.Context, cfg *config.Config, opts ...Option) (func(context.Context) error, error) {
	if cfg == nil || !cfg.OpenTelemetry.Enabled || strings.TrimSpace(cfg.OTLPEndpoint) == "" {
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
			propagation.TraceContext{},
			propagation.Baggage{},
		))
		return func(context.Context) error { return nil }, nil
	}

	o := options{serviceName: cfg.OpenTelemetry.ServiceName}
	for _, opt := range opts {
		opt(&o)
	}
	if o.serviceName == "" {
		o.serviceName = cfg.OpenTelemetry.ServiceName
	}

	endpoint, insecureTLS := normalizeEndpoint(cfg.OTLPEndpoint, cfg.OpenTelemetry.Insecure)
	exporterOpts := []otlptracegrpc.Option{
		otlptracegrpc.WithEndpoint(endpoint),
	}
	if insecureTLS {
		exporterOpts = append(exporterOpts, otlptracegrpc.WithDialOption(grpc.WithTransportCredentials(insecure.NewCredentials())))
		exporterOpts = append(exporterOpts, otlptracegrpc.WithInsecure())
	}

	exporter, err := otlptracegrpc.New(ctx, exporterOpts...)
	if err != nil {
		return nil, fmt.Errorf("create otlp exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithProcess(),
		resource.WithTelemetrySDK(),
		resource.WithAttributes(
			attribute.String("service.name", o.serviceName),
			attribute.String("service.version", cfg.ServiceVersion),
			attribute.String("deployment.environment", cfg.Environment),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("create resource: %w", err)
	}

	samplerArg := cfg.OTELTracesSamplerArg
	ratio, err := strconv.ParseFloat(strings.TrimSpace(samplerArg), 64)
	if err != nil || ratio < 0 || ratio > 1 {
		ratio = defaultHeadSamplingRatio
	}
	// Parent-based head sampling: respect upstream sampling decisions
	// propagated via traceparent so HTTP entry → DB → MQTT spans share
	// one decision. Tail-based filtering (errors, > 1s) is applied
	// downstream by the OTel collector — see
	// helm/teslasync/files/otel-collector/config.yaml and
	// the trace-sampling runbook.
	sampler := sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ratio))
	bsp := sdktrace.NewBatchSpanProcessor(exporter)
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(bsp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sampler),
	)

	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return tp.Shutdown, nil
}

func normalizeEndpoint(endpoint string, insecureTLS bool) (string, bool) {
	endpoint = strings.TrimSpace(endpoint)
	if strings.HasPrefix(endpoint, "http://") {
		return strings.TrimPrefix(endpoint, "http://"), true
	}
	if strings.HasPrefix(endpoint, "https://") {
		return strings.TrimPrefix(endpoint, "https://"), insecureTLS
	}
	return endpoint, insecureTLS
}
