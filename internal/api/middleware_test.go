package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func TestOtelHTTPTransportInjectsTraceparent(t *testing.T) {
	tp := sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.AlwaysSample()))
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSampler(sdktrace.NeverSample())))
		otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator())
	})

	ctx, span := otel.Tracer("api").Start(context.Background(), "test.outbound")
	defer span.End()

	var gotTraceparent string
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotTraceparent = r.Header.Get("traceparent")
	}))
	defer srv.Close()

	client := &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport)}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL, nil)
	if err != nil {
		t.Fatalf("NewRequestWithContext: %v", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()

	if gotTraceparent == "" {
		t.Fatal("expected traceparent header to be propagated")
	}
}
