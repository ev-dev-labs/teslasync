package main

import (
	"context"
	"errors"
	"time"

	tariffsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/monthlytariff"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

func runMonthlyTariffReviewTick(ctx context.Context, reviews *tariffsvc.Reviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.monthly_tariff_review_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 4)
	checked := 0
	for reason, count := range batch.Outcomes {
		metrics.RecordMonthlyTariffReview(string(reason), count)
		checked += count
	}
	metrics.RecordMonthlyTariffReview("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.monthly_tariff_review.evaluated", checked))
	if err != nil {
		failure := errors.New("private monthly tariff review check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
