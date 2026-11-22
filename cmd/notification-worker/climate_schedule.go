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

func runClimateScheduleTick(ctx context.Context, service *smartreadinesssvc.ClimateScheduleReviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.climate_schedule_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	batch, err := service.ProcessDue(ctx, 5)
	span.SetAttributes(attribute.Int("notification.climate_schedule.checked", batch.Checked))
	metrics.RecordClimateScheduleChecks(batch.Matched, batch.Quiet, batch.Changed)
	metrics.RecordClimateSchedulePublications(batch.Published)
	if err != nil {
		failure := errors.New("scheduled climate review check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
