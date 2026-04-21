package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// climateCoreCols are the climate/HVAC fields kept as dedicated SQL columns.
// Everything else lives in the signals JSONB column. See migrations 000142-000144.
var climateCoreCols = []string{
	"inside_temp",
	"outside_temp",
	"hvac_ac_enabled",
	"hvac_auto_mode",
	"hvac_fan_speed",
}

type ClimateRepo struct {
	db *DB
}

func NewClimateRepo(db *DB) *ClimateRepo {
	return &ClimateRepo{db: db}
}

func (r *ClimateRepo) Insert(ctx context.Context, snap *models.ClimateSnapshot) error {
	signalsJSON, err := marshalSignals(snap, climateCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO climate_snapshots
		(vehicle_id, inside_temp, outside_temp, hvac_ac_enabled, hvac_auto_mode,
		 hvac_fan_speed, signals)
		VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.InsideTemp, snap.OutsideTemp, snap.HvacACEnabled,
		snap.HvacAutoMode, snap.HvacFanSpeed, signalsJSON,
	).Scan(&snap.ID)
}

func (r *ClimateRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.ClimateSnapshot, error) {
	query := `SELECT id, vehicle_id, inside_temp, outside_temp, hvac_ac_enabled,
			hvac_auto_mode, hvac_fan_speed, signals, created_at
		FROM climate_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.ClimateSnapshot
	for rows.Next() {
		s := &models.ClimateSnapshot{}
		var signalsRaw []byte
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.InsideTemp, &s.OutsideTemp,
			&s.HvacACEnabled, &s.HvacAutoMode, &s.HvacFanSpeed, &signalsRaw,
			&s.CreatedAt); err != nil {
			return nil, err
		}
		if err := hydrateFromSignals(signalsRaw, s); err != nil {
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
