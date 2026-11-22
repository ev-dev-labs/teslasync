package main

import (
	"context"
	"errors"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveefficiencysvc"
	efficiencydb "github.com/ev-dev-labs/teslasync/internal/database/driveefficiency"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	"github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc"
	costsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/costtrend"
	mileagesvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/mileageterm"
	tariffsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/monthlytariff"
	renewalsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/subscriptionrenewal"
	packetsvc "github.com/ev-dev-labs/teslasync/internal/app/ownershipintelsvc/trippacket"
	"github.com/ev-dev-labs/teslasync/internal/app/smartmediasvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/database"
	ownershipinteldb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel"
	costdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/costtrend"
	mileagedb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/mileageterm"
	tariffdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/monthlytariff"
	renewaldb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/subscriptionrenewal"
	packetdb "github.com/ev-dev-labs/teslasync/internal/database/ownershipintel/trippacket"
	mediadb "github.com/ev-dev-labs/teslasync/internal/database/smartmedia"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func startLocalPlanningChecks(ctx context.Context, db *database.DB, forwardAuthHeader string) func() {
	if tsauth.IsOpenMode(forwardAuthHeader) {
		return func() {}
	}
	ctx, cancel := context.WithCancel(ctx)
	warranties := ownershipintelsvc.NewWarrantyReminders(ownershipinteldb.NewDurableRepository(db), nil)
	readiness := readinessdb.NewRepository(db)
	maintenance := smartreadinesssvc.NewTripMaintenance(readiness, time.Now)
	recalls := smartreadinesssvc.NewRecallWatch(readiness, nhtsa.NewClient(nhtsa.Config{}), time.Now)
	history := signal.NewLogStateReader(db.Pool, log.Logger)
	climate := smartreadinesssvc.NewClimateScheduleReviews(readiness, history, time.Now)
	overnight := smartreadinesssvc.NewOvernightDrainReviews(readiness,
		smartreadinesssvc.NewOvernightDrainHistory(readiness, history), time.Now)
	capacity := smartreadinesssvc.NewCapacityTrendReviews(readiness,
		smartreadinesssvc.NewCapacityTrendHistory(readiness, history), time.Now)
	favorites := smartmediasvc.NewFavoriteDigests(mediadb.NewRepository(db), time.Now)
	chargingCosts := costsvc.NewReviews(costdb.NewRepository(db.Pool), costdb.NewSource(db.Pool), time.Now)
	monthlyTariffs := tariffsvc.NewReviews(tariffdb.NewRepository(db.Pool), tariffdb.NewSource(db.Pool), time.Now)
	mileageTerms := mileagesvc.NewReviews(mileagedb.NewRepository(db.Pool), time.Now)
	tripPackets := packetsvc.NewReviews(packetdb.NewRepository(db.Pool), time.Now)
	renewals := renewalsvc.NewReviews(renewaldb.NewRepository(db.Pool), time.Now)
	weeklyEfficiency := driveefficiencysvc.NewReviews(efficiencydb.NewRepository(db.Pool), history, time.Now)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for ctx.Err() == nil {
			runWarrantyReminderTick(ctx, warranties)
			runTripMaintenanceTick(ctx, maintenance)
			runRecallWatchTick(ctx, recalls)
			runClimateScheduleTick(ctx, climate)
			runOvernightDrainTick(ctx, overnight)
			runCapacityDigestTick(ctx, capacity)
			runFavoriteDigestTick(ctx, favorites)
			runChargingCostDigestTick(ctx, chargingCosts)
			runMonthlyTariffReviewTick(ctx, monthlyTariffs)
			runMileageTermReviewTick(ctx, mileageTerms)
			runTripPacketTick(ctx, tripPackets)
			runSubscriptionRenewalTick(ctx, renewals)
			runWeeklyDriveEfficiencyTick(ctx, weeklyEfficiency)
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

func runWarrantyReminderTick(ctx context.Context, service *ownershipintelsvc.WarrantyReminders) {
	tracer := workerTracer()
	ctx, span := tracer.Start(ctx, "notification.warranty_distance_tick")
	defer span.End()
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	batch, err := service.ProcessDue(ctx, 20)
	checked := 0
	for outcome, count := range batch.Outcomes {
		checked += count
		metrics.RecordWarrantyReminderCheck(outcome, count)
	}
	metrics.RecordWarrantyReminderPublication(batch.Published)
	span.SetAttributes(attribute.Int("notification.warranty_distance.checked", checked))
	if err != nil {
		span.RecordError(errors.New("warranty mileage check failed"))
		span.SetStatus(codes.Error, "warranty mileage check failed")
		log.Error().Str("trace_id", span.SpanContext().TraceID().String()).Msg("warranty mileage check failed")
	}
}
