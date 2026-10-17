package dashboardsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// DashboardStats holds aggregated dashboard metrics.
type DashboardStats struct {
	TotalVehicles         int      `json:"total_vehicles"`
	TotalM                float64  `json:"total_m"`
	TotalEnergyWh         float64  `json:"total_energy_wh"`
	TotalChargingSessions int      `json:"total_charging_sessions"`
	TotalTrips            int      `json:"total_trips"`
	AvgEfficiency         *float64 `json:"avg_efficiency"`
	TotalCostCents        int      `json:"total_cost_cents"`
}

// Service provides dashboard aggregation use cases.
type Service struct {
	vehicleRepo  repository.VehicleRepository
	chargingRepo repository.ChargingSessionRepository
	tripRepo     repository.TripRepository
}

// New creates a new dashboard service.
func New(
	vehicleRepo repository.VehicleRepository,
	chargingRepo repository.ChargingSessionRepository,
	tripRepo repository.TripRepository,
) *Service {
	return &Service{
		vehicleRepo:  vehicleRepo,
		chargingRepo: chargingRepo,
		tripRepo:     tripRepo,
	}
}

// GetStats aggregates the installation's shared fleet. Authorization belongs
// to the HTTP caller, not an invented vehicles.user_id predicate.
func (s *Service) GetStats(ctx context.Context) (*DashboardStats, error) {
	vehicles, err := s.vehicleRepo.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading vehicles for dashboard: %w", err)
	}

	stats := &DashboardStats{
		TotalVehicles: len(vehicles),
	}

	now := time.Now()
	monthAgo := now.AddDate(0, -1, 0)

	for _, v := range vehicles {
		trips, err := s.tripRepo.ListByDateRange(ctx, v.ID, monthAgo, now)
		if err != nil {
			return nil, fmt.Errorf("loading trips for vehicle %s: %w", v.ID, err)
		}
		stats.TotalTrips += len(trips)
		for _, t := range trips {
			stats.TotalM += t.DistanceM
			stats.TotalEnergyWh += t.EnergyUsedWh
		}

		sessions, err := s.chargingRepo.ListByDateRange(ctx, v.ID, monthAgo, now)
		if err != nil {
			return nil, fmt.Errorf("loading charging sessions for vehicle %s: %w", v.ID, err)
		}
		stats.TotalChargingSessions += len(sessions)
		for _, cs := range sessions {
			stats.TotalCostCents += cs.CostCents
		}
	}

	if stats.TotalM > 0 {
		efficiency := stats.TotalEnergyWh / stats.TotalM
		stats.AvgEfficiency = &efficiency
	}

	return stats, nil
}
