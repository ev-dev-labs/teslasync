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

// Init initializes the OpenTelemetry tracer provider with an OTLP gRPC exporter.
// It returns a shutdown function that must be called on application exit.
func Init(ctx context.Context, cfg *config.Config) (func(context.Context) error, error) {
	if cfg == nil || !cfg.OpenTelemetry.Enabled || strings.TrimSpace(cfg.OTLPEndpoint) == "" {
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
			propagation.TraceContext{},
			propagation.Baggage{},
		))
		return func(context.Context) error { return nil }, nil
	}

	endpoint, insecureTLS := normalizeEndpoint(cfg.OTLPEndpoint, cfg.OpenTelemetry.Insecure)
	opts := []otlptracegrpc.Option{
		otlptracegrpc.WithEndpoint(endpoint),
	}
	if insecureTLS {
		opts = append(opts, otlptracegrpc.WithDialOption(grpc.WithTransportCredentials(insecure.NewCredentials())))
		opts = append(opts, otlptracegrpc.WithInsecure())
	}

	exporter, err := otlptracegrpc.New(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("create otlp exporter: %w", err)
	}

	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithProcess(),
		resource.WithTelemetrySDK(),
		resource.WithAttributes(
			attribute.String("service.name", cfg.OpenTelemetry.ServiceName),
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
		ratio = 1
	}
	bsp := sdktrace.NewBatchSpanProcessor(exporter)
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSpanProcessor(bsp),
		sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.TraceIDRatioBased(ratio)),
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
