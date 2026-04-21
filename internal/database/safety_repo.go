package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// safetyCoreCols are the safety-system fields kept as dedicated SQL columns.
// Individual ADAS feature toggles live in the signals JSONB column.
// See migrations 000142-000144.
var safetyCoreCols = []string{
	"pin_to_drive_enabled",
	"miles_since_reset",
	"self_driving_miles_since_reset",
}

type SafetyRepo struct {
	db *DB
}

func NewSafetyRepo(db *DB) *SafetyRepo {
	return &SafetyRepo{db: db}
}

func (r *SafetyRepo) Insert(ctx context.Context, snap *models.SafetySnapshot) error {
	signalsJSON, err := marshalSignals(snap, safetyCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO safety_snapshots
		(vehicle_id, pin_to_drive_enabled, miles_since_reset, self_driving_miles_since_reset, signals)
		VALUES ($1, $2, $3, $4, $5) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.PinToDriveEnabled, snap.MilesSinceReset,
		snap.SelfDrivingMilesSinceReset, signalsJSON,
	).Scan(&snap.ID)
}

func (r *SafetyRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.SafetySnapshot, error) {
	query := `SELECT id, vehicle_id, pin_to_drive_enabled, miles_since_reset,
			self_driving_miles_since_reset, signals, created_at
		FROM safety_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.SafetySnapshot
	for rows.Next() {
		s := &models.SafetySnapshot{}
		var signalsRaw []byte
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.PinToDriveEnabled, &s.MilesSinceReset,
			&s.SelfDrivingMilesSinceReset, &signalsRaw, &s.CreatedAt); err != nil {
			return nil, err
		}
		if err := hydrateFromSignals(signalsRaw, s); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *SafetyRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.SafetySnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
