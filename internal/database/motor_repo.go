package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type MotorRepo struct {
	db *DB
}

func NewMotorRepo(db *DB) *MotorRepo {
	return &MotorRepo{db: db}
}

func (r *MotorRepo) Insert(ctx context.Context, snap *models.MotorSnapshot) error {
	query := `INSERT INTO motor_snapshots (vehicle_id, di_state, di_torque, di_axle_speed, di_stator_temp, pedal_position, brake_pedal, lateral_accel, longitudinal_accel, vehicle_speed, gear)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.DiState, snap.DiTorque, snap.DiAxleSpeed, snap.DiStatorTemp,
		snap.PedalPosition, snap.BrakePedal, snap.LateralAccel, snap.LongitudinalAccel,
		snap.VehicleSpeed, snap.Gear,
	).Scan(&snap.ID)
}

func (r *MotorRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.MotorSnapshot, error) {
	query := `SELECT id, vehicle_id, di_state, di_torque, di_axle_speed, di_stator_temp, pedal_position, brake_pedal, lateral_accel, longitudinal_accel, vehicle_speed, gear, created_at
		FROM motor_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.MotorSnapshot
	for rows.Next() {
		s := &models.MotorSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.DiState, &s.DiTorque, &s.DiAxleSpeed, &s.DiStatorTemp,
			&s.PedalPosition, &s.BrakePedal, &s.LateralAccel, &s.LongitudinalAccel,
			&s.VehicleSpeed, &s.Gear, &s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *MotorRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.MotorSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
