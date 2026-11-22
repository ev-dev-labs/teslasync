package smartreadinesssvc

import (
	"context"
	"strings"
	"time"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const (
	tripMaintenanceHorizon     = 14 * 24 * time.Hour
	tripMaintenanceMinLead     = 2 * time.Hour
	tripMaintenanceOdometerAge = 48 * time.Hour
	tripMaintenanceRefresh     = 30 * time.Minute
	tripMaintenanceMaxOdoM     = 10_000_000_000
)

type TripMaintenance struct {
	repo port.TripMaintenanceRepository
	now  func() time.Time
}

func NewTripMaintenance(repo port.TripMaintenanceRepository, now func() time.Time) *TripMaintenance {
	if repo == nil || now == nil {
		panic("smartreadinesssvc.NewTripMaintenance: repository and clock are required")
	}
	return &TripMaintenance{repo: repo, now: now}
}

func privatePlanningSubject(subject string) bool {
	return subject != "" && subject != personal.OpenSubject && len(subject) <= 512 && strings.TrimSpace(subject) == subject
}

func (s *TripMaintenance) Settings(ctx context.Context, key domain.StopPlanKey) (domain.TripMaintenanceSettings, error) {
	var settings domain.TripMaintenanceSettings
	if !privatePlanningSubject(key.Subject) || validateStopKey(key) != nil {
		return settings, ErrInvalidInput
	}
	snapshot, err := s.repo.ReadTripMaintenance(ctx, key)
	if err != nil || snapshot.Setup.PlanVersion == 0 {
		return settings, err
	}
	settings.Setup = &snapshot.Setup
	settings.NeedsReview = snapshot.Plan.Version != snapshot.Setup.PlanVersion
	settings.Projection, _ = EvaluateTripMaintenance(snapshot.Plan, snapshot.Setup, snapshot.Observation, s.now().UTC())
	return settings, nil
}

func (s *TripMaintenance) Save(ctx context.Context, key domain.StopPlanKey, setup domain.TripMaintenanceSetup) error {
	now := s.now().UTC()
	if !privatePlanningSubject(key.Subject) || validateStopKey(key) != nil || !validTripMaintenanceSetup(setup, now) {
		return ErrInvalidInput
	}
	return s.repo.ReplaceTripMaintenance(ctx, key, setup, now)
}

func (s *TripMaintenance) Revoke(ctx context.Context, key domain.StopPlanKey) error {
	if !privatePlanningSubject(key.Subject) || validateStopKey(key) != nil {
		return ErrInvalidInput
	}
	return s.repo.DeleteTripMaintenance(ctx, key)
}

type TripMaintenanceBatch struct {
	Outcomes  map[domain.TripMaintenanceReason]int
	Published int
}

func (s *TripMaintenance) ProcessDue(ctx context.Context, limit int) (TripMaintenanceBatch, error) {
	batch := TripMaintenanceBatch{Outcomes: make(map[domain.TripMaintenanceReason]int)}
	for range min(max(limit, 1), 25) {
		now := s.now().UTC()
		window := port.TripMaintenanceCheck{
			Now: now, NextAt: now.Add(tripMaintenanceRefresh), EarliestDeparture: now.Add(tripMaintenanceMinLead),
			LatestDeparture: now.Add(tripMaintenanceHorizon), OldestObservation: now.Add(-tripMaintenanceOdometerAge),
		}
		reason, published, err := s.repo.CheckNextTripMaintenance(ctx, window, func(plan domain.Plan, setup domain.TripMaintenanceSetup,
			observation domain.TripOdometerObservation) (*domain.TripMaintenanceProjection, domain.TripMaintenanceReason) {
			return EvaluateTripMaintenance(plan, setup, observation, now)
		})
		if err != nil || reason == "" {
			return batch, err
		}
		batch.Outcomes[reason]++
		if published {
			batch.Published++
		}
	}
	return batch, nil
}

func (s *TripMaintenance) ListTripMaintenanceCandidates(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]port.TripMaintenanceCandidate, error) {
	if !privatePlanningSubject(subject) {
		return nil, nil
	}
	items, err := s.repo.ListTripMaintenance(ctx, subject, vehicleID, now, min(max(limit, 1), 50))
	if err != nil {
		return nil, err
	}
	candidates := make([]port.TripMaintenanceCandidate, 0, len(items))
	for _, item := range items {
		if projection, _ := EvaluateTripMaintenance(item.Plan, item.Setup, item.Observation, now); projection != nil {
			candidates = append(candidates, port.TripMaintenanceCandidate{
				Projection: *projection, PlanVersion: item.Plan.Version, VehicleName: item.VehicleName,
			})
		}
	}
	return candidates, nil
}

func validTripMaintenanceSetup(setup domain.TripMaintenanceSetup, now time.Time) bool {
	label := setup.ServiceLabel
	return setup.PlanVersion > 0 && label != "" && len(label) <= 120 && label == strings.TrimSpace(label) &&
		strings.IndexFunc(label, unicode.IsControl) < 0 && !setup.ServiceCompletedAt.IsZero() && !setup.ServiceCompletedAt.After(now) &&
		finiteBetween(setup.ServiceOdometerM, 0, tripMaintenanceMaxOdoM) && finiteBetween(setup.IntervalM, 1, 1_000_000_000) &&
		finiteBetween(setup.TripDistanceLowM, 1, 20_000_000) &&
		finiteBetween(setup.TripDistanceHighM, setup.TripDistanceLowM, 20_000_000)
}

func EvaluateTripMaintenance(
	plan domain.Plan, setup domain.TripMaintenanceSetup, observation domain.TripOdometerObservation, now time.Time,
) (*domain.TripMaintenanceProjection, domain.TripMaintenanceReason) {
	if plan.ID <= 0 || plan.VehicleID <= 0 || !plan.Enabled || plan.Version != setup.PlanVersion ||
		(plan.SnoozedUntil != nil && plan.SnoozedUntil.After(now)) {
		return nil, domain.TripMaintenancePlanUnavailable
	}
	if !validTripMaintenanceSetup(setup, now) {
		return nil, domain.TripMaintenanceSetupInvalid
	}
	departure := plan.DepartureAt
	if !departure.After(now.Add(tripMaintenanceMinLead)) || departure.After(now.Add(tripMaintenanceHorizon)) {
		return nil, domain.TripMaintenanceOutsideWindow
	}
	if observation.VehicleID != plan.VehicleID ||
		!finiteBetween(observation.OdometerM, max(1, setup.ServiceOdometerM), tripMaintenanceMaxOdoM) ||
		observation.ObservedAt.IsZero() || observation.ObservedAt.After(now) ||
		observation.ObservedAt.Before(setup.ServiceCompletedAt) || now.Sub(observation.ObservedAt) >= tripMaintenanceOdometerAge {
		return nil, domain.TripMaintenanceUnknownOdometer
	}
	due := setup.ServiceOdometerM + setup.IntervalM
	if observation.OdometerM >= due {
		return nil, domain.TripMaintenanceAlreadyDue
	}
	low := observation.OdometerM + setup.TripDistanceLowM
	if low < due {
		return nil, domain.TripMaintenanceBelowInterval
	}
	expires := observation.ObservedAt.Add(tripMaintenanceOdometerAge)
	if latestUseful := departure.Add(-tripMaintenanceMinLead); latestUseful.Before(expires) {
		expires = latestUseful
	}
	return &domain.TripMaintenanceProjection{
		PlanID: plan.ID, VehicleID: plan.VehicleID, DepartureAt: departure,
		ServiceLabel: setup.ServiceLabel, ServiceCompletedAt: setup.ServiceCompletedAt, ServiceOdometerM: setup.ServiceOdometerM,
		IntervalM: setup.IntervalM, DueOdometerM: due, RecordedOdometerM: observation.OdometerM, RecordedAt: observation.ObservedAt,
		TripDistanceLowM: setup.TripDistanceLowM, TripDistanceHighM: setup.TripDistanceHighM,
		ArrivalOdometerLowM: low, ArrivalOdometerHighM: observation.OdometerM + setup.TripDistanceHighM, ExpiresAt: expires,
	}, domain.TripMaintenanceEligible
}
