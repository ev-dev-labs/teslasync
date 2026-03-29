package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type UserPreferenceRepo struct {
	db *DB
}

func NewUserPreferenceRepo(db *DB) *UserPreferenceRepo {
	return &UserPreferenceRepo{db: db}
}

func (r *UserPreferenceRepo) Insert(ctx context.Context, snap *models.UserPreferenceSnapshot) error {
	query := `INSERT INTO user_preference_snapshots (vehicle_id, setting_24hr_time, setting_charge_unit, setting_distance_unit, setting_temperature_unit, setting_tire_pressure_unit)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.Setting24hrTime, snap.SettingChargeUnit,
		snap.SettingDistanceUnit, snap.SettingTemperatureUnit, snap.SettingTirePressureUnit,
	).Scan(&snap.ID)
}

func (r *UserPreferenceRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.UserPreferenceSnapshot, error) {
	query := `SELECT id, vehicle_id, setting_24hr_time, setting_charge_unit, setting_distance_unit, setting_temperature_unit, setting_tire_pressure_unit, created_at
		FROM user_preference_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.UserPreferenceSnapshot
	for rows.Next() {
		s := &models.UserPreferenceSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.Setting24hrTime, &s.SettingChargeUnit,
			&s.SettingDistanceUnit, &s.SettingTemperatureUnit, &s.SettingTirePressureUnit,
			&s.CreatedAt); err != nil {
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
