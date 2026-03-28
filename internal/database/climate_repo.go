package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type ClimateRepo struct {
	db *DB
}

func NewClimateRepo(db *DB) *ClimateRepo {
	return &ClimateRepo{db: db}
}

func (r *ClimateRepo) Insert(ctx context.Context, snap *models.ClimateSnapshot) error {
	query := `INSERT INTO climate_snapshots (vehicle_id, inside_temp, outside_temp, hvac_power, hvac_fan_speed, hvac_left_temp_request, hvac_right_temp_request, cabin_overheat_mode, defrost_mode, battery_heater_on)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.InsideTemp, snap.OutsideTemp, snap.HvacPower, snap.HvacFanSpeed,
		snap.HvacLeftTempRequest, snap.HvacRightTempRequest, snap.CabinOverheatMode,
		snap.DefrostMode, snap.BatteryHeaterOn,
	).Scan(&snap.ID)
}

func (r *ClimateRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.ClimateSnapshot, error) {
	query := `SELECT id, vehicle_id, inside_temp, outside_temp, hvac_power, hvac_fan_speed, hvac_left_temp_request, hvac_right_temp_request, cabin_overheat_mode, defrost_mode, battery_heater_on, created_at
		FROM climate_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.ClimateSnapshot
	for rows.Next() {
		s := &models.ClimateSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.InsideTemp, &s.OutsideTemp, &s.HvacPower, &s.HvacFanSpeed,
			&s.HvacLeftTempRequest, &s.HvacRightTempRequest, &s.CabinOverheatMode,
			&s.DefrostMode, &s.BatteryHeaterOn, &s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *ClimateRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.ClimateSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
