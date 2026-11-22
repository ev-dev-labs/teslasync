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

func runRecallWatchTick(ctx context.Context, service *smartreadinesssvc.RecallWatch) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.recall_watch_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	batch, err := service.ProcessDue(ctx, 5)
	checked := 0
	for outcome, count := range batch.Outcomes {
		checked += count
		metrics.RecordRecallWatchCheck(outcome, count)
	}
	metrics.RecordRecallWatchPublication(batch.Published)
	span.SetAttributes(attribute.Int("notification.recall_watch.checked", checked))
	if err != nil {
		span.RecordError(errors.New("private recall check failed"))
		span.SetStatus(codes.Error, "private recall check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("private recall check failed")
	}
}
