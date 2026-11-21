package main

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
)

func startSharedPlanningChecks(ctx context.Context, db *database.DB, forwardAuthHeader string) func() {
	if tsauth.IsOpenMode(forwardAuthHeader) {
		return func() {}
	}
	ctx, cancel := context.WithCancel(ctx)
	service := smartreadinesssvc.NewSharedChargerService(readinessdb.NewRepository(db), nil, time.Now)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for ctx.Err() == nil {
			runSharedChargerTick(ctx, service)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() {
		cancel()
		<-done
	}
}

func runSharedChargerTick(ctx context.Context, service *smartreadinesssvc.SharedChargerService) {
	ctx, span := workerTracer().Start(ctx, "notification.shared_charger_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	published, err := service.PublishDueReminders(ctx, 20)
	span.SetAttributes(attribute.Int("notification.shared_charger.published", published))
	if err != nil && ctx.Err() != context.Canceled {
		span.RecordError(errors.New("shared charger reminder publication failed"))
		span.SetStatus(codes.Error, "shared charger reminder publication failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("shared charger reminder publication failed")
	}
}
