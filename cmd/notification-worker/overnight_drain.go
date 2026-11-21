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

func runOvernightDrainTick(ctx context.Context, reviews *smartreadinesssvc.OvernightDrainReviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.overnight_drain_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 8)
	checked := 0
	for reason, count := range batch.Outcomes {
		metrics.RecordOvernightDrain(string(reason), count)
		checked += count
	}
	metrics.RecordOvernightDrain("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.overnight_drain.evaluated", checked))
	if err != nil {
		failure := errors.New("private overnight drain check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
