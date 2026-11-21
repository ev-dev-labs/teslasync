package smartreadinesssvc

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	cabinFirstCheckLead   = cabinMaxEpisode + cabinBuffer
	cabinRetryGap         = 4 * time.Minute
	cabinMinNotice        = 3 * time.Minute
	cabinMaxContinuousAge = 18 * time.Hour
)

type cabinHistorySource interface {
	Episodes(context.Context, int64, time.Time, time.Time, *time.Location) ([]domain.CabinPrepEpisode, error)
}

type CabinPrep struct {
	repo    port.CabinPrepRepository
	history cabinHistorySource
	live    LiveSignals
	now     func() time.Time
}

func NewCabinPrep(repo port.CabinPrepRepository, history cabinHistorySource, live LiveSignals, now func() time.Time) *CabinPrep {
	if now == nil {
		now = time.Now
	}
	return &CabinPrep{repo: repo, history: history, live: live, now: now}
}

func validCabinPrepScope(scope port.CabinPrepScope) bool {
	return scope.VehicleID > 0 && len(scope.Subject) <= 512 && validRecallSubject(scope.Subject)
}

func (s *CabinPrep) Read(ctx context.Context, scope port.CabinPrepScope) (domain.CabinPrepPlan, error) {
	if !validCabinPrepScope(scope) {
		return domain.CabinPrepPlan{}, port.ErrNotFound
	}
	record, err := s.repo.ReadCabinPrep(ctx, scope, s.now().UTC())
	if err != nil || record.Estimate == nil {
		return record, err
	}
	live, reason, err := s.currentCabin(ctx, record, s.now().UTC())
	if reason == domain.CabinPrepEligible && !matchesCabinForecast(live, record.Forecast) {
		reason = domain.CabinPrepChanged
	}
	if reason != domain.CabinPrepEligible || err != nil {
		record.Reason, record.Estimate = reason, nil
	}
	return record, err
}

func (s *CabinPrep) Enable(ctx context.Context, scope port.CabinPrepScope, expectedID int64, setup domain.CabinPrepSetup) error {
	if !validCabinPrepScope(scope) {
		return port.ErrNotFound
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	departure := setup.DepartureAt.UTC().Truncate(time.Microsecond)
	loc := cabinZone(setup.TimeZone)
	if expectedID < 0 || setup.DeviceID <= 0 || !validCabinPushCopy(setup.PushTitle) || !validCabinPushCopy(setup.PushBody) ||
		!validCabinDeparture(departure, loc, now) || departure.Sub(now) <= cabinMinNotice ||
		departure.Sub(now) > 14*24*time.Hour || !finiteBetween(setup.TargetC, 16, 29) {
		return ErrInvalidInput
	}
	setup.DepartureAt = departure
	next := departure.Add(-cabinFirstCheckLead)
	if next.Before(now) {
		next = now
	}
	return s.repo.ReplaceCabinPrep(ctx, scope, expectedID, setup, now, next)
}

func (s *CabinPrep) Disable(ctx context.Context, scope port.CabinPrepScope, expectedID int64) error {
	if !validCabinPrepScope(scope) {
		return port.ErrNotFound
	}
	if expectedID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteCabinPrep(ctx, scope, expectedID)
}

func (s *CabinPrep) ProcessDue(ctx context.Context, limit int) (map[domain.CabinPrepReason]int, error) {
	decisions := make(map[domain.CabinPrepReason]int)
	for range min(limit, 10) {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimCabinPrep(ctx, now, now.Add(2*time.Minute))
		if err != nil || job == nil {
			return decisions, err
		}
		active, err := s.repo.CabinPrepStillCurrent(ctx, *job, now)
		if err != nil {
			return decisions, err
		}
		if !active {
			continue
		}
		result, err := s.evaluateCabinPrep(ctx, *job, now)
		if err != nil {
			return decisions, err
		}
		applied, err := s.repo.FinishCabinPrep(ctx, *job, result, s.now().UTC())
		if err != nil {
			return decisions, err
		}
		if applied && result.Reason != "" {
			decisions[result.Reason]++
		}
	}
	return decisions, nil
}

func (s *CabinPrep) evaluateCabinPrep(ctx context.Context, job port.CabinPrepJob, now time.Time) (port.CabinPrepResult, error) {
	plan := job.Plan
	loc := cabinZone(plan.TimeZone)
	if !plan.DepartureAt.After(now) {
		return port.CabinPrepResult{Reason: domain.CabinPrepExpired}, nil
	}
	if !validCabinDeparture(plan.DepartureAt, loc, now) {
		return port.CabinPrepResult{Reason: domain.CabinPrepInvalidPlan}, nil
	}
	live, reason, err := s.currentCabin(ctx, plan, now)
	if err != nil {
		return port.CabinPrepResult{}, err
	}
	forecast := job.Forecast
	leadLow := cabinMinNotice
	if forecast != nil {
		leadLow = max(leadLow, time.Duration(forecast.LeadLowS)*time.Second)
	}
	if reason != domain.CabinPrepEligible {
		next := now.Add(cabinRetryGap)
		if reason == domain.CabinPrepUnknownState && next.Before(plan.DepartureAt.Add(-leadLow)) {
			return port.CabinPrepResult{NextCheck: &next, Forecast: forecast}, nil
		}
		return port.CabinPrepResult{Reason: reason}, nil
	}
	if forecast == nil {
		episodes, err := s.history.Episodes(ctx, plan.VehicleID, now, plan.DepartureAt, loc)
		if err != nil {
			return port.CabinPrepResult{}, err
		}
		estimate, reason := EstimateCabinPrep(episodes, live, plan.DepartureAt, now, loc, plan.TargetC)
		if estimate == nil {
			return port.CabinPrepResult{Reason: reason}, nil
		}
		forecast = &domain.CabinPrepForecast{CabinPrepEstimate: *estimate, CabinC: live.CabinC, OutsideC: live.OutsideC}
	}
	if !matchesCabinForecast(live, forecast) {
		return port.CabinPrepResult{Reason: domain.CabinPrepChanged}, nil
	}
	start := plan.DepartureAt.Add(-time.Duration(forecast.LeadHighS) * time.Second)
	if now.Before(start) {
		return port.CabinPrepResult{NextCheck: &start, Forecast: forecast}, nil
	}
	expiry := plan.DepartureAt.Add(-max(cabinMinNotice, time.Duration(forecast.LeadLowS)*time.Second))
	if !expiry.After(s.now().UTC()) {
		return port.CabinPrepResult{Reason: domain.CabinPrepExpired}, nil
	}
	forecast.ObservedAt = live.ObservedAt
	return port.CabinPrepResult{Reason: domain.CabinPrepEligible, Forecast: forecast, ExpiresAt: &expiry}, nil
}

func matchesCabinForecast(live domain.CabinPrepConditions, forecast *domain.CabinPrepForecast) bool {
	return forecast != nil && math.Abs(live.CabinC-forecast.CabinC) <= 2 && math.Abs(live.OutsideC-forecast.OutsideC) <= 2
}

func (s *CabinPrep) currentCabin(ctx context.Context, plan domain.CabinPrepPlan, now time.Time) (domain.CabinPrepConditions, domain.CabinPrepReason, error) {
	result := domain.CabinPrepConditions{}
	departed, err := s.repo.CabinDriveStarted(ctx, plan.VehicleID, plan.DepartureAt.Add(-45*time.Minute), now)
	if err != nil || departed {
		return result, domain.CabinPrepDeparted, err
	}
	values, err := s.live.GetAll(ctx, plan.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return result, domain.CabinPrepUnknownState, fmt.Errorf("read distributed cabin observations: %w", err)
	}
	result.ObservedAt = now
	gear := values[cabinGear]
	if gear == nil || gear.TimestampSynthetic || gear.Timestamp.IsZero() || gear.Timestamp.After(now) ||
		now.Sub(gear.Timestamp) > cabinMaxContinuousAge {
		return result, domain.CabinPrepUnknownState, nil
	}
	switch gear.Raw {
	case enums.GearDrive, enums.GearReverse, enums.GearNeutral:
		return result, domain.CabinPrepDeparted, nil
	case enums.GearPark:
		if !recentCabinObservation(gear.Timestamp, now) {
			continuous, err := s.repo.CabinParkContinuous(ctx, plan.VehicleID, gear.Timestamp, now)
			if err != nil || !continuous {
				return result, domain.CabinPrepUnknownState, err
			}
		}
	default:
		return result, domain.CabinPrepUnknownState, nil
	}
	power := values[cabinHVAC]
	if power == nil || power.TimestampSynthetic || power.Timestamp.IsZero() || power.Timestamp.After(now) ||
		now.Sub(power.Timestamp) > cabinMaxContinuousAge {
		return result, domain.CabinPrepUnknownState, nil
	}
	hvac, powerKnown := power.Raw.(bool)
	if !powerKnown {
		return result, domain.CabinPrepUnknownState, nil
	}
	if hvac {
		return result, domain.CabinPrepAlreadyActive, nil
	}
	if !recentCabinObservation(power.Timestamp, now) {
		continuous, err := s.repo.CabinHVACOffContinuous(ctx, plan.VehicleID, power.Timestamp, now)
		if err != nil || !continuous {
			return result, domain.CabinPrepUnknownState, err
		}
	}
	for _, field := range []string{cabinInterior, cabinAmbient} {
		value := values[field]
		if value == nil || value.TimestampSynthetic || !recentCabinObservation(value.Timestamp, now) {
			return result, domain.CabinPrepUnknownState, nil
		}
		if value.Timestamp.Before(result.ObservedAt) {
			result.ObservedAt = value.Timestamp.UTC()
		}
	}
	result.Parked = true
	cabin, cabinKnown := signal.Float64(values[cabinInterior].Raw)
	outside, outsideKnown := signal.Float64(values[cabinAmbient].Raw)
	result.HVACOn, result.CabinC, result.OutsideC = hvac, cabin, outside
	switch {
	case !cabinKnown || !outsideKnown ||
		!finiteBetween(cabin, -45, 80) || !finiteBetween(outside, -45, 60):
		return result, domain.CabinPrepUnknownState, nil
	case math.Abs(cabin-plan.TargetC) < 2:
		return result, domain.CabinPrepComfortable, nil
	default:
		return result, domain.CabinPrepEligible, nil
	}
}

func validCabinDeparture(departure time.Time, loc *time.Location, now time.Time) bool {
	return loc != nil && departure.After(now) && departure.In(loc).Hour() >= 5 && departure.In(loc).Hour() < 12
}

func cabinZone(zone string) *time.Location {
	if zone == "" || zone == "Local" || len(zone) > 100 {
		return nil
	}
	loc, _ := time.LoadLocation(zone)
	return loc
}

func validCabinPushCopy(copy string) bool {
	return strings.TrimSpace(copy) != "" && utf8.ValidString(copy) && utf8.RuneCountInString(copy) <= 200 &&
		strings.IndexFunc(copy, unicode.IsControl) == -1
}
