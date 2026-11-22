package main

import (
	"context"
	"errors"
	"time"

	packetsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/trippacket"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
)

func runTripPacketTick(ctx context.Context, reviews *packetsvc.Reviews) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.trip_packet_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	batch, err := reviews.ProcessDue(ctx, 4)
	checked := 0
	for reason, count := range batch.Outcomes {
		metrics.RecordTripPacket(string(reason), count)
		checked += count
	}
	metrics.RecordTripPacket("published_in_app", batch.Published)
	span.SetAttributes(attribute.Int("notification.trip_packet.evaluated", checked))
	if err != nil {
		failure := errors.New("private trip packet check failed")
		span.RecordError(failure)
		span.SetStatus(codes.Error, failure.Error())
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg(failure.Error())
	}
}
