package smartreadinesssvc

import (
	"context"
	"fmt"
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	parkReserveActionWindow = 90 * time.Minute
	parkReserveRetry        = 5 * time.Minute
)

type parkEpisodeSource interface {
	Episodes(context.Context, int64, time.Time, time.Duration) ([]domain.ParkReserveEpisode, error)
}

type ParkReserves struct {
	repo    port.ParkReserveRepository
	history parkEpisodeSource
	live    LiveSignals
	now     func() time.Time
}

func NewParkReserves(repo port.ParkReserveRepository, history parkEpisodeSource, live LiveSignals, now func() time.Time) *ParkReserves {
	if now == nil {
		now = time.Now
	}
	return &ParkReserves{repo: repo, history: history, live: live, now: now}
}

func validParkReserveScope(scope port.ParkReserveScope) bool {
	return scope.VehicleID > 0 && len(scope.Subject) <= 512 && validRecallSubject(scope.Subject)
}

func (s *ParkReserves) Read(ctx context.Context, scope port.ParkReserveScope) (*domain.ParkReservePlan, error) {
	return s.read(ctx, scope, true)
}

func (s *ParkReserves) read(ctx context.Context, scope port.ParkReserveScope, recheckHistory bool) (*domain.ParkReservePlan, error) {
	if !validParkReserveScope(scope) {
		return nil, port.ErrNotFound
	}
	plan, err := s.repo.ReadParkReserve(ctx, scope)
	if err != nil || plan == nil {
		return plan, err
	}
	now := s.now().UTC()
	if !plan.ReturnAt.After(now) || !plan.ActionUntil.After(now) {
		plan.Reason, plan.Estimate, plan.Forecast = domain.ParkReserveExpired, nil, nil
		return plan, nil
	}
	if plan.Forecast != nil {
		live, reason, err := s.currentPark(ctx, *plan, now)
		switch {
		case err != nil:
			return nil, err
		case reason != "":
			plan.Reason, plan.Estimate, plan.Forecast = reason, nil, nil
		case math.Abs(plan.Forecast.StartBatteryPct-live.BatteryPct) > 0.5 ||
			math.Abs(plan.Forecast.OutsideC-live.OutsideC) > 2 || plan.Forecast.SentryMode != live.SentryMode:
			plan.Reason, plan.Estimate, plan.Forecast = domain.ParkReserveChanged, nil, nil
		case recheckHistory:
			// Late or corrected telemetry can invalidate historical brackets.
			result, err := s.estimatePark(ctx, *plan, live, now)
			if err != nil {
				return nil, err
			}
			plan.Reason, plan.Estimate, plan.Forecast = result.Reason, nil, result.Forecast
			if result.Forecast != nil {
				plan.Estimate = &result.Forecast.ParkReserveEstimate
			}
		}
	}
	return plan, nil
}

func (s *ParkReserves) CanDeliver(ctx context.Context, scope port.ParkReserveScope, planID, deviceID int64, recheckHistory bool) (bool, error) {
	plan, err := s.read(ctx, scope, recheckHistory)
	if err != nil || plan == nil {
		return false, err
	}
	now := s.now().UTC()
	return plan.ID == planID && plan.DeviceReady && plan.DeviceID != nil && *plan.DeviceID == deviceID &&
		plan.Estimate != nil && plan.Reason == domain.ParkReserveAtRisk &&
		plan.ActionUntil.After(now) && (!recheckHistory || now.Sub(plan.Estimate.ObservedAt) <= 2*time.Minute), nil
}

func (s *ParkReserves) Enable(ctx context.Context, scope port.ParkReserveScope, expectedID int64, setup domain.ParkReserveSetup) error {
	if !validParkReserveScope(scope) {
		return port.ErrNotFound
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	setup.ReturnAt = setup.ReturnAt.UTC().Truncate(time.Microsecond)
	stay := setup.ReturnAt.Sub(now)
	if expectedID < 0 || stay < parkReserveMinStay || stay > parkReserveMaxStay || !finiteBetween(setup.ReservePct, 5, 90) {
		return ErrInvalidInput
	}
	if setup.DeviceID != nil {
		if *setup.DeviceID <= 0 || !validCabinPushCopy(setup.PushTitle) || !validCabinPushCopy(setup.PushBody) {
			return ErrInvalidInput
		}
	} else if setup.PushTitle != "" || setup.PushBody != "" {
		return ErrInvalidInput
	}
	return s.repo.ReplaceParkReserve(ctx, scope, expectedID, setup, now, now.Add(parkReserveActionWindow))
}

func (s *ParkReserves) Disable(ctx context.Context, scope port.ParkReserveScope, expectedID int64) error {
	if !validParkReserveScope(scope) {
		return port.ErrNotFound
	}
	if expectedID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteParkReserve(ctx, scope, expectedID)
}

func (s *ParkReserves) ProcessDue(ctx context.Context, limit int) (map[domain.ParkReserveReason]int, error) {
	outcomes := make(map[domain.ParkReserveReason]int)
	for range min(limit, 10) {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimParkReserve(ctx, now, now.Add(2*time.Minute))
		if err != nil || job == nil {
			return outcomes, err
		}
		result, err := s.evaluatePark(ctx, job.Plan, now)
		if err != nil {
			return outcomes, err
		}
		finishedAt := s.now().UTC()
		if !job.Plan.ActionUntil.After(finishedAt) {
			result = port.ParkReserveResult{Reason: domain.ParkReserveExpired}
		}
		applied, err := s.repo.FinishParkReserve(ctx, *job, result, finishedAt)
		if err != nil {
			return outcomes, err
		}
		if applied && result.Reason != "" {
			outcomes[result.Reason]++
		}
	}
	return outcomes, nil
}

func (s *ParkReserves) evaluatePark(ctx context.Context, plan domain.ParkReservePlan, now time.Time) (port.ParkReserveResult, error) {
	if !plan.ActionUntil.After(now) {
		return port.ParkReserveResult{Reason: domain.ParkReserveExpired}, nil
	}
	live, reason, err := s.currentPark(ctx, plan, now)
	if err != nil {
		return port.ParkReserveResult{}, err
	}
	if reason != "" {
		next := now.Add(parkReserveRetry)
		if reason == domain.ParkReserveUnknownState && next.Before(plan.ActionUntil) {
			return port.ParkReserveResult{NextCheck: &next}, nil
		}
		return port.ParkReserveResult{Reason: reason}, nil
	}
	return s.estimatePark(ctx, plan, live, now)
}

func (s *ParkReserves) estimatePark(ctx context.Context, plan domain.ParkReservePlan, live domain.ParkReserveConditions, now time.Time) (port.ParkReserveResult, error) {
	stay := plan.ReturnAt.Sub(now)
	episodes, err := s.history.Episodes(ctx, plan.VehicleID, now, stay)
	if err != nil {
		return port.ParkReserveResult{}, err
	}
	estimate, reason := EstimateParkReserve(episodes, live, now, plan.ReturnAt, plan.ReservePct)
	result := port.ParkReserveResult{Reason: reason}
	if estimate != nil {
		result.Forecast = &domain.ParkReserveForecast{ParkReserveEstimate: *estimate, OutsideC: live.OutsideC, SentryMode: live.SentryMode}
	}
	return result, nil
}

func (s *ParkReserves) currentPark(ctx context.Context, plan domain.ParkReservePlan, now time.Time) (domain.ParkReserveConditions, domain.ParkReserveReason, error) {
	var conditions domain.ParkReserveConditions
	activity, err := s.repo.ParkReserveActivity(ctx, plan.VehicleID, plan.CreatedAt, now)
	if err != nil || activity {
		return conditions, domain.ParkReserveChanged, err
	}
	if s.live == nil {
		return conditions, domain.ParkReserveUnknownState, nil
	}
	values, err := s.live.GetAll(ctx, plan.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return conditions, domain.ParkReserveUnknownState, fmt.Errorf("read distributed parked-reserve observations: %w", err)
	}
	conditions.ObservedAt = now
	for _, field := range []string{parkGear, parkAmbient, parkBattery, parkSentry, parkChargeState, parkChargeLatch} {
		value := values[field]
		if !freshObservation(value, now) {
			return conditions, domain.ParkReserveUnknownState, nil
		}
		if value.Timestamp.Before(conditions.ObservedAt) {
			conditions.ObservedAt = value.Timestamp
		}
	}
	conditions.Parked = values[parkGear].Raw == enums.GearPark
	conditions.Unplugged = values[parkChargeState].Raw == "Disconnected" && values[parkChargeLatch].Raw == "Disengaged"
	if !conditions.Parked || !conditions.Unplugged {
		return conditions, domain.ParkReserveChanged, nil
	}
	conditions.SentryMode, _ = values[parkSentry].Raw.(string)
	battery, batteryKnown := signal.Float64(values[parkBattery].Raw)
	outside, outsideKnown := signal.Float64(values[parkAmbient].Raw)
	conditions.BatteryPct, conditions.OutsideC = battery, outside
	if !batteryKnown || !outsideKnown || !parkObservationUsable(conditions, now) {
		return conditions, domain.ParkReserveUnknownState, nil
	}
	return conditions, "", nil
}
