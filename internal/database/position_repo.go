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
	// Skip positions with zero lat/lon — these are telemetry noise, not real locations.
	if p.Latitude == 0 && p.Longitude == 0 {
		return nil
	}
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
		FROM positions WHERE vehicle_id = $1
		AND NOT (latitude = 0 AND longitude = 0)
		ORDER BY created_at DESC LIMIT $2 OFFSET $3`
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
		AND NOT (latitude = 0 AND longitude = 0)
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
		FROM positions WHERE vehicle_id = $1
		AND NOT (latitude = 0 AND longitude = 0)
		ORDER BY created_at DESC LIMIT 1`
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

// FindNearestPosition finds the closest position to the given timestamp (within ±window)
// that has non-zero values for battery_level OR odometer. This is used to backfill
// drive start/end values when the exact moment didn't have a signal reading.
//
// The query uses UNION ALL to find the closest before and after the timestamp,
// then picks whichever is closer. Returns nil if no suitable position is found.
func (r *PositionRepo) FindNearestPosition(ctx context.Context, vehicleID int64, target time.Time, window time.Duration) (*models.Position, error) {
	windowStart := target.Add(-window)
	windowEnd := target.Add(window)

	// Find the closest position (before or after) that has battery OR odometer data
	query := `
		WITH candidates AS (
			(SELECT *, ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz))) AS dist
			 FROM positions
			 WHERE vehicle_id = $1 AND created_at >= $3 AND created_at <= $2
			   AND (battery_level > 0 OR odometer > 0)
			 ORDER BY created_at DESC LIMIT 1)
			UNION ALL
			(SELECT *, ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz))) AS dist
			 FROM positions
			 WHERE vehicle_id = $1 AND created_at >= $2 AND created_at <= $4
			   AND (battery_level > 0 OR odometer > 0)
			 ORDER BY created_at ASC LIMIT 1)
		)
		SELECT id, vehicle_id, latitude, longitude, speed, power, heading, elevation,
			odometer, ideal_range, rated_range, battery_level, inside_temp, outside_temp,
			fan_status, is_climate_on, created_at
		FROM candidates ORDER BY dist LIMIT 1`

	p := &models.Position{}
	err := r.db.Pool.QueryRow(ctx, query, vehicleID, target, windowStart, windowEnd).Scan(
		&p.ID, &p.VehicleID, &p.Latitude, &p.Longitude, &p.Speed, &p.Power, &p.Heading,
		&p.Elevation, &p.Odometer, &p.IdealRange, &p.RatedRange, &p.BatteryLvl,
		&p.InsideTemp, &p.OutsideTemp, &p.FanStatus, &p.IsClimate, &p.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return p, nil
}