package service

import (
	"context"
	"fmt"
	"math"
	"time"

	energymodel "github.com/ev-dev-labs/teslasync/internal/models/energy"

	"github.com/ev-dev-labs/teslasync/internal/database"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
)

// CO2PerKWh is the estimated CO₂ savings in kg per kWh when driving
// electric instead of a comparable gasoline vehicle (~400 g/kWh).
const CO2PerKWh = 0.4

// EnergyStats holds computed energy statistics for a vehicle over a period.
type EnergyStats struct {
	VehicleID      int64                         `json:"vehicle_id"`
	PeriodDays     int                           `json:"period_days"`
	TotalEnergy    float64                       `json:"total_energy_used_wh"`
	TotalCost      float64                       `json:"total_cost"`
	TotalDistance  float64                       `json:"total_distance_m"`
	AvgEfficiency  float64                       `json:"avg_efficiency_wh_per_m"`
	CO2Saved       float64                       `json:"co2_saved_kg"`
	DailyBreakdown []*energymodel.EnergyStatsRow `json:"daily_breakdown"`
}

// EnergyService encapsulates energy calculation business logic.
type EnergyService struct {
	energyRepo *energydb.EnergyStatsRepo
}

// NewEnergyService creates an EnergyService.
func NewEnergyService(db *database.DB) *EnergyService {
	return &EnergyService{energyRepo: energydb.NewEnergyStatsRepo(db)}
}

// CalculateStats computes energy statistics for a vehicle over the given
// number of days. It queries daily breakdowns and totals, then derives
// average efficiency and CO₂ savings.
func (s *EnergyService) CalculateStats(ctx context.Context, vehicleID int64, days int) (*EnergyStats, error) {
	breakdown, err := s.energyRepo.GetDailyBreakdown(ctx, vehicleID, days)
	if err != nil {
		return nil, err
	}

	totalEnergy, totalCost, totalDistance, err := s.energyRepo.GetTotalEnergy(ctx, vehicleID, days)
	if err != nil {
		return nil, err
	}

	if breakdown == nil {
		breakdown = make([]*energymodel.EnergyStatsRow, 0)
	}

	var avgEfficiency float64
	if totalDistance > 0 {
		avgEfficiency = totalEnergy / totalDistance
	}

	return &EnergyStats{
		VehicleID:      vehicleID,
		PeriodDays:     days,
		TotalEnergy:    totalEnergy,
		TotalCost:      totalCost,
		TotalDistance:  totalDistance,
		AvgEfficiency:  avgEfficiency,
		CO2Saved:       (totalEnergy / 1000.0) * CO2PerKWh,
		DailyBreakdown: breakdown,
	}, nil
}

// CalculateStatsRange computes totals from the same bounded rows used by the
// charts, so a historical end cannot leak later drives into either surface.
func (s *EnergyService) CalculateStatsRange(ctx context.Context, vehicleID int64, start, end time.Time) (*EnergyStats, error) {
	if !end.After(start) || end.Sub(start) > 3650*24*time.Hour {
		return nil, fmt.Errorf("invalid energy window")
	}
	rows, err := s.energyRepo.GetDailyRange(ctx, vehicleID, start, end)
	if err != nil {
		return nil, err
	}
	stats := &EnergyStats{VehicleID: vehicleID, PeriodDays: int(math.Ceil(end.Sub(start).Hours() / 24)), DailyBreakdown: rows}
	for _, row := range rows {
		stats.TotalEnergy += row.EnergyWh
		stats.TotalDistance += row.DistanceM
		stats.TotalCost += row.Cost
	}
	if stats.TotalDistance > 0 {
		stats.AvgEfficiency = stats.TotalEnergy / stats.TotalDistance
	}
	stats.CO2Saved = stats.TotalEnergy / 1000 * CO2PerKWh
	return stats, nil
}
