package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type rainQuietHours interface {
	ListByUser(context.Context, string) ([]*models.QuietHoursWindow, error)
}

type WindowRainWatches struct {
	repo     port.WindowRainRepository
	live     LiveSignals
	forecast port.WindowRainForecastSource
	quiet    rainQuietHours
	now      func() time.Time
}

func NewWindowRainWatches(repo port.WindowRainRepository, live LiveSignals, forecast port.WindowRainForecastSource, quiet rainQuietHours, now func() time.Time) *WindowRainWatches {
	if now == nil {
		now = time.Now
	}
	return &WindowRainWatches{repo: repo, live: live, forecast: forecast, quiet: quiet, now: now}
}

func validWindowRainScope(scope port.WindowRainScope) bool {
	return scope.VehicleID > 0 && len(scope.Subject) <= 512 && validRecallSubject(scope.Subject)
}

func (s *WindowRainWatches) Enable(ctx context.Context, scope port.WindowRainScope, expectedID int64, setup domain.WindowRainSetup) error {
	if !validWindowRainScope(scope) {
		return port.ErrNotFound
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	if expectedID < 0 || setup.DeviceID <= 0 || !validCabinPushCopy(setup.PushTitle) || !validCabinPushCopy(setup.PushBody) ||
		setup.DurationS < 15*60 || setup.DurationS > 4*60*60 ||
		!setup.OutdoorConfirmed || !setup.ForecastConsent || !setup.FreeTermsApply {
		return ErrInvalidInput
	}
	values, grid, reason, err := s.livePark(ctx, scope.VehicleID, now)
	if err != nil {
		return err
	}
	if reason != "" {
		return port.ErrWindowRainChanged
	}
	parkAt := values["Gear"].Timestamp.UTC().Truncate(time.Microsecond)
	moved, err := s.repo.WindowRainParkEnded(ctx, scope.VehicleID, parkAt, now, now)
	if err != nil {
		return err
	}
	if moved {
		return port.ErrWindowRainChanged
	}
	return s.repo.ReplaceWindowRain(ctx, scope, expectedID, setup, grid, now, parkAt)
}

func (s *WindowRainWatches) Pause(ctx context.Context, scope port.WindowRainScope, id int64) error {
	if !validWindowRainScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.PauseWindowRain(ctx, scope, id)
}

func (s *WindowRainWatches) Clear(ctx context.Context, scope port.WindowRainScope, id int64) error {
	if !validWindowRainScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteWindowRain(ctx, scope, id)
}

func (s *WindowRainWatches) Read(ctx context.Context, scope port.WindowRainScope) (*domain.WindowRainPlan, error) {
	if !validWindowRainScope(scope) {
		return nil, port.ErrNotFound
	}
	plan, err := s.repo.ReadWindowRain(ctx, scope)
	if err != nil || plan == nil {
		return plan, err
	}
	now := s.now().UTC()
	if !plan.WatchUntil.After(now) {
		plan.Risk, plan.Reason = nil, domain.WindowRainExpired
	}
	if plan.Risk != nil {
		values, reason, err := s.samePark(ctx, scope.VehicleID, *plan, now)
		if err != nil {
			return nil, err
		}
		switch {
		case !plan.DeviceReady || !plan.Risk.ExpiresAt.After(now):
			plan.Risk, plan.Reason = nil, domain.WindowRainExpired
		case reason != "":
			plan.Risk, plan.Reason = nil, reason
		case !openWindowAt(values, plan.Risk.Window.Position, now):
			plan.Risk, plan.Reason = nil, domain.WindowRainNoOpenWindow
		}
	}
	return plan, nil
}

func (s *WindowRainWatches) CanDeliver(ctx context.Context, scope port.WindowRainScope, planID, deviceID int64) (bool, error) {
	plan, err := s.Read(ctx, scope)
	return plan != nil && plan.Risk != nil && plan.ID == planID && plan.DeviceReady && plan.DeviceID == deviceID, err
}

func (s *WindowRainWatches) ProcessDue(ctx context.Context, limit int) (map[domain.WindowRainReason]int, error) {
	outcomes := make(map[domain.WindowRainReason]int)
	if s.forecast == nil || limit < 1 || limit > 4 {
		return outcomes, ErrInvalidInput
	}
	if err := s.repo.ExpireWindowRain(ctx, s.now().UTC()); err != nil {
		return outcomes, err
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimWindowRain(ctx, now, now.Add(30*time.Second))
		if err != nil || job == nil {
			return outcomes, err
		}
		result, err := s.checkWindowRain(ctx, *job, now)
		if err != nil {
			return outcomes, err
		}
		finishedAt := s.now().UTC()
		if result.Risk != nil && !result.Risk.ExpiresAt.After(finishedAt) {
			result = retryWindowRain(job.Plan, domain.WindowRainUnknownState, finishedAt.Add(time.Minute))
		}
		applied, err := s.repo.FinishWindowRain(ctx, *job, result, finishedAt)
		if err != nil {
			return outcomes, err
		}
		if applied {
			outcomes[result.Reason]++
		}
	}
	return outcomes, nil
}

func (s *WindowRainWatches) checkWindowRain(ctx context.Context, job port.WindowRainJob, now time.Time) (port.WindowRainCheck, error) {
	values, reason, err := s.samePark(ctx, job.Scope.VehicleID, job.Plan, now)
	if err != nil {
		return port.WindowRainCheck{}, err
	}
	if reason != "" {
		return retryWindowRain(job.Plan, reason, now.Add(time.Minute)), nil
	}
	if observeOpenParkedWindow(values, now) == nil {
		return retryWindowRain(job.Plan, domain.WindowRainNoOpenWindow, now.Add(time.Minute)), nil
	}

	authorize := func(ctx context.Context) error {
		checkAt := s.now().UTC()
		active, err := s.repo.WindowRainLeaseActive(ctx, job, checkAt)
		if err != nil {
			return err
		}
		if !active {
			return port.ErrWindowRainChanged
		}
		current, reason, err := s.samePark(ctx, job.Scope.VehicleID, job.Plan, checkAt)
		if err != nil {
			return err
		}
		if reason != "" || observeOpenParkedWindow(current, checkAt) == nil {
			return port.ErrWindowRainChanged
		}
		return nil
	}
	forecast, err := s.forecast.ForecastRain(ctx, float64(job.Plan.Grid.LatitudeHundredths)/100,
		float64(job.Plan.Grid.LongitudeHundredths)/100, authorize)
	switch {
	case errors.Is(err, port.ErrWindowRainChanged):
		return retryWindowRain(job.Plan, domain.WindowRainUnknownState, now.Add(time.Minute)), nil
	case err != nil || len(forecast.Hours) == 0:
		return retryWindowRain(job.Plan, domain.WindowRainNoForecast, now.Add(15*time.Minute)), nil
	}
	now = s.now().UTC()
	values, reason, err = s.samePark(ctx, job.Scope.VehicleID, job.Plan, now)
	if err != nil {
		return port.WindowRainCheck{}, err
	}
	if reason != "" {
		return retryWindowRain(job.Plan, reason, now.Add(15*time.Minute)), nil
	}
	if risk := windowRainRisk(values, true, forecast, now, job.Plan.WatchUntil); risk != nil {
		_, _, locationAt, _ := freshLocation(values, now)
		risk.ExpiresAt = minTime(risk.ExpiresAt, locationAt.Add(signal.LiveSignalFreshnessThreshold))
		if risk.ExpiresAt.After(now) {
			recheckAt, err := s.rainRiskRecheckAt(ctx, job.Scope.Subject, now, job.Plan.WatchUntil)
			if err != nil {
				return port.WindowRainCheck{}, err
			}
			check := retryWindowRain(job.Plan, domain.WindowRainAtRisk, recheckAt)
			check.Risk = risk
			return check, nil
		}
	}
	return retryWindowRain(job.Plan, domain.WindowRainDry, now.Add(15*time.Minute)), nil
}

func (s *WindowRainWatches) rainRiskRecheckAt(ctx context.Context, subject string, now, watchUntil time.Time) (time.Time, error) {
	next := now.Add(15 * time.Minute)
	if s.quiet == nil {
		return next, nil
	}
	windows, err := s.quiet.ListByUser(ctx, subject)
	if err != nil {
		return time.Time{}, fmt.Errorf("read quiet hours for window rain recheck: %w", err)
	}
	if _, active := notification.MatchActiveWindow(windows, "info", now); active {
		for at := now.Truncate(time.Minute).Add(time.Minute); at.Before(minTime(next, watchUntil)); at = at.Add(time.Minute) {
			if _, quiet := notification.MatchActiveWindow(windows, "info", at); !quiet {
				return at, nil
			}
		}
	}
	return next, nil
}

func retryWindowRain(plan domain.WindowRainPlan, reason domain.WindowRainReason, at time.Time) port.WindowRainCheck {
	result := port.WindowRainCheck{Reason: reason}
	if reason != domain.WindowRainMoved && at.Before(plan.WatchUntil) {
		result.NextCheck = &at
	}
	return result
}

func (s *WindowRainWatches) samePark(ctx context.Context, vehicle int64, plan domain.WindowRainPlan, now time.Time) (map[string]*signal.Value, domain.WindowRainReason, error) {
	if plan.ParkObservedAt.IsZero() {
		return nil, domain.WindowRainMoved, nil
	}
	moved, err := s.repo.WindowRainParkEnded(ctx, vehicle, plan.ParkObservedAt, plan.CreatedAt, now)
	if err != nil || moved {
		return nil, domain.WindowRainMoved, err
	}
	values, grid, reason, err := s.livePark(ctx, vehicle, now)
	if reason == "" && grid != plan.Grid {
		reason = domain.WindowRainMoved
	}
	return values, reason, err
}

func (s *WindowRainWatches) livePark(ctx context.Context, vehicle int64, now time.Time) (map[string]*signal.Value, domain.WeatherGrid, domain.WindowRainReason, error) {
	if s.live == nil {
		return nil, domain.WeatherGrid{}, domain.WindowRainUnknownState, nil
	}
	values, err := s.live.GetAll(ctx, vehicle, signal.LiveSignalReadDistributed)
	if err != nil {
		return nil, domain.WeatherGrid{}, domain.WindowRainUnknownState, fmt.Errorf("read distributed outdoor park signals: %w", err)
	}
	gear := values["Gear"]
	if !freshObservation(gear, now) {
		return nil, domain.WeatherGrid{}, domain.WindowRainUnknownState, nil
	}
	switch gear.Raw {
	case enums.GearPark:
	case enums.GearDrive, enums.GearReverse, enums.GearNeutral:
		return nil, domain.WeatherGrid{}, domain.WindowRainMoved, nil
	default:
		return nil, domain.WeatherGrid{}, domain.WindowRainUnknownState, nil
	}
	latitude, longitude, _, known := freshLocation(values, now)
	if !known || (latitude == 0 && longitude == 0) {
		return nil, domain.WeatherGrid{}, domain.WindowRainUnknownState, nil
	}
	grid := domain.WeatherGrid{LatitudeHundredths: int(math.Round(latitude * 100)), LongitudeHundredths: int(math.Round(longitude * 100))}
	if grid == (domain.WeatherGrid{}) {
		return nil, domain.WeatherGrid{}, domain.WindowRainUnknownState, nil
	}
	return values, grid, "", nil
}
