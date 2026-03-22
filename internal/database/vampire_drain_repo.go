package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type VampireDrainRepo struct {
	db *DB
}

func NewVampireDrainRepo(db *DB) *VampireDrainRepo {
	return &VampireDrainRepo{db: db}
}

func (r *VampireDrainRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int, startTime, endTime time.Time) ([]*models.VampireDrainEvent, error) {
	query := `SELECT id, vehicle_id, start_date, end_date, start_battery, end_battery, battery_lost,
		range_lost_km, duration_hours, drain_rate_pct_per_hour, outside_temp_avg, sentry_mode, created_at
		FROM vampire_drain_events WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_date >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_date <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_date DESC LIMIT $%d", argIdx)
	args = append(args, limit)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []*models.VampireDrainEvent
	for rows.Next() {
		e := &models.VampireDrainEvent{}
		if err := rows.Scan(&e.ID, &e.VehicleID, &e.StartDate, &e.EndDate, &e.StartBattery, &e.EndBattery,
			&e.BatteryLost, &e.RangeLostKm, &e.DurationHours, &e.DrainRatePctPerHr, &e.OutsideTempAvg,
			&e.SentryMode, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

func (r *VampireDrainRepo) GetStats(ctx context.Context, vehicleID int64) (map[string]interface{}, error) {
	query := `SELECT
		COALESCE(AVG(drain_rate_pct_per_hour), 0) as avg_drain_rate,
		COALESCE(MAX(drain_rate_pct_per_hour), 0) as max_drain_rate,
		COALESCE(SUM(range_lost_km), 0) as total_range_lost,
		COALESCE(SUM(duration_hours), 0) as total_hours,
		COUNT(*) as event_count,
		COALESCE(AVG(CASE WHEN sentry_mode THEN drain_rate_pct_per_hour END), 0) as avg_sentry_drain,
		COALESCE(AVG(CASE WHEN NOT sentry_mode THEN drain_rate_pct_per_hour END), 0) as avg_nosentry_drain
		FROM vampire_drain_events WHERE vehicle_id=$1`

	var avgRate, maxRate, totalRange, totalHours, avgSentryDrain, avgNoSentryDrain float64
	var count int64
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(&avgRate, &maxRate, &totalRange, &totalHours, &count, &avgSentryDrain, &avgNoSentryDrain)
	if err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"avg_drain_rate":     avgRate,
		"max_drain_rate":     maxRate,
		"total_range_lost":   totalRange,
		"total_hours":        totalHours,
		"event_count":        count,
		"avg_sentry_drain":   avgSentryDrain,
		"avg_nosentry_drain": avgNoSentryDrain,
	}, nil
}
