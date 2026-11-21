package smartcommutesvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveevidence"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	maxTrafficChecksPerTick = 10
	maxTrafficCheckDelay    = 2 * time.Minute
	maxPointSkew            = 10 * time.Second
	liveOriginRadiusM       = 150
)

type TrafficLiveReader interface {
	GetAll(context.Context, int64, signal.LiveSignalReadPreference) (map[string]*signal.Value, error)
}

type TrafficQuietCheck func(context.Context, string, time.Time) (bool, error)

type TrafficNotifier func(ctx context.Context, subject string, consentID, routineID int64, departureAt time.Time) error

type trafficEvaluation struct {
	live           TrafficLiveReader
	source         port.TrafficSource
	isQuiet        TrafficQuietCheck
	observe        func(reason string)
	notify         TrafficNotifier
	energy         *routeEnergySource
	sharedOpenMode bool
}

func WithTrafficLiveReader(live TrafficLiveReader) Option {
	return func(s *Service) { s.traffic.live = live }
}

func WithTrafficSharedOpenMode(shared bool) Option {
	return func(s *Service) { s.traffic.sharedOpenMode = shared }
}

func WithTrafficEvaluator(source port.TrafficSource, quiet TrafficQuietCheck, observe func(string)) Option {
	return func(s *Service) {
		s.traffic.source, s.traffic.isQuiet, s.traffic.observe = source, quiet, observe
	}
}

func WithTrafficNotifier(notify TrafficNotifier) Option {
	return func(s *Service) { s.traffic.notify = notify }
}

func (s *Service) ProcessTrafficChecks(ctx context.Context, limit int) (int, error) {
	if s.traffic.source == nil || s.traffic.live == nil || s.traffic.isQuiet == nil || limit <= 0 {
		return 0, nil
	}
	var processed int
	for processed < min(limit, maxTrafficChecksPerTick) {
		now := s.now()
		check, err := s.repository.ClaimTrafficCheck(ctx, now, s.traffic.sharedOpenMode, func(task port.TrafficCheck) (time.Time, time.Time, bool) {
			after := maxInstant(task.Consent.DepartureAt, now.Add(time.Duration(task.Consent.LeadS)*time.Second))
			window, ok := nextTrafficWindow(task.Settings, task.Routine, task.Consent.LeadS, after)
			return window.checkAt, window.departureAt, ok
		})
		if err != nil {
			return processed, err
		}
		if check == nil {
			break
		}
		processed++
		if err := s.processTrafficCheck(ctx, *check); err != nil {
			return processed, err
		}
	}
	return processed, nil
}

func (s *Service) processTrafficCheck(ctx context.Context, check port.TrafficCheck) error {
	if check.AlreadyChecked {
		s.recordTraffic("duplicate_or_skipped")
		return nil
	}
	authorize := func(ctx context.Context) error {
		now := s.now()
		if !now.Before(check.Consent.DepartureAt) || now.Sub(check.Consent.CheckAt) > maxTrafficCheckDelay {
			return port.ErrTrafficClaimLost
		}
		if err := s.repository.VerifyTrafficCheck(ctx, check, now); err != nil {
			return err
		}
		quiet, err := s.traffic.isQuiet(ctx, check.Subject, now)
		if err != nil {
			return fmt.Errorf("check private traffic quiet hours: %w", err)
		}
		if quiet {
			return errTrafficQuietHours
		}
		eligible, err := s.parkedAtOrigin(ctx, check.Routine.VehicleID, check.Routine.Origin, now)
		if err != nil {
			return err
		}
		if !eligible {
			return errTrafficOriginUnknown
		}
		return s.repository.VerifyTrafficCheck(ctx, check, s.now())
	}
	if err := authorize(ctx); err != nil {
		return s.observeTrafficSuppression(err)
	}
	var authErr error
	guarded := func(ctx context.Context) error {
		authErr = authorize(ctx)
		return authErr
	}
	comparison, err := s.traffic.source.Compare(ctx, domain.TrafficQuery{
		Trace: check.Consent.Trace, DepartureAt: check.Consent.DepartureAt,
		RequireOfferedCoverage: check.Consent.ArrivalDeadlineS != nil,
		IncludeRouteGeometry:   check.Consent.CompareRouteEnergy && s.traffic.energy != nil,
	}, guarded)
	if authErr != nil {
		return s.observeTrafficSuppression(authErr)
	}
	if err != nil {
		s.recordTraffic("provider_unqualified")
		return nil
	}
	now := s.now()
	window := trafficWindow{departureAt: check.Consent.DepartureAt, checkAt: check.Consent.CheckAt}
	decision := domain.TrafficDecision{
		UsualS: comparison.Usual.DurationS, AlternativeS: comparison.Alternative.DurationS,
		UsualRouteLabel: comparison.Usual.RouteLabel, AlternativeRouteLabel: comparison.Alternative.RouteLabel,
		ObservedAt: minInstant(comparison.Usual.FlowUpdatedAt, comparison.Alternative.FlowUpdatedAt),
	}
	if check.Consent.ArrivalDeadlineS != nil && comparison.AlternativesQualified {
		deadlineAt := arrivalDeadlineAt(window.departureAt, check.Routine, *check.Consent.ArrivalDeadlineS)
		if deadline, ok := evaluateArrivalDeadline(window, deadlineAt, comparison, now); ok {
			earlier, err := s.traffic.source.Compare(ctx, domain.TrafficQuery{
				Trace: check.Consent.Trace, DepartureAt: deadline.latestAt,
			}, guarded)
			if authErr != nil {
				return s.observeTrafficSuppression(authErr)
			}
			now = s.now()
			if err == nil {
				if observedAt, expiresAt, feasible := confirmEarlierDeparture(deadline, earlier, now); feasible {
					decision.ArrivalDeadlineAt, decision.LatestDepartureAt = &deadline.deadlineAt, &deadline.latestAt
					decision.ObservedAt = minInstant(decision.ObservedAt, observedAt)
					decision.ExpiresAt = expiresAt
				}
			}
		}
	}
	if decision.ArrivalDeadlineAt == nil {
		expiresAt, ok := trafficOpportunity(window, comparison, check.Consent.MinSavingsS, now)
		if ok {
			decision.ExpiresAt = expiresAt
		}
	}
	energy, energyObserved, energyExpires := s.compareTrafficEnergy(ctx, check, comparison.OfferedRoutes, authorize)
	if energy != nil {
		decision.RouteEnergy = energy
		if decision.ExpiresAt.IsZero() {
			decision.RouteEnergyOnly = true
			decision.UsualS, decision.AlternativeS = energy.Fastest.ETAS, energy.Saving.ETAS
			decision.UsualRouteLabel, decision.AlternativeRouteLabel = "", ""
			decision.ObservedAt, decision.ExpiresAt = energyObserved, energyExpires
		}
	}
	if decision.ExpiresAt.IsZero() {
		s.recordTraffic("not_material_or_stale")
		return nil
	}
	if err := authorize(ctx); err != nil {
		return s.observeTrafficSuppression(err)
	}
	saved, err := s.repository.RecordTrafficDecision(ctx, check, decision, s.now())
	if err != nil {
		return err
	}
	if saved {
		s.recordTraffic("eligible")
		if s.traffic.notify != nil && !decision.RouteEnergyOnly {
			return s.traffic.notify(ctx, check.Subject, check.ConsentID, check.Routine.ID, check.Consent.DepartureAt)
		}
	}
	return nil
}

var (
	errTrafficQuietHours    = errors.New("private traffic quiet hours")
	errTrafficOriginUnknown = errors.New("vehicle not known to be parked near the routine origin")
)

func (s *Service) observeTrafficSuppression(err error) error {
	switch {
	case errors.Is(err, port.ErrTrafficClaimLost):
		s.recordTraffic("expired_or_revoked")
	case errors.Is(err, errTrafficQuietHours):
		s.recordTraffic("quiet_hours")
	case errors.Is(err, errTrafficOriginUnknown):
		s.recordTraffic("not_at_origin")
	default:
		return err
	}
	return nil
}

func (s *Service) recordTraffic(reason string) {
	if s.traffic.observe != nil {
		s.traffic.observe(reason)
	}
}

func (s *Service) ListTrafficDecisions(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]domain.TrafficDecision, error) {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 || (vehicleID != nil && *vehicleID <= 0) {
		return nil, ErrInvalidInput
	}
	result := make([]domain.TrafficDecision, 0)
	if s.traffic.live == nil {
		return result, nil
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.repository.ListTrafficDecisions(ctx, subject, vehicleID, now, limit)
	if err != nil {
		return nil, err
	}
	parkedOrigins := make(map[string]domain.Point, len(rows))
	for _, row := range rows {
		parked, err := s.parkedAtOrigin(ctx, row.VehicleID, row.Origin, s.now())
		if err != nil {
			return nil, err
		}
		if parked && row.ExpiresAt.After(s.now()) {
			parkedOrigins[domain.TrafficOccurrenceID(row.RoutineID, row.DepartureAt)] = row.Origin
		}
	}
	if len(parkedOrigins) == 0 {
		return result, nil
	}
	verifiedAt := s.now()
	rows, err = s.repository.ListTrafficDecisions(ctx, subject, vehicleID, verifiedAt, limit)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row.OccurrenceID = domain.TrafficOccurrenceID(row.RoutineID, row.DepartureAt)
		if origin, ok := parkedOrigins[row.OccurrenceID]; !ok || origin != row.Origin {
			continue
		}
		if row.RouteEnergy != nil && !row.RouteEnergy.ExpiresAt.After(verifiedAt) {
			row.RouteEnergy = nil
		}
		result = append(result, row)
	}
	return result, nil
}

func (s *Service) parkedAtOrigin(ctx context.Context, vehicleID int64, origin domain.Point, now time.Time) (bool, error) {
	return ParkedAtTrafficOrigin(ctx, s.traffic.live, vehicleID, origin, now)
}

func ParkedAtTrafficOrigin(ctx context.Context, live TrafficLiveReader, vehicleID int64, origin domain.Point, now time.Time) (bool, error) {
	if live == nil {
		return false, nil
	}
	values, err := live.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return false, fmt.Errorf("read traffic eligibility from live signals: %w", err)
	}
	gear, lat, lng := values["Gear"], values["LocationLatitude"], values["LocationLongitude"]
	for _, value := range []*signal.Value{gear, lat, lng} {
		if value == nil || value.TimestampSynthetic || value.Timestamp.IsZero() || value.Timestamp.After(now) ||
			now.Sub(value.Timestamp) > signal.LiveSignalFreshnessThreshold {
			return false, nil
		}
	}
	gearValue, isString := gear.Raw.(string)
	if !isString || gearValue != enums.GearPark || lat.Timestamp.Sub(lng.Timestamp).Abs() > maxPointSkew {
		return false, nil
	}
	latitude, hasLat := signal.Float64(lat.Raw)
	longitude, hasLng := signal.Float64(lng.Raw)
	point := domain.Point{Latitude: latitude, Longitude: longitude}
	return hasLat && hasLng && validPoint(point) && (latitude != 0 || longitude != 0) &&
		driveevidence.DistanceM(point, origin) <= liveOriginRadiusM, nil
}

func maxInstant(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
