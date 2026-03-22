package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type MileageRepo struct {
	db *DB
}

func NewMileageRepo(db *DB) *MileageRepo {
	return &MileageRepo{db: db}
}

func (r *MileageRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.DailyMileage, error) {
	query := `SELECT id, vehicle_id, date, distance_km, odometer_start, odometer_end, drive_count, energy_used_kwh
		FROM daily_mileage WHERE vehicle_id=$1 ORDER BY date DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var mileage []*models.DailyMileage
	for rows.Next() {
		m := &models.DailyMileage{}
		if err := rows.Scan(&m.ID, &m.VehicleID, &m.Date, &m.DistanceKm, &m.OdometerStart, &m.OdometerEnd, &m.DriveCount, &m.EnergyUsedKWh); err != nil {
			return nil, err
		}
		mileage = append(mileage, m)
	}
	return mileage, rows.Err()
}

func (r *MileageRepo) GetMonthlyByVehicle(ctx context.Context, vehicleID int64) ([]map[string]interface{}, error) {
	query := `SELECT
		TO_CHAR(date, 'YYYY-MM') as month,
		SUM(distance_km) as distance,
		SUM(drive_count) as drives,
		SUM(energy_used_kwh) as energy,
		MAX(odometer_end) - MIN(odometer_start) as odometer_diff
		FROM daily_mileage WHERE vehicle_id=$1
		GROUP BY TO_CHAR(date, 'YYYY-MM')
		ORDER BY month DESC LIMIT 24`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var month string
		var distance, energy, odomDiff float64
		var drives int
		if err := rows.Scan(&month, &distance, &drives, &energy, &odomDiff); err != nil {
			return nil, err
		}
		result = append(result, map[string]interface{}{
			"month":    month,
			"distance": distance,
			"drives":   drives,
			"energy":   energy,
			"odometer": odomDiff,
		})
	}
	return result, rows.Err()
}

func (r *MileageRepo) GetStats(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	query := `SELECT
		COALESCE(SUM(distance_km), 0),
		COALESCE(AVG(distance_km), 0),
		COALESCE(MAX(distance_km), 0),
		COALESCE(SUM(energy_used_kwh), 0),
		COALESCE(SUM(drive_count), 0),
		COUNT(*)
		FROM daily_mileage WHERE vehicle_id=$1`

	var totalDist, avgDist, maxDist, totalEnergy float64
	var totalDrives, dayCount int64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(&totalDist, &avgDist, &maxDist, &totalEnergy, &totalDrives, &dayCount)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"total_distance":  totalDist,
		"avg_daily":       avgDist,
		"max_daily":       maxDist,
		"total_energy":    totalEnergy,
		"total_drives":    totalDrives,
		"days_tracked":    dayCount,
	}, nil
}
