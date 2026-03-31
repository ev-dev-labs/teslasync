package database

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
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
	query := `SELECT TO_CHAR(DATE(start_date), 'YYYY-MM-DD') as day, state, COALESCE(SUM(duration_min), 0) as total_min
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

// Insert creates a new vehicle state record and returns its ID.
func (r *VehicleStateRepo) Insert(ctx context.Context, vehicleID int64, state string) (int64, error) {
	query := `INSERT INTO vehicle_states (vehicle_id, state, start_date)
		VALUES ($1, $2, $3) RETURNING id`
	var id int64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, state, time.Now().UTC()).Scan(&id)
	return id, err
}

// EndCurrent closes the currently open state record for a vehicle (where end_date IS NULL)
// and computes the duration.
func (r *VehicleStateRepo) EndCurrent(ctx context.Context, vehicleID int64) error {
	query := `UPDATE vehicle_states SET end_date = NOW(),
		duration_min = EXTRACT(EPOCH FROM (NOW() - start_date)) / 60.0
		WHERE vehicle_id = $1 AND end_date IS NULL`
	_, err := r.db.Pool.Exec(ctx, query, vehicleID)
	return err
}

// GetCurrentState returns the current open state for a vehicle, or empty string if none.
func (r *VehicleStateRepo) GetCurrentState(ctx context.Context, vehicleID int64) (string, error) {
	query := `SELECT state FROM vehicle_states WHERE vehicle_id = $1 AND end_date IS NULL
		ORDER BY start_date DESC LIMIT 1`
	var state string
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(&state)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", nil // no current state is fine
		}
		return "", err // real DB error
	}
	return state, nil
}
