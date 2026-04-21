package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// motorCoreCols are the motor/powertrain fields kept as dedicated SQL columns.
// Everything else lives in the signals JSONB column. See migrations 000142-000144.
var motorCoreCols = []string{
	"vehicle_speed",
	"gear",
	"di_state",
}

type MotorRepo struct {
	db *DB
}

func NewMotorRepo(db *DB) *MotorRepo {
	return &MotorRepo{db: db}
}

func (r *MotorRepo) Insert(ctx context.Context, snap *models.MotorSnapshot) error {
	signalsJSON, err := marshalSignals(snap, motorCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO motor_snapshots
		(vehicle_id, vehicle_speed, gear, di_state, signals)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.VehicleSpeed, snap.Gear, snap.DiState, signalsJSON,
	).Scan(&snap.ID)
}

func (r *MotorRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.MotorSnapshot, error) {
	query := `SELECT id, vehicle_id, vehicle_speed, gear, di_state, signals, created_at
		FROM motor_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.MotorSnapshot
	for rows.Next() {
		s := &models.MotorSnapshot{}
		var signalsRaw []byte
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.VehicleSpeed, &s.Gear, &s.DiState,
			&signalsRaw, &s.CreatedAt); err != nil {
			return nil, err
		}
		if err := hydrateFromSignals(signalsRaw, s); err != nil {
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
