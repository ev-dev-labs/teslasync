package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// VehicleConfigRepo reads/writes config snapshots in the consolidated
// vehicle_meta_snapshots table (category='config').
type VehicleConfigRepo struct {
	db *DB
}

func NewVehicleConfigRepo(db *DB) *VehicleConfigRepo {
	return &VehicleConfigRepo{db: db}
}

func (r *VehicleConfigRepo) Insert(ctx context.Context, snap *models.VehicleConfigSnapshot) error {
	query := `INSERT INTO vehicle_meta_snapshots
		(vehicle_id, ts, category, car_type, exterior_color, wheel_type, software_version)
		VALUES ($1, $2, 'config', $3, $4, $5, $6)
		ON CONFLICT (vehicle_id, ts, category) DO UPDATE SET
			car_type         = COALESCE(EXCLUDED.car_type,         vehicle_meta_snapshots.car_type),
			exterior_color   = COALESCE(EXCLUDED.exterior_color,   vehicle_meta_snapshots.exterior_color),
			wheel_type       = COALESCE(EXCLUDED.wheel_type,       vehicle_meta_snapshots.wheel_type),
			software_version = COALESCE(EXCLUDED.software_version, vehicle_meta_snapshots.software_version)`
	_, err := r.db.Pool.Exec(ctx, query,
		snap.VehicleID, time.Now(),
		snap.CarType, snap.ExteriorColor, snap.WheelType, snap.Version,
	)
	return err
}

func (r *VehicleConfigRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.VehicleConfigSnapshot, error) {
	query := `SELECT vehicle_id, car_type, exterior_color, wheel_type, software_version, ts
		FROM vehicle_meta_snapshots
		WHERE vehicle_id = $1 AND category = 'config'
		ORDER BY ts DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.VehicleConfigSnapshot
	for rows.Next() {
		s := &models.VehicleConfigSnapshot{}
		if err := rows.Scan(
			&s.VehicleID, &s.CarType, &s.ExteriorColor,
			&s.WheelType, &s.Version, &s.CreatedAt,
		); err != nil {
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
