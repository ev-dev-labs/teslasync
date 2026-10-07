package drive

import (
	"context"
	"fmt"
	"math"
)

// DrivingStats preserves unknown measurements as nil rather than measured zero.
type DrivingStats struct {
	Count            int
	DistanceM        float64
	DurationS        float64
	AvgSpeedMps      *float64
	MaxSpeedMps      *float64
	EfficiencyWhPerM *float64
	RegenEnergyWh    *float64
	RegenRatio       *float64
}

const drivingStatsSQL = `
	SELECT COUNT(*), COALESCE(SUM(distance_m), 0),
	       COALESCE(SUM(duration_s), 0)::float8,
	       AVG(CASE WHEN duration_s > 0 THEN distance_m / duration_s END),
	       MAX(max_speed_mps),
	       AVG(CASE WHEN distance_m > 0 THEN energy_used_wh / distance_m END),
	       CASE WHEN COUNT(*) FILTER (WHERE regen_energy_wh IS NULL) = 0
	            THEN SUM(regen_energy_wh) END,
	       CASE WHEN COUNT(*) FILTER (WHERE energy_used_wh IS NULL OR regen_energy_wh IS NULL) = 0
	                 AND SUM(energy_used_wh) > 0
	            THEN LEAST(1.0, SUM(regen_energy_wh) / SUM(energy_used_wh)) END
	FROM drives WHERE vehicle_id = $1 AND ended_at IS NOT NULL`

func (r *DriveRepo) GetStats(ctx context.Context, vehicleID int64) (DrivingStats, error) {
	var stats DrivingStats
	if r == nil || r.db == nil || r.db.Pool == nil {
		return stats, fmt.Errorf("driving statistics: database pool unavailable")
	}
	if vehicleID <= 0 {
		return stats, fmt.Errorf("driving statistics: invalid vehicle ID %d", vehicleID)
	}
	err := r.db.Pool.QueryRow(ctx, drivingStatsSQL, vehicleID).Scan(
		&stats.Count, &stats.DistanceM, &stats.DurationS, &stats.AvgSpeedMps,
		&stats.MaxSpeedMps, &stats.EfficiencyWhPerM, &stats.RegenEnergyWh, &stats.RegenRatio,
	)
	if err != nil {
		return stats, fmt.Errorf("fetch vehicle %d driving statistics: %w", vehicleID, err)
	}
	for _, value := range []*float64{
		&stats.DistanceM, &stats.DurationS, stats.AvgSpeedMps, stats.MaxSpeedMps,
		stats.EfficiencyWhPerM, stats.RegenEnergyWh, stats.RegenRatio,
	} {
		if value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0)) {
			return DrivingStats{}, fmt.Errorf("vehicle %d driving statistics contain non-finite measurements", vehicleID)
		}
	}
	return stats, nil
}
