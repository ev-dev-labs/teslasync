package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// vehicleConfigCoreCols are the vehicle-configuration fields kept as dedicated
// SQL columns. Cosmetic options and software-update state live in the signals
// JSONB column. See migrations 000142-000144.
var vehicleConfigCoreCols = []string{
	"car_type",
	"version",
	"vehicle_name",
}

type VehicleConfigRepo struct {
	db *DB
}

func NewVehicleConfigRepo(db *DB) *VehicleConfigRepo {
	return &VehicleConfigRepo{db: db}
}

func (r *VehicleConfigRepo) Insert(ctx context.Context, snap *models.VehicleConfigSnapshot) error {
	signalsJSON, err := marshalSignals(snap, vehicleConfigCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO vehicle_config_snapshots
		(vehicle_id, car_type, version, vehicle_name, signals)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.CarType, snap.Version, snap.VehicleName, signalsJSON,
	).Scan(&snap.ID)
}

func (r *VehicleConfigRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.VehicleConfigSnapshot, error) {
	query := `SELECT id, vehicle_id, car_type, version, vehicle_name, signals, created_at
		FROM vehicle_config_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.VehicleConfigSnapshot
	for rows.Next() {
		s := &models.VehicleConfigSnapshot{}
		var signalsRaw []byte
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.CarType, &s.Version, &s.VehicleName,
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

func (r *VehicleConfigRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.VehicleConfigSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
