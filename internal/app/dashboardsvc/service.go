package dashboardsvc

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// DashboardStats holds aggregated dashboard metrics.
type DashboardStats struct {
	TotalVehicles         int     `json:"totalVehicles"`
	TotalM                float64 `json:"totalM"`
	TotalEnergyWh         float64 `json:"totalEnergyWh"`
	TotalChargingSessions int     `json:"totalChargingSessions"`
	TotalTrips            int     `json:"totalTrips"`
	AvgEfficiency         float64 `json:"avgEfficiency"`
	TotalCostCents        int     `json:"totalCostCents"`
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

// GetStats returns aggregated dashboard statistics for a user.
func (s *Service) GetStats(ctx context.Context, userID string) (*DashboardStats, error) {
	vehicles, err := s.vehicleRepo.GetByUserID(ctx, userID)
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
			continue
		}
		stats.TotalTrips += len(trips)
		for _, t := range trips {
			stats.TotalM += t.DistanceM
			stats.TotalEnergyWh += t.EnergyUsedWh
		}

		sessions, err := s.chargingRepo.ListByDateRange(ctx, v.ID, monthAgo, now)
		if err != nil {
			continue
		}
		stats.TotalChargingSessions += len(sessions)
		for _, cs := range sessions {
			stats.TotalCostCents += cs.CostCents
		}
	}

	if stats.TotalM > 0 {
		stats.AvgEfficiency = stats.TotalEnergyWh / stats.TotalM
	}

	return stats, nil
}
