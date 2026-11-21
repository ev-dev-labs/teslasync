package main

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	costsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/costtrend"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

func runChargingCostDigestTick(ctx context.Context, reviews *costsvc.Reviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.charging_cost_digest_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 4)
	checked := 0
	for reason, count := range batch.Outcomes {
		metrics.RecordChargingCostDigest(string(reason), count)
		checked += count
	}
	metrics.RecordChargingCostDigest("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.charging_cost_digest.evaluated", checked))
	if err != nil {
		failure := errors.New("private monthly charging cost digest check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
