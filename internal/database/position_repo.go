package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// PositionRepo provides position data access.
type PositionRepo struct {
	db *DB
}

func NewPositionRepo(db *DB) *PositionRepo {
	return &PositionRepo{db: db}
}

func (r *PositionRepo) Insert(ctx context.Context, p *models.Position) error {
	query := `
		INSERT INTO positions (vehicle_id, latitude, longitude, speed, power, heading, elevation,
			odometer, ideal_range, rated_range, battery_level, inside_temp, outside_temp,
			fan_status, is_climate_on, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		RETURNING id`
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx, query,
		p.VehicleID, p.Latitude, p.Longitude, p.Speed, p.Power, p.Heading, p.Elevation,
		p.Odometer, p.IdealRange, p.RatedRange, p.BatteryLvl, p.InsideTemp, p.OutsideTemp,
		p.FanStatus, p.IsClimate, now,
	).Scan(&p.ID)
}

func (r *PositionRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int) ([]*models.Position, error) {
	query := `SELECT id, vehicle_id, latitude, longitude, speed, power, heading, elevation,
		odometer, ideal_range, rated_range, battery_level, inside_temp, outside_temp,
		fan_status, is_climate_on, created_at
		FROM positions WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []*models.Position
	for rows.Next() {
		p := &models.Position{}
		if err := rows.Scan(
			&p.ID, &p.VehicleID, &p.Latitude, &p.Longitude, &p.Speed, &p.Power, &p.Heading,
			&p.Elevation, &p.Odometer, &p.IdealRange, &p.RatedRange, &p.BatteryLvl,
			&p.InsideTemp, &p.OutsideTemp, &p.FanStatus, &p.IsClimate, &p.CreatedAt,
		); err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	return positions, rows.Err()
}

func (r *PositionRepo) GetByTimeRange(ctx context.Context, vehicleID int64, start time.Time, end *time.Time) ([]*models.Position, error) {
	var endTime time.Time
	if end != nil {
		endTime = *end
	} else {
		endTime = time.Now()
	}
	query := `SELECT id, vehicle_id, latitude, longitude, speed, power, heading, elevation,
		odometer, ideal_range, rated_range, battery_level, inside_temp, outside_temp,
		fan_status, is_climate_on, created_at
		FROM positions WHERE vehicle_id = $1 AND created_at >= $2 AND created_at <= $3
		ORDER BY created_at ASC LIMIT 10000`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, start, endTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var positions []*models.Position
	for rows.Next() {
		p := &models.Position{}
		if err := rows.Scan(
			&p.ID, &p.VehicleID, &p.Latitude, &p.Longitude, &p.Speed, &p.Power, &p.Heading,
			&p.Elevation, &p.Odometer, &p.IdealRange, &p.RatedRange, &p.BatteryLvl,
			&p.InsideTemp, &p.OutsideTemp, &p.FanStatus, &p.IsClimate, &p.CreatedAt,
		); err != nil {
			return nil, err
		}
		positions = append(positions, p)
	}
	return positions, rows.Err()
}

func (r *PositionRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.Position, error) {
	query := `SELECT id, vehicle_id, latitude, longitude, speed, power, heading, elevation,
		odometer, ideal_range, rated_range, battery_level, inside_temp, outside_temp,
		fan_status, is_climate_on, created_at
		FROM positions WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 1`
	p := &models.Position{}
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(
		&p.ID, &p.VehicleID, &p.Latitude, &p.Longitude, &p.Speed, &p.Power, &p.Heading,
		&p.Elevation, &p.Odometer, &p.IdealRange, &p.RatedRange, &p.BatteryLvl,
		&p.InsideTemp, &p.OutsideTemp, &p.FanStatus, &p.IsClimate, &p.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return p, nil
}
