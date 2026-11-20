package main

import (
	"context"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"

	deliveryadapter "github.com/ev-dev-labs/teslasync/internal/adapter/smartdelivery"
	smartadapter "github.com/ev-dev-labs/teslasync/internal/adapter/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type smartChargingProcessor interface {
	ProcessDue(context.Context, int) (int, error)
}

func startSmartCharging(ctx context.Context, cfg *config.Config, db *database.DB) func() {
	if !smartChargingEnabled(cfg) {
		return func() {}
	}
	sharedCache := cache.New(cfg.Redis)
	live, err := signal.NewLiveSignalStore(
		signal.New(), signal.NewRedisSignalCache(sharedCache.Underlying()), cfg.FleetTelemetry.LiveSignalStoreMode,
	)
	if err != nil {
		sharedCache.Close()
		log.Warn().Msg("smart charging readiness disabled: invalid live-signal mode")
		return func() {}
	}
	var delivery *smartdeliverysvc.Service
	service := smartreadinesssvc.New(
		readinessdb.NewRepository(db), live, smartadapter.NewSites(geofencedb.NewGeofenceRepo(db)),
		smartreadinesssvc.WithDecisionObserver(recordSmartChargingDecision),
		smartreadinesssvc.WithSharedOpenMode(tsauth.IsOpenMode(cfg.Auth.ForwardAuthHeader)),
		smartreadinesssvc.WithCandidateNotifier(func(ctx context.Context, candidate readinessport.Candidate) error {
			return delivery.NotifyCharging(ctx, candidate)
		}),
	)
	var encryptor *crypto.Encryptor
	if key := os.Getenv("ENCRYPTION_KEY"); key != "" {
		encryptor, err = crypto.New(key)
		if err != nil {
			log.Warn().Msg("personal delivery disabled: encryption setup failed")
		}
	}
	delivery = smartdeliverysvc.New(
		deliverydb.NewRepository(db), encryptor,
		deliveryadapter.NewWebPush(cfg.WebPush.PublicKey, cfg.WebPush.PrivateKey, cfg.WebPush.Subject),
		smartdeliverysvc.WithChargingCandidates(service),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(db)),
		smartdeliverysvc.WithDeliveryObserver(metrics.RecordSmartPersonalPush),
	)
	workerCtx, cancel := context.WithCancel(ctx)
	stopTraffic := startSmartTraffic(workerCtx, cfg, db, live)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for workerCtx.Err() == nil {
			runSmartChargingTick(workerCtx, service)
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	return func() {
		cancel()
		<-done
		stopTraffic()
		sharedCache.Close()
	}
}

func smartChargingEnabled(cfg *config.Config) bool {
	return cfg.Redis.Enabled &&
		!strings.EqualFold(strings.TrimSpace(cfg.FleetTelemetry.LiveSignalStoreMode), "local")
}

func runSmartChargingTick(ctx context.Context, processor smartChargingProcessor) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.smart_charging_tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 50*time.Second)
	defer cancel()
	processed, err := processor.ProcessDue(ctx, 50)
	span.SetAttributes(attribute.Int("notification.smart_charging.processed", processed))
	if err != nil {
		span.RecordError(errors.New("smart charging readiness evaluation failed"))
		span.SetStatus(codes.Error, "smart charging readiness evaluation failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("smart charging readiness evaluation failed")
	}
}

func recordSmartChargingDecision(reason domain.Reason) {
	switch reason {
	case domain.ReasonEligible, domain.ReasonDisabled, domain.ReasonNotDue, domain.ReasonExpired,
		domain.ReasonInvalidPlan, domain.ReasonUnknownState, domain.ReasonNotParked,
		domain.ReasonPlugged, domain.ReasonOutsideSite, domain.ReasonEnoughCharge,
		domain.ReasonUnachievable:
		metrics.SmartChargingEvaluations.WithLabelValues(string(reason)).Inc()
	}
}
