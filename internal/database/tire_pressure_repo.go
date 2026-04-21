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

// Insert stores a new tire pressure snapshot. Readings where all four
// pressures are zero (car asleep / sensor unavailable) are silently skipped.
func (r *TirePressureRepo) Insert(ctx context.Context, snap *models.TirePressureSnapshot) error {
	if (snap.FrontLeft == nil || *snap.FrontLeft == 0) &&
		(snap.FrontRight == nil || *snap.FrontRight == 0) &&
		(snap.RearLeft == nil || *snap.RearLeft == 0) &&
		(snap.RearRight == nil || *snap.RearRight == 0) {
		return nil // skip all-zero readings
	}
	if snap.Signals == nil {
		snap.Signals = models.SignalsMap{}
	}
	query := `INSERT INTO tire_pressure_snapshots (vehicle_id, front_left, front_right, rear_left, rear_right, tpms_hard_warnings, tpms_soft_warnings, last_seen_time_fl, last_seen_time_fr, last_seen_time_rl, last_seen_time_rr, signals)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.FrontLeft, snap.FrontRight, snap.RearLeft, snap.RearRight,
		snap.TpmsHardWarn, snap.TpmsSoftWarn,
		snap.LastSeenTimeFl, snap.LastSeenTimeFr, snap.LastSeenTimeRl, snap.LastSeenTimeRr,
		snap.Signals,
	).Scan(&snap.ID)
}

func (r *TirePressureRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.TirePressureSnapshot, error) {
	query := `SELECT id, vehicle_id, front_left, front_right, rear_left, rear_right,
		tpms_hard_warnings, tpms_soft_warnings,
		last_seen_time_fl, last_seen_time_fr, last_seen_time_rl, last_seen_time_rr,
		signals, created_at
		FROM tire_pressure_snapshots
		WHERE vehicle_id=$1
		  AND NOT (front_left = 0 AND front_right = 0 AND rear_left = 0 AND rear_right = 0)
		ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.TirePressureSnapshot
	for rows.Next() {
		s := &models.TirePressureSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.FrontLeft, &s.FrontRight, &s.RearLeft, &s.RearRight,
			&s.TpmsHardWarn, &s.TpmsSoftWarn,
			&s.LastSeenTimeFl, &s.LastSeenTimeFr, &s.LastSeenTimeRl, &s.LastSeenTimeRr,
			&s.Signals, &s.CreatedAt); err != nil {
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
