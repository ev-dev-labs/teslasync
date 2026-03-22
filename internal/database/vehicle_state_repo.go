package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type VehicleStateRepo struct {
	db *DB
}

func NewVehicleStateRepo(db *DB) *VehicleStateRepo {
	return &VehicleStateRepo{db: db}
}

func (r *VehicleStateRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.VehicleStateRecord, error) {
	query := `SELECT id, vehicle_id, state, start_date, end_date, duration_min, created_at
		FROM vehicle_states WHERE vehicle_id=$1 ORDER BY start_date DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var states []*models.VehicleStateRecord
	for rows.Next() {
		s := &models.VehicleStateRecord{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.State, &s.StartDate, &s.EndDate, &s.DurationMin, &s.CreatedAt); err != nil {
			return nil, err
		}
		states = append(states, s)
	}
	return states, rows.Err()
}

func (r *VehicleStateRepo) GetStateSummary(ctx context.Context, vehicleID int64, days int) ([]map[string]interface{}, error) {
	query := `SELECT state, COUNT(*) as count, COALESCE(SUM(duration_min), 0) as total_min
		FROM vehicle_states WHERE vehicle_id=$1 AND start_date >= NOW() - make_interval(days := $2)
		GROUP BY state ORDER BY total_min DESC`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var state string
		var count int64
		var totalMin float64
		if err := rows.Scan(&state, &count, &totalMin); err != nil {
			return nil, err
		}
		result = append(result, map[string]interface{}{
			"state":     state,
			"count":     count,
			"total_min": totalMin,
		})
	}
	return result, rows.Err()
}

func (r *VehicleStateRepo) GetDailyBreakdown(ctx context.Context, vehicleID int64, days int) ([]map[string]interface{}, error) {
	query := `SELECT DATE(start_date) as day, state, COALESCE(SUM(duration_min), 0) as total_min
		FROM vehicle_states WHERE vehicle_id=$1 AND start_date >= NOW() - make_interval(days := $2)
		GROUP BY DATE(start_date), state ORDER BY day DESC`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, days)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []map[string]interface{}
	for rows.Next() {
		var day, state string
		var totalMin float64
		if err := rows.Scan(&day, &state, &totalMin); err != nil {
			return nil, err
		}
		result = append(result, map[string]interface{}{
			"day":       day,
			"state":     state,
			"total_min": totalMin,
		})
	}
	return result, rows.Err()
}
