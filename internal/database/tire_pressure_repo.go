package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type TirePressureRepo struct {
	db *DB
}

func NewTirePressureRepo(db *DB) *TirePressureRepo {
	return &TirePressureRepo{db: db}
}

// Insert stores a new tire pressure snapshot.
func (r *TirePressureRepo) Insert(ctx context.Context, snap *models.TirePressureSnapshot) error {
	query := `INSERT INTO tire_pressure_snapshots (vehicle_id, front_left, front_right, rear_left, rear_right, tpms_hard_warnings, tpms_soft_warnings, last_seen_time_fl, last_seen_time_fr, last_seen_time_rl, last_seen_time_rr)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.FrontLeft, snap.FrontRight, snap.RearLeft, snap.RearRight,
		snap.TpmsHardWarn, snap.TpmsSoftWarn,
		snap.LastSeenTimeFl, snap.LastSeenTimeFr, snap.LastSeenTimeRl, snap.LastSeenTimeRr,
	).Scan(&snap.ID)
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
