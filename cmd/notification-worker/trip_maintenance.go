package main

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

func runTripMaintenanceTick(ctx context.Context, service *smartreadinesssvc.TripMaintenance) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.trip_maintenance_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	batch, err := service.ProcessDue(ctx, 20)
	checked := 0
	for reason, count := range batch.Outcomes {
		checked += count
		metrics.RecordTripMaintenanceCheck(reason, count)
	}
	metrics.RecordTripMaintenancePublication(batch.Published)
	span.SetAttributes(attribute.Int("notification.trip_maintenance.checked", checked))
	if err != nil {
		span.RecordError(errors.New("trip maintenance check failed"))
		span.SetStatus(codes.Error, "trip maintenance check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("trip maintenance check failed")
	}
}
