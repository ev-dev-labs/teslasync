package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var ErrSolarChargingUnavailable = errors.New("solar charging recommendations are unavailable")

const (
	solarPollInterval   = time.Minute
	solarReserveRefresh = 10 * time.Minute
	solarProviderLimit  = 5 * time.Second
)

type SolarEnergyReader interface {
	ReadReserve(ctx context.Context, subject string, siteID int64) (domain.SolarBackupReserve, error)
	ReadObservation(ctx context.Context, subject string, siteID int64) (domain.SolarSurplusObservation, error)
	Available(ctx context.Context, subject string, siteID int64) (bool, error)
}

func WithSolarCharging(repository port.SolarChargingRepository, energy SolarEnergyReader) Option {
	return func(s *Service) { s.solarPlans, s.solarEnergy = repository, energy }
}

func (s *Service) SaveSolarChargingPlan(ctx context.Context, subject string, plan domain.SolarChargingPlan) error {
	if validateScope(subject, plan.VehicleID) != nil || plan.EnergySiteID <= 0 ||
		plan.PlaceID <= 0 || plan.PlaceUpdatedAt.IsZero() {
		return ErrInvalidInput
	}
	if s.solarPlans == nil || s.solarEnergy == nil {
		return ErrSolarChargingUnavailable
	}
	available, err := s.solarEnergy.Available(ctx, subject, plan.EnergySiteID)
	if err != nil {
		return err
	}
	if !available {
		return ErrSolarChargingUnavailable
	}
	return s.solarPlans.SaveSolarChargingPlan(ctx, domain.SolarChargingPlan{
		Subject: subject, VehicleID: plan.VehicleID, EnergySiteID: plan.EnergySiteID, PlaceID: plan.PlaceID,
		PlaceUpdatedAt: plan.PlaceUpdatedAt.UTC(), ConsentedAt: s.now().UTC().Truncate(time.Microsecond),
	})
}

func (s *Service) DeleteSolarChargingPlan(ctx context.Context, subject string, vehicleID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if s.solarPlans == nil {
		return ErrSolarChargingUnavailable
	}
	return s.solarPlans.DeleteSolarChargingPlan(ctx, subject, vehicleID)
}

func (s *Service) FindSolarChargingPlan(ctx context.Context, subject string, vehicleID int64) (*domain.SolarChargingPlan, error) {
	if err := validateScope(subject, vehicleID); err != nil {
		return nil, err
	}
	if s.solarPlans == nil {
		return nil, ErrSolarChargingUnavailable
	}
	return s.solarPlans.FindSolarChargingPlan(ctx, subject, vehicleID)
}

func (s *Service) SolarChargingDecision(ctx context.Context, subject string, vehicleID int64) (*domain.SolarSurplusDecision, error) {
	plan, err := s.FindSolarChargingPlan(ctx, subject, vehicleID)
	if err != nil || plan == nil {
		return nil, err
	}
	return s.solarChargingDecision(ctx, plan)
}

func (s *Service) ListSolarChargingOpportunities(ctx context.Context, subject string, vehicleID *int64,
	now time.Time, limit int,
) ([]domain.SolarChargingOpportunity, error) {
	if s.solarPlans == nil || s.solarEnergy == nil || subject == "" || limit <= 0 {
		return nil, nil
	}
	scopes, err := s.solarPlans.ListSolarChargingScopes(ctx, subject, vehicleID, now, min(limit, 8))
	if err != nil {
		return nil, err
	}
	var opportunities []domain.SolarChargingOpportunity
	for _, scope := range scopes {
		plan, err := s.solarPlans.FindSolarChargingPlan(ctx, subject, scope.VehicleID)
		if err != nil {
			return nil, err
		}
		if plan == nil || plan.ID != scope.PlanID || !plan.ConsentedAt.Equal(scope.ConsentedAt) {
			continue
		}
		decision, err := s.solarChargingDecision(ctx, plan)
		if err != nil {
			return nil, err
		}
		if decision != nil {
			opportunities = append(opportunities, domain.SolarChargingOpportunity{Scope: scope, Decision: *decision})
		}
	}
	return opportunities, nil
}

func (s *Service) solarChargingDecision(ctx context.Context, plan *domain.SolarChargingPlan) (*domain.SolarSurplusDecision, error) {
	if plan.Reserve == nil || s.solarEnergy == nil {
		return nil, nil
	}
	available, err := s.solarEnergy.Available(ctx, plan.Subject, plan.EnergySiteID)
	if err != nil || !available {
		return nil, err
	}
	now := s.now().UTC()
	samples, err := s.solarPlans.ListSolarChargingObservations(ctx, *plan, now.Add(-solarSampleWindow), now)
	if err != nil || len(samples) < 3 {
		return nil, err
	}
	values, err := s.live.GetAll(ctx, plan.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return nil, fmt.Errorf("read distributed solar charging signals: %w", err)
	}
	match, checkErr := s.solarPlaceMatcher(ctx, plan.PlaceID)
	decision := EvaluateSolarSurplus(*plan.Reserve, samples, values, s.now().UTC(), match)
	if decision == nil || *checkErr != nil {
		return nil, *checkErr
	}
	current, err := s.solarPlans.FindSolarChargingPlan(ctx, plan.Subject, plan.VehicleID)
	if err != nil || !sameSolarConsent(plan, current) || current.Reserve == nil ||
		*current.Reserve != *plan.Reserve || !s.now().UTC().Before(decision.ExpiresAt) {
		return nil, err
	}
	available, err = s.solarEnergy.Available(ctx, plan.Subject, plan.EnergySiteID)
	if err != nil || !available {
		return nil, err
	}
	return decision, nil
}

func (s *Service) ProcessSolarCharging(ctx context.Context, limit int) (int, error) {
	if s.solarPlans == nil || s.solarEnergy == nil || limit <= 0 {
		return 0, nil
	}
	now := s.now().UTC()
	result := s.solarPlans.PruneSolarChargingObservations(ctx, now.Add(-solarSampleWindow))
	plans, err := s.solarPlans.ClaimDueSolarChargingPlans(ctx, now, now.Add(solarPollInterval), min(limit, 4), s.sharedOpenMode)
	if err != nil {
		return 0, errors.Join(result, err)
	}
	for _, plan := range plans {
		result = errors.Join(result, s.sampleSolarCharging(ctx, plan))
		if ctx.Err() != nil {
			return len(plans), errors.Join(result, ctx.Err())
		}
	}
	return len(plans), result
}

func (s *Service) sampleSolarCharging(ctx context.Context, plan domain.SolarChargingPlan) error {
	available, err := s.solarEnergy.Available(ctx, plan.Subject, plan.EnergySiteID)
	if err != nil || !available {
		return errors.Join(err, s.solarPlans.InvalidateSolarChargingEvidence(ctx, plan, s.now().UTC()))
	}
	values, err := s.live.GetAll(ctx, plan.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return fmt.Errorf("read distributed solar charging eligibility: %w", err)
	}
	match, checkErr := s.solarPlaceMatcher(ctx, plan.PlaceID)
	_, _, _, eligible := solarChargingVehicle(values, s.now().UTC(), match)
	if !eligible {
		return *checkErr
	}
	current, err := s.solarPlans.FindSolarChargingPlan(ctx, plan.Subject, plan.VehicleID)
	if err != nil || !sameSolarConsent(&plan, current) || !current.ClaimCurrent || !current.NextCheckAt.Equal(plan.NextCheckAt) {
		return err
	}
	requestCtx, cancel := context.WithTimeout(ctx, solarProviderLimit)
	defer cancel()
	var reserve *domain.SolarBackupReserve
	if current.Reserve == nil || !s.now().UTC().Before(current.Reserve.ObservedAt.Add(solarReserveRefresh)) {
		reading, reserveErr := s.solarEnergy.ReadReserve(requestCtx, plan.Subject, plan.EnergySiteID)
		if reserveErr != nil {
			return errors.Join(reserveErr, s.solarPlans.InvalidateSolarChargingEvidence(ctx, plan, s.now().UTC()))
		}
		reserve = &reading
	}
	current, err = s.solarPlans.FindSolarChargingPlan(ctx, plan.Subject, plan.VehicleID)
	if err != nil || !sameSolarConsent(&plan, current) || !current.ClaimCurrent || !current.NextCheckAt.Equal(plan.NextCheckAt) {
		return err
	}
	observation, err := s.solarEnergy.ReadObservation(requestCtx, plan.Subject, plan.EnergySiteID)
	if err != nil {
		return errors.Join(err, s.solarPlans.InvalidateSolarChargingEvidence(ctx, plan, s.now().UTC()))
	}
	err = s.solarPlans.SaveSolarChargingObservation(ctx, plan, reserve, observation, s.now().UTC())
	if errors.Is(err, port.ErrClaimLost) {
		return nil
	}
	return err
}

func (s *Service) solarPlaceMatcher(ctx context.Context, placeID int64) (func(float64, float64) bool, *error) {
	var err error
	return func(latitude, longitude float64) bool {
		var contains bool
		contains, err = s.sites.Contains(ctx, placeID, latitude, longitude)
		return err == nil && contains
	}, &err
}

func sameSolarConsent(a, b *domain.SolarChargingPlan) bool {
	return a != nil && b != nil && a.ID == b.ID && a.ConsentedAt.Equal(b.ConsentedAt)
}
