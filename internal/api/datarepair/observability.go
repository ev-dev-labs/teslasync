package datarepair

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

func startHandlerSpan(r *http.Request, name string) (*http.Request, trace.Span) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.data_repair."+name)
	return r.WithContext(ctx), span
}

func recordHandlerError(ctx context.Context, err error) {
	if err == nil {
		return
	}
	span := trace.SpanFromContext(ctx)
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
}

func activeTraceID(ctx context.Context) string {
	return trace.SpanContextFromContext(ctx).TraceID().String()
}
