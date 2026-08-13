package tracing

import (
	"context"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("teslasync")

// StartSpan creates a new span for internal operations.
func StartSpan(ctx context.Context, name string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	return tracer.Start(ctx, name, trace.WithAttributes(attrs...))
}

// DBSpan creates a span for database operations following OpenTelemetry semantic conventions.
func DBSpan(ctx context.Context, operation, table string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	spanName := "db." + operation
	if table != "" {
		spanName = "db." + table + "." + operation
	}
	allAttrs := []attribute.KeyValue{
		attribute.String("db.system", "postgresql"),
		attribute.String("db.operation", operation),
	}
	if table != "" {
		allAttrs = append(allAttrs, attribute.String("db.sql.table", table))
	}
	allAttrs = append(allAttrs, attrs...)
	return tracer.Start(ctx, spanName, trace.WithAttributes(allAttrs...), trace.WithSpanKind(trace.SpanKindClient))
}

// EndSpan records an error (if any) and ends the span.
func EndSpan(span trace.Span, err error) {
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
	}
	span.End()
}

// HandlerSpan creates a span for API handler logic (child of the HTTP middleware span).
func HandlerSpan(ctx context.Context, handler string, attrs ...attribute.KeyValue) (context.Context, trace.Span) {
	allAttrs := []attribute.KeyValue{
		attribute.String("handler", handler),
	}
	allAttrs = append(allAttrs, attrs...)
	return tracer.Start(ctx, "handler."+handler, trace.WithAttributes(allAttrs...))
}

// TxSpan creates a span for a database transaction.
func TxSpan(ctx context.Context, name string) (context.Context, trace.Span) {
	return tracer.Start(ctx, "db.tx."+name, trace.WithAttributes(
		attribute.String("db.system", "postgresql"),
		attribute.String("db.operation", "transaction"),
		attribute.String("db.tx.name", name),
	), trace.WithSpanKind(trace.SpanKindClient))
}

// Attr helpers for common span attributes.
func VehicleID(id int64) attribute.KeyValue    { return attribute.Int64("vehicle.id", id) }
func VehicleVIN(vin string) attribute.KeyValue { return attribute.String("vehicle.vin", vin) }
func DriveID(id int64) attribute.KeyValue      { return attribute.Int64("drive.id", id) }
func ChargeID(id int64) attribute.KeyValue     { return attribute.Int64("charge.id", id) }
func TableName(t string) attribute.KeyValue    { return attribute.String("db.sql.table", t) }
func RowCount(n int) attribute.KeyValue        { return attribute.Int("db.row_count", n) }
func GeofenceID(id int64) attribute.KeyValue   { return attribute.Int64("geofence.id", id) }
func RateID(id int64) attribute.KeyValue       { return attribute.Int64("geofence.rate_id", id) }
