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

func runCapacityDigestTick(ctx context.Context, reviews *smartreadinesssvc.CapacityTrendReviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.capacity_digest_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 4)
	checked := 0
	for reason, count := range batch.Outcomes {
		metrics.RecordCapacityDigest(string(reason), count)
		checked += count
	}
	metrics.RecordCapacityDigest("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.capacity_digest.evaluated", checked))
	if err != nil {
		failure := errors.New("private monthly battery digest check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
