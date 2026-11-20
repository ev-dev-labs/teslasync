package main

import (
	"context"
	"errors"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/adapter/heretraffic"
	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	commutedb "github.com/ev-dev-labs/teslasync/internal/database/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

func startSmartTraffic(ctx context.Context, cfg *config.Config, db *database.DB,
	live smartcommutesvc.TrafficLiveReader, notify smartcommutesvc.TrafficNotifier,
) func() {
	if !cfg.SmartCommute.HasLicensedTraffic() {
		return func() {}
	}
	source, err := heretraffic.New(cfg.SmartCommute.HEREAPIKey)
	if err != nil {
		log.Warn().Msg("smart commute traffic disabled: HERE setup is incomplete")
		return func() {}
	}
	quietRepo := quiethoursdb.NewQuietHoursRepo(db)
	service := smartcommutesvc.New(commutedb.NewRepository(db), smartcommutesvc.WithTrafficLiveReader(live),
		smartcommutesvc.WithTrafficSharedOpenMode(tsauth.IsOpenMode(cfg.Auth.ForwardAuthHeader)),
		smartcommutesvc.WithTrafficNotifier(notify),
		smartcommutesvc.WithTrafficEvaluator(source, func(ctx context.Context, subject string, now time.Time) (bool, error) {
			if subject == personal.OpenSubject {
				subject = ""
			}
			windows, err := quietRepo.ListByUser(ctx, subject)
			if err != nil {
				return false, err
			}
			_, quiet := notification.MatchActiveWindow(windows, "info", now)
			return quiet, nil
		}, metrics.RecordSmartCommuteTraffic))
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for ctx.Err() == nil {
			runSmartTrafficTick(ctx, service)
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

type smartTrafficProcessor interface {
	ProcessTrafficChecks(context.Context, int) (int, error)
}

func runSmartTrafficTick(ctx context.Context, processor smartTrafficProcessor) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.smart_commute_traffic_tick", oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 50*time.Second)
	defer cancel()
	count, err := processor.ProcessTrafficChecks(ctx, 4)
	span.SetAttributes(attribute.Int("notification.smart_commute_traffic.processed", count))
	if err != nil {
		span.RecordError(errors.New("smart commute traffic evaluation failed"))
		span.SetStatus(codes.Error, "smart commute traffic evaluation failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("smart commute traffic evaluation failed")
	}
}
