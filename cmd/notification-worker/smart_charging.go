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

	"github.com/ev-dev-labs/teslasync/internal/adapter/openmeteo"
	deliveryadapter "github.com/ev-dev-labs/teslasync/internal/adapter/smartdelivery"
	smartadapter "github.com/ev-dev-labs/teslasync/internal/adapter/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/cache"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	"github.com/ev-dev-labs/teslasync/internal/database"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	teslabudgetdb "github.com/ev-dev-labs/teslasync/internal/database/teslabudget"
	commute "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
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
	readinessRepo := readinessdb.NewRepository(db)
	readinessOptions := []smartreadinesssvc.Option{
		smartreadinesssvc.WithPublicFees(readinessRepo),
		smartreadinesssvc.WithDecisionObserver(recordSmartChargingDecision),
		smartreadinesssvc.WithSharedOpenMode(tsauth.IsOpenMode(cfg.Auth.ForwardAuthHeader)),
		smartreadinesssvc.WithCandidateNotifier(func(ctx context.Context, candidate readinessport.Candidate) error {
			return delivery.NotifyCharging(ctx, candidate)
		}),
	}
	var encryptor *crypto.Encryptor
	if key := os.Getenv("ENCRYPTION_KEY"); key != "" {
		encryptor, err = crypto.New(key)
		if err != nil {
			log.Warn().Msg("personal delivery disabled: encryption setup failed")
		}
	}
	var solarConnections *smartreadinesssvc.SolarEnergyConnections
	var backupEnergy *smartadapter.SolarEnergy
	if encryptor != nil && cfg.Tesla.ClientID != "" {
		readConfig := config.TeslaConfig{
			ClientID: cfg.Tesla.ClientID, BaseURL: cfg.Tesla.BaseURL, Timeout: cfg.Tesla.Timeout,
			DailyBudgetUSD: cfg.Tesla.DailyBudgetUSD, CommandReserveUSD: cfg.Tesla.CommandReserveUSD,
		}
		energyClient := tesla.NewClient(readConfig)
		energyClient.SetEndpointControlsReader(settingsdb.NewSettingsRepo(db))
		if policy := tesla.NewBudgetPolicy(readConfig.DailyBudgetUSD, readConfig.CommandReserveUSD); policy.Enabled() {
			energyClient.SetRequestBudget(teslabudgetdb.New(db.Pool, policy))
		}
		solarConnections = smartreadinesssvc.NewSolarEnergyConnections(
			readinessdb.NewSolarEnergyConnectionRepository(db, encryptor), smartadapter.NewTeslaSolarAuthorization(energyClient))
		backupEnergy = smartadapter.NewSolarEnergy(energyClient, solarConnections)
		readinessOptions = append(readinessOptions,
			smartreadinesssvc.WithSolarCharging(readinessRepo, backupEnergy))
	}
	sites := smartadapter.NewSites(geofencedb.NewGeofenceRepo(db))
	service := smartreadinesssvc.New(readinessRepo, live, sites, readinessOptions...)
	var backup *smartreadinesssvc.BackupCharging
	var backupCandidates smartdeliverysvc.BackupCandidates
	if backupEnergy != nil && !tsauth.IsOpenMode(cfg.Auth.ForwardAuthHeader) {
		backup = smartreadinesssvc.NewBackupCharging(readinessRepo, live, sites, true, backupEnergy, time.Now)
		backupCandidates = backup
	}
	cabinPrep := smartreadinesssvc.NewCabinPrep(readinessRepo,
		smartreadinesssvc.NewCabinHistory(readinessRepo, signal.NewLogStateReader(db.Pool, log.Logger)), live, time.Now)
	parkReserves := smartreadinesssvc.NewParkReserves(readinessRepo,
		smartreadinesssvc.NewParkReserveHistory(readinessRepo, signal.NewLogStateReader(db.Pool, log.Logger)), live, time.Now)
	quietHours := quiethoursdb.NewQuietHoursRepo(db)
	windowRain := smartreadinesssvc.NewWindowRainWatches(readinessRepo, live, openmeteo.NewRainClient(nil, nil), quietHours, time.Now)
	parkedClosures := smartreadinesssvc.NewParkedClosures(readinessRepo, smartreadinesssvc.NewParkedClosureHistory(readinessRepo, live), time.Now)
	parkedUnlocks := smartreadinesssvc.NewParkedUnlocks(readinessRepo, readinessRepo, sites, live, time.Now)
	deliveryRepo := deliverydb.NewRepository(db)
	delivery = smartdeliverysvc.New(
		deliveryRepo, encryptor,
		deliveryadapter.NewWebPush(cfg.WebPush.PublicKey, cfg.WebPush.PrivateKey, cfg.WebPush.Subject),
		smartdeliverysvc.WithChargingCandidates(service),
		smartdeliverysvc.WithPublicFeeDelivery(deliveryRepo, service),
		smartdeliverysvc.WithBackupDelivery(deliveryRepo, backupCandidates),
		smartdeliverysvc.WithCabinPrepDelivery(deliveryRepo, cabinPrep),
		smartdeliverysvc.WithParkReserveDelivery(deliveryRepo, parkReserves),
		smartdeliverysvc.WithWindowRainDelivery(deliveryRepo, windowRain),
		smartdeliverysvc.WithParkedClosureDelivery(deliveryRepo, parkedClosures),
		smartdeliverysvc.WithParkedUnlockDelivery(deliveryRepo, parkedUnlocks),
		smartdeliverysvc.WithCommuteDelivery(deliveryRepo, func(ctx context.Context, vehicleID int64, origin commute.Point, now time.Time) (bool, error) {
			return smartcommutesvc.ParkedAtTrafficOrigin(ctx, live, vehicleID, origin, now)
		}),
		smartdeliverysvc.WithQuietHours(quietHours),
		smartdeliverysvc.WithDeliveryObserver(metrics.RecordSmartPersonalPush),
	)
	workerCtx, cancel := context.WithCancel(ctx)
	stopTraffic := startSmartTraffic(workerCtx, cfg, db, live, delivery.NotifyCommute)
	readinessDone := make(chan struct{})
	go func() {
		defer close(readinessDone)
		ticker := time.NewTicker(domain.EarlyStopCheckInterval)
		defer ticker.Stop()
		runSmartChargingLoop(workerCtx, service, ticker.C)
	}()
	solarDone := make(chan struct{})
	go func() {
		defer close(solarDone)
		if solarConnections == nil {
			return
		}
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for workerCtx.Err() == nil {
			runSolarChargingTick(workerCtx, service, solarConnections)
			if backup != nil && delivery.BackupDeliveryAvailable() {
				runBackupChargingTick(workerCtx, backup, delivery)
			}
			select {
			case <-workerCtx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for workerCtx.Err() == nil {
			if !tsauth.IsOpenMode(cfg.Auth.ForwardAuthHeader) {
				if delivery.CabinPrepAvailable() {
					runCabinPrepTick(workerCtx, cabinPrep, delivery)
				}
				runParkReserveTick(workerCtx, parkReserves, delivery)
				if delivery.WindowRainAvailable() {
					runWindowRainTick(workerCtx, windowRain, delivery)
				}
				if delivery.ParkedClosureAvailable() {
					runParkedClosureTick(workerCtx, parkedClosures, delivery)
				}
				if delivery.ParkedUnlockAvailable() {
					runParkedUnlockTick(workerCtx, parkedUnlocks, delivery)
				}
			}
			if delivery.PublicFeeAvailable() {
				runPublicFeeTick(workerCtx, service, delivery)
			}
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
		<-solarDone
		<-readinessDone
		stopTraffic()
		sharedCache.Close()
	}
}

func runParkedUnlockTick(ctx context.Context, plans *smartreadinesssvc.ParkedUnlocks, delivery *smartdeliverysvc.Service) {
	ctx, span := workerTracer().Start(ctx, "notification.parked_unlock_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	outcomes, err := plans.ProcessDue(ctx, 6)
	for reason, count := range outcomes {
		metrics.RecordParkedUnlock(string(reason), count)
	}
	if err = errors.Join(err, delivery.DeliverParkedUnlocks(ctx, 6)); err != nil {
		span.RecordError(errors.New("parked unlock check failed"))
		span.SetStatus(codes.Error, "parked unlock check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("parked unlock check failed")
	}
}

func runParkedClosureTick(ctx context.Context, plans *smartreadinesssvc.ParkedClosures, delivery *smartdeliverysvc.Service) {
	ctx, span := workerTracer().Start(ctx, "notification.parked_closure_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	outcomes, err := plans.ProcessDue(ctx, 6)
	for reason, count := range outcomes {
		metrics.RecordParkedClosure(string(reason), count)
	}
	if err = errors.Join(err, delivery.DeliverParkedClosures(ctx, 6)); err != nil {
		span.RecordError(errors.New("parked closure check failed"))
		span.SetStatus(codes.Error, "parked closure check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("parked closure check failed")
	}
}

func runWindowRainTick(ctx context.Context, plans *smartreadinesssvc.WindowRainWatches, delivery *smartdeliverysvc.Service) {
	ctx, span := workerTracer().Start(ctx, "notification.window_rain_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	outcomes, err := plans.ProcessDue(ctx, 2)
	for reason, count := range outcomes {
		metrics.RecordWindowRain(string(reason), count)
	}
	if err = errors.Join(err, delivery.DeliverWindowRain(ctx, 4)); err != nil {
		span.RecordError(errors.New("window rain check failed"))
		span.SetStatus(codes.Error, "window rain check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("window rain check failed")
	}
}

func runParkReserveTick(ctx context.Context, plans *smartreadinesssvc.ParkReserves, delivery *smartdeliverysvc.Service) {
	ctx, span := workerTracer().Start(ctx, "notification.park_reserve_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	outcomes, err := plans.ProcessDue(ctx, 6)
	for reason, count := range outcomes {
		metrics.RecordParkReserve(string(reason), count)
	}
	if err = errors.Join(err, delivery.DeliverParkReserve(ctx, 6)); err != nil {
		span.RecordError(errors.New("park reserve check failed"))
		span.SetStatus(codes.Error, "park reserve check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("park reserve check failed")
	}
}

func runCabinPrepTick(ctx context.Context, cabin *smartreadinesssvc.CabinPrep, delivery *smartdeliverysvc.Service) {
	ctx, span := workerTracer().Start(ctx, "notification.cabin_prep_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	outcomes, err := cabin.ProcessDue(ctx, 6)
	for reason, count := range outcomes {
		metrics.RecordCabinPrepLifecycle(string(reason), count)
	}
	if err = errors.Join(err, delivery.DeliverCabinPrep(ctx, 6)); err != nil {
		span.RecordError(errors.New("cabin prep reminder check failed"))
		span.SetStatus(codes.Error, "cabin prep reminder check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("cabin prep reminder check failed")
	}
}

func runSolarChargingTick(ctx context.Context, service *smartreadinesssvc.Service, connections *smartreadinesssvc.SolarEnergyConnections) {
	ctx, span := workerTracer().Start(ctx, "notification.solar_charging_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	processed, err := service.ProcessSolarCharging(ctx, 4)
	err = errors.Join(err, connections.Prune(ctx))
	span.SetAttributes(attribute.Int("notification.solar_charging.processed", processed))
	if err != nil {
		span.RecordError(errors.New("solar charging check failed"))
		span.SetStatus(codes.Error, "solar charging check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("solar charging check failed")
	}
}

func runBackupChargingTick(ctx context.Context, backup *smartreadinesssvc.BackupCharging, delivery *smartdeliverysvc.Service) {
	ctx, span := workerTracer().Start(ctx, "notification.backup_charging_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	checked, err := backup.ProcessBackupCharging(ctx, 3, delivery.NotifyBackupCharging)
	span.SetAttributes(attribute.Int("notification.backup_charging.checked", checked))
	if err = errors.Join(err, delivery.PruneBackupCharging(ctx)); err != nil {
		span.RecordError(errors.New("backup charging check failed"))
		span.SetStatus(codes.Error, "backup charging check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("backup charging check failed")
	}
}

func runPublicFeeTick(ctx context.Context, service *smartreadinesssvc.Service, delivery *smartdeliverysvc.Service) {
	ctx, span := workerTracer().Start(ctx, "notification.public_charging_fee_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	eligible, err := service.ProcessPublicFees(ctx, 25, delivery.NotifyPublicFee)
	span.SetAttributes(attribute.Int("notification.public_charging_fee.eligible", eligible))
	if err != nil {
		span.RecordError(errors.New("public charging fee evaluation failed"))
		span.SetStatus(codes.Error, "public charging fee evaluation failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("public charging fee evaluation failed")
	}
}

func smartChargingEnabled(cfg *config.Config) bool {
	return cfg.Redis.Enabled &&
		!strings.EqualFold(strings.TrimSpace(cfg.FleetTelemetry.LiveSignalStoreMode), "local")
}

func runSmartChargingLoop(ctx context.Context, processor smartChargingProcessor, ticks <-chan time.Time) {
	for ctx.Err() == nil {
		runSmartChargingTick(ctx, processor)
		select {
		case <-ctx.Done():
			return
		case <-ticks:
		}
	}
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
