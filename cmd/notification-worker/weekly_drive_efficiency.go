package main

import (
	"context"
	"errors"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveefficiencysvc"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

func runWeeklyDriveEfficiencyTick(ctx context.Context, reviews *driveefficiencysvc.Reviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.weekly_drive_efficiency_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 4)
	checked := 0
	for reason, count := range batch.Outcomes {
		metrics.RecordWeeklyDriveEfficiency(string(reason), count)
		checked += count
	}
	metrics.RecordWeeklyDriveEfficiency("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.weekly_drive_efficiency.evaluated", checked))
	if err != nil {
		failure := errors.New("private weekly efficiency check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
