package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// userPreferenceCoreCols are the user-preference fields kept as dedicated SQL
// columns. Secondary unit preferences live in the signals JSONB column.
// See migrations 000142-000144.
var userPreferenceCoreCols = []string{
	"setting_distance_unit",
	"setting_temperature_unit",
}

type UserPreferenceRepo struct {
	db *DB
}

func NewUserPreferenceRepo(db *DB) *UserPreferenceRepo {
	return &UserPreferenceRepo{db: db}
}

func (r *UserPreferenceRepo) Insert(ctx context.Context, snap *models.UserPreferenceSnapshot) error {
	signalsJSON, err := marshalSignals(snap, userPreferenceCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO user_preference_snapshots
		(vehicle_id, setting_distance_unit, setting_temperature_unit, signals)
		VALUES ($1, $2, $3, $4) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.SettingDistanceUnit, snap.SettingTemperatureUnit, signalsJSON,
	).Scan(&snap.ID)
}

func (r *UserPreferenceRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.UserPreferenceSnapshot, error) {
	query := `SELECT id, vehicle_id, setting_distance_unit, setting_temperature_unit,
			signals, created_at
		FROM user_preference_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.UserPreferenceSnapshot
	for rows.Next() {
		s := &models.UserPreferenceSnapshot{}
		var signalsRaw []byte
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.SettingDistanceUnit,
			&s.SettingTemperatureUnit, &signalsRaw, &s.CreatedAt); err != nil {
			return nil, err
		}
		if err := hydrateFromSignals(signalsRaw, s); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *UserPreferenceRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.UserPreferenceSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
