package main

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
)

func runFavoriteDigestTick(ctx context.Context, digests *smartmediasvc.FavoriteDigests) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.favorite_digest_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	batch, err := digests.ProcessDue(ctx, 4)
	metrics.RecordFavoriteDigest("checked", batch.Checked)
	metrics.RecordFavoriteDigest("published_in_app", batch.Published)
	metrics.RecordFavoriteDigest("not_qualified", batch.NotQualified)
	metrics.RecordFavoriteDigest("evidence_limit", batch.EvidenceLimit)
	span.SetAttributes(attribute.Int("notification.favorite_digest.checked", batch.Checked))
	if err != nil {
		failure := errors.New("private weekly favorite digest check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
