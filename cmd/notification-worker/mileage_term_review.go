package main

import (
	"context"
	"errors"
	"time"

	mileagesvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/mileageterm"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

func runMileageTermReviewTick(ctx context.Context, reviews *mileagesvc.Reviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.mileage_term_review_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 4)
	checked := 0
	for reason, count := range batch.Outcomes {
		metrics.RecordMileageTermReview(string(reason), count)
		checked += count
	}
	metrics.RecordMileageTermReview("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.mileage_term_review.evaluated", checked))
	if err != nil {
		failure := errors.New("private mileage term review check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
