package smartreadiness

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

type TripMaintenanceSnapshot struct {
	Plan        domain.Plan
	Setup       domain.TripMaintenanceSetup
	Observation domain.TripOdometerObservation
	VehicleName string
}

type TripMaintenanceCandidate struct {
	Projection  domain.TripMaintenanceProjection
	PlanVersion int64
	VehicleName string
}

type TripMaintenanceCheck struct {
	Now               time.Time
	NextAt            time.Time
	EarliestDeparture time.Time
	LatestDeparture   time.Time
	OldestObservation time.Time
}

type TripMaintenanceEvaluator func(domain.Plan, domain.TripMaintenanceSetup, domain.TripOdometerObservation) (
	*domain.TripMaintenanceProjection, domain.TripMaintenanceReason)

type TripMaintenanceRepository interface {
	ReadTripMaintenance(context.Context, domain.StopPlanKey) (TripMaintenanceSnapshot, error)
	ReplaceTripMaintenance(context.Context, domain.StopPlanKey, domain.TripMaintenanceSetup, time.Time) error
	DeleteTripMaintenance(context.Context, domain.StopPlanKey) error
	CheckNextTripMaintenance(context.Context, TripMaintenanceCheck, TripMaintenanceEvaluator) (domain.TripMaintenanceReason, bool, error)
	ListTripMaintenance(context.Context, string, *int64, time.Time, int) ([]TripMaintenanceSnapshot, error)
}
