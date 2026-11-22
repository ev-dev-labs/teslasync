package main

import (
	"context"
	"errors"
	"time"

	renewalsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/subscriptionrenewal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

func runSubscriptionRenewalTick(ctx context.Context, reviews *renewalsvc.Reviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.subscription_renewal_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 10)
	checked := 0
	for outcome, count := range batch.Outcomes {
		metrics.RecordSubscriptionRenewal(string(outcome), count)
		checked += count
	}
	metrics.RecordSubscriptionRenewal("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.subscription_renewal.evaluated", checked))
	if err != nil {
		failure := errors.New("private subscription renewal check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
