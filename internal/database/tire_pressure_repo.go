package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TirePressureRepo reads/writes tire pressure data via the consolidated
// vehicle_meta_snapshots table (category='tire'). The old tire_pressure_snapshots
// table was dropped in migration 000142_baseline_typed.
type TirePressureRepo struct {
	db *DB
}

func NewTirePressureRepo(db *DB) *TirePressureRepo {
	return &TirePressureRepo{db: db}
}

// Insert stores a new tire pressure snapshot. Readings where all four
// pressures are zero (car asleep / sensor unavailable) are silently skipped.
func (r *TirePressureRepo) Insert(ctx context.Context, snap *models.TirePressureSnapshot) error {
	if (snap.FrontLeft == nil || *snap.FrontLeft == 0) &&
		(snap.FrontRight == nil || *snap.FrontRight == 0) &&
		(snap.RearLeft == nil || *snap.RearLeft == 0) &&
		(snap.RearRight == nil || *snap.RearRight == 0) {
		return nil // skip all-zero readings
	}
	query := `INSERT INTO vehicle_meta_snapshots
		(vehicle_id, ts, category,
		 tire_pressure_fl_psi, tire_pressure_fr_psi,
		 tire_pressure_rl_psi, tire_pressure_rr_psi, source)
		VALUES ($1, $2, 'tire', $3, $4, $5, $6, 'fleet_telemetry')
		ON CONFLICT (vehicle_id, ts, category) DO NOTHING`
	_, err := r.db.Pool.Exec(ctx, query,
		snap.VehicleID, time.Now().UTC(),
		snap.FrontLeft, snap.FrontRight, snap.RearLeft, snap.RearRight)
	return err
}

func (r *TirePressureRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.TirePressureSnapshot, error) {
	query := `SELECT vehicle_id,
		tire_pressure_fl_psi, tire_pressure_fr_psi,
		tire_pressure_rl_psi, tire_pressure_rr_psi, ts
		FROM vehicle_meta_snapshots
		WHERE vehicle_id = $1 AND category = 'tire'
		  AND NOT (COALESCE(tire_pressure_fl_psi, 0) = 0
		       AND COALESCE(tire_pressure_fr_psi, 0) = 0
		       AND COALESCE(tire_pressure_rl_psi, 0) = 0
		       AND COALESCE(tire_pressure_rr_psi, 0) = 0)
		ORDER BY ts DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.TirePressureSnapshot
	for rows.Next() {
		s := &models.TirePressureSnapshot{}
		if err := rows.Scan(&s.VehicleID,
			&s.FrontLeft, &s.FrontRight, &s.RearLeft, &s.RearRight,
			&s.CreatedAt); err != nil {
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
