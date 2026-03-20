package database

import (
	"context"

	"github.com/teslasync/teslasync/internal/models"
)

type TirePressureRepo struct {
	db *DB
}

func NewTirePressureRepo(db *DB) *TirePressureRepo {
	return &TirePressureRepo{db: db}
}

func (r *TirePressureRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.TirePressureSnapshot, error) {
	query := `SELECT id, vehicle_id, front_left, front_right, rear_left, rear_right, created_at
		FROM tire_pressure_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.TirePressureSnapshot
	for rows.Next() {
		s := &models.TirePressureSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.FrontLeft, &s.FrontRight, &s.RearLeft, &s.RearRight, &s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *TirePressureRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.TirePressureSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
