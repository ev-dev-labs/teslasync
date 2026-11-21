package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

var (
	ErrStopRoutingUnavailable = errors.New("charge stop routing is not configured")
	ErrStopRouteCheck         = errors.New("routing estimates are currently unavailable")
	ErrStopCheckDeferred      = errors.New("a stop comparison was requested recently")
)

const (
	stopCheckCooldown = 15 * time.Minute
	stopResultTTL     = 6 * time.Hour
	stopHistoryAge    = 180 * 24 * time.Hour
)

type StopRouter interface {
	CompareStopRoutes(context.Context, domain.RoutePoint, domain.RoutePoint,
		[]domain.RoutingStop, func(context.Context) error) (domain.StopRoutes, error)
}

type TripStops struct {
	repo    port.TripStopRepository
	router  StopRouter
	now     func() time.Time
	observe func(string)
}

func NewTripStops(repo port.TripStopRepository, router StopRouter, now func() time.Time, observe func(string)) *TripStops {
	if repo == nil || now == nil {
		panic("smartreadinesssvc.NewTripStops: repository and clock are required")
	}
	if observe == nil {
		observe = func(string) {}
	}
	return &TripStops{repo: repo, router: router, now: now, observe: observe}
}

func validateStopKey(key domain.StopPlanKey) error {
	if key.PlanID <= 0 {
		return ErrInvalidInput
	}
	return validateScope(key.Subject, key.VehicleID)
}

func (s *TripStops) Settings(ctx context.Context, key domain.StopPlanKey) (domain.StopComparisonSettings, error) {
	settings := domain.StopComparisonSettings{Available: s.router != nil}
	if err := validateStopKey(key); err != nil {
		return settings, err
	}
	hasSetup, err := s.repo.HasStopSetup(ctx, key)
	if err != nil {
		return settings, err
	}
	settings.HasSetup = hasSetup
	if !hasSetup || !settings.Available {
		return settings, nil
	}
	scope, err := s.repo.ReadStopScope(ctx, key, s.now().UTC())
	if err != nil || scope == nil {
		return settings, err
	}
	settings.Result, err = s.repo.ReadStopComparison(ctx, key, scope.ID, s.now().UTC())
	if err != nil {
		return settings, err
	}
	if err := s.repo.CheckStopScope(ctx, key, scope.ID, s.now().UTC()); err != nil {
		if errors.Is(err, port.ErrNotFound) {
			return domain.StopComparisonSettings{Available: true}, nil
		}
		return settings, err
	}
	settings.Setup, settings.NextCheckAt = &scope.Input, scope.NextCheckAt
	return settings, nil
}

func (s *TripStops) Save(ctx context.Context, key domain.StopPlanKey, setup domain.StopComparisonInput) error {
	if err := validateStopKey(key); err != nil {
		return err
	}
	if s.router == nil {
		return ErrStopRoutingUnavailable
	}
	now := s.now().UTC()
	if !validStopSetup(setup, now) {
		return ErrInvalidInput
	}
	return s.repo.ReplaceStopSetup(ctx, key, setup, now)
}

func (s *TripStops) Revoke(ctx context.Context, key domain.StopPlanKey) error {
	if err := validateStopKey(key); err != nil {
		return err
	}
	if err := s.repo.DeleteStopSetup(ctx, key); err != nil {
		return err
	}
	s.observe("disconnect_completed")
	return nil
}

func (s *TripStops) Compare(ctx context.Context, key domain.StopPlanKey) (_ *domain.StopComparisonResult, resultErr error) {
	if err := validateStopKey(key); err != nil {
		return nil, err
	}
	if s.router == nil {
		s.observe("connector_disabled")
		return nil, ErrStopRoutingUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	now := s.now().UTC()
	scope, err := s.repo.ReadStopScope(ctx, key, now)
	if err != nil {
		return nil, err
	}
	if scope == nil {
		s.observe("setup_missing_or_stale")
		return nil, port.ErrNotFound
	}
	defer func() {
		if errors.Is(resultErr, port.ErrNotFound) {
			s.observe("scope_invalidated")
		}
	}()
	claimed, err := s.repo.ClaimStopComparison(ctx, key, scope.ID, now, now.Add(stopCheckCooldown))
	if err != nil {
		return nil, err
	}
	if !claimed {
		s.observe("cooldown")
		return nil, ErrStopCheckDeferred
	}
	s.observe("check_claimed")
	authorize := func(ctx context.Context) error { return s.repo.CheckStopScope(ctx, key, scope.ID, s.now().UTC()) }
	stops, histories, err := s.stopEvidence(ctx, key, scope, now)
	if err != nil {
		return nil, err
	}
	if len(stops) < 2 {
		s.observe("insufficient_history")
		return nil, nil
	}
	s.observe("eligible")
	routes, err := s.router.CompareStopRoutes(ctx, scope.Origin, scope.Destination, stops, authorize)
	if err != nil {
		if scopeErr := authorize(ctx); scopeErr != nil {
			return nil, scopeErr
		}
		s.observe("provider_unqualified")
		return nil, ErrStopRouteCheck
	}
	setup := scope.Input
	comparisons := CompareTripChargingStops(domain.StopTripEnergy{
		CapacityWh: setup.CapacityWh, StartChargeWh: setup.CapacityWh * setup.StartPct / 100,
		ChargeLimitWh: setup.CapacityWh * setup.LimitPct / 100, ReserveWh: setup.CapacityWh * scope.ReservePct / 100,
		HighUsageWhPerM: setup.HighUsageWhPerM, DepartureAt: scope.DepartureAt,
	}, routes, func(id int64, at time.Time, from, to float64) (domain.StopHistoryEstimate, bool) {
		history, ok := histories[id]
		if !ok {
			return domain.StopHistoryEstimate{}, false
		}
		return estimateStopHistory(history.stop, history.sessions, now, at, from, to, setup.CapacityWh)
	})
	if err := authorize(ctx); err != nil {
		return nil, err
	}
	if len(comparisons) < 2 {
		s.observe("no_comparison")
		return nil, nil
	}
	for i := range comparisons {
		comparisons[i].PlaceName = histories[comparisons[i].PlaceID].stop.Name
	}
	comparedAt := s.now().UTC()
	result := domain.StopComparisonResult{
		ComparedAt: comparedAt, ExpiresAt: minTime(comparedAt.Add(stopResultTTL), scope.DepartureAt), Stops: comparisons,
	}
	if !result.ExpiresAt.After(comparedAt) {
		return nil, port.ErrNotFound
	}
	if err := s.repo.SaveStopComparison(ctx, key, scope.ID, result); err != nil {
		return nil, err
	}
	if err := authorize(ctx); err != nil {
		return nil, err
	}
	s.observe("comparison_ready")
	return &result, nil
}

type stopEvidence struct {
	stop     domain.ReviewedStop
	sessions []domain.SitePerformanceSession
}

func (s *TripStops) stopEvidence(
	ctx context.Context, key domain.StopPlanKey, scope *domain.StopComparisonScope, now time.Time,
) ([]domain.RoutingStop, map[int64]stopEvidence, error) {
	stops := make([]domain.RoutingStop, 0, len(scope.ReviewedStops))
	histories := make(map[int64]stopEvidence, len(scope.ReviewedStops))
	for _, stop := range scope.ReviewedStops {
		if !finiteBetween(stop.RadiusM, 1, 250) || len(stop.Waits) < minStopWaitSamples {
			continue
		}
		sessions, err := s.repo.ListStopChargeSessions(ctx, key, scope.ID, stop.PlaceID, now)
		if err != nil {
			return nil, nil, fmt.Errorf("load reviewed stop charge history: %w", err)
		}
		valid := sessions[:0]
		for _, session := range sessions {
			if stopSessionMatchesPlace(stop, session) && elapsedSessionPowerW(session, now) > 0 {
				valid = append(valid, session)
			}
		}
		if len(valid) >= minStopChargeSamples {
			histories[stop.PlaceID] = stopEvidence{stop: stop, sessions: valid}
			stops = append(stops, domain.RoutingStop{PlaceID: stop.PlaceID, Location: stop.Location})
		}
	}
	return stops, histories, nil
}

func validStopSetup(input domain.StopComparisonInput, now time.Time) bool {
	if input.PlanVersion <= 0 || input.OriginUpdatedAt.IsZero() || input.DestinationUpdatedAt.IsZero() ||
		input.DestinationPlaceID <= 0 || !finiteBetween(input.CapacityWh, 1000, 500000) ||
		!finiteBetween(input.StartPct, 1, 100) || !finiteBetween(input.LimitPct, 1, 100) ||
		!finiteBetween(input.HighUsageWhPerM, 0.000001, 2) ||
		len(input.Stops) < 2 || len(input.Stops) > 4 {
		return false
	}
	used := map[int64]bool{input.DestinationPlaceID: true}
	for _, stop := range input.Stops {
		if stop.PlaceID <= 0 || used[stop.PlaceID] || stop.PlaceUpdatedAt.IsZero() ||
			stopTimeZone(stop.TimeZone) == nil || len(stop.Waits) > 32 {
			return false
		}
		used[stop.PlaceID] = true
		seen := make(map[int64]bool, len(stop.Waits))
		for _, w := range stop.Waits {
			at := w.ArrivedAt.UnixMicro()
			if w.WaitS < 0 || w.WaitS > 4*60*60 || seen[at] || w.ArrivedAt.Before(now.Add(-stopHistoryAge)) ||
				w.ArrivedAt.Add(time.Duration(w.WaitS)*time.Second).After(now) {
				return false
			}
			seen[at] = true
		}
	}
	return true
}

func stopTimeZone(name string) *time.Location {
	if name == "" || name == "Local" || len(name) > 80 || strings.TrimSpace(name) != name {
		return nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil
	}
	return loc
}
