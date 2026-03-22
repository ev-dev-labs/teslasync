package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// DriveRepo provides drive session data access.
type DriveRepo struct {
	db *DB
}

func NewDriveRepo(db *DB) *DriveRepo {
	return &DriveRepo{db: db}
}

func (r *DriveRepo) Create(ctx context.Context, d *models.Drive) error {
	query := `
		INSERT INTO drives (vehicle_id, start_date, start_position_id, start_address_id, start_range_km, start_battery_level)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		d.VehicleID, d.StartDate, d.StartPositionID, d.StartAddressID, d.StartRangeKm, d.StartBatteryLvl,
	).Scan(&d.ID)
}

func (r *DriveRepo) Complete(ctx context.Context, id int64, endDate time.Time, endPosID, endAddrID *int64,
	distance, duration float64, endRange *float64, endBattery *int, speedMax, powerMax, powerMin, insideAvg, outsideAvg *float64) error {
	query := `
		UPDATE drives SET end_date=$2, end_position_id=$3, end_address_id=$4,
		distance=$5, duration_min=$6, end_range_km=$7, end_battery_level=$8,
		speed_max=$9, power_max=$10, power_min=$11, inside_temp_avg=$12, outside_temp_avg=$13
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endDate, endPosID, endAddrID,
		distance, duration, endRange, endBattery, speedMax, powerMax, powerMin, insideAvg, outsideAvg)
	return err
}

func (r *DriveRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.Drive, error) {
	query := `SELECT id, vehicle_id, start_date, end_date, start_position_id, end_position_id,
		start_address_id, end_address_id, distance, duration_min, start_range_km, end_range_km,
		speed_max, power_max, power_min, start_battery_level, end_battery_level,
		inside_temp_avg, outside_temp_avg
		FROM drives WHERE vehicle_id=$1`
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
	query += fmt.Sprintf(" ORDER BY start_date DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit, offset)
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var drives []*models.Drive
	for rows.Next() {
		d := &models.Drive{}
		if err := rows.Scan(
			&d.ID, &d.VehicleID, &d.StartDate, &d.EndDate, &d.StartPositionID, &d.EndPositionID,
			&d.StartAddressID, &d.EndAddressID, &d.Distance, &d.DurationMin, &d.StartRangeKm,
			&d.EndRangeKm, &d.SpeedMax, &d.PowerMax, &d.PowerMin, &d.StartBatteryLvl,
			&d.EndBatteryLvl, &d.InsideTempAvg, &d.OutsideTempAvg,
		); err != nil {
			return nil, err
		}
		drives = append(drives, d)
	}
	return drives, rows.Err()
}

func (r *DriveRepo) GetByID(ctx context.Context, id int64) (*models.Drive, error) {
	query := `SELECT id, vehicle_id, start_date, end_date, start_position_id, end_position_id,
		start_address_id, end_address_id, distance, duration_min, start_range_km, end_range_km,
		speed_max, power_max, power_min, start_battery_level, end_battery_level,
		inside_temp_avg, outside_temp_avg
		FROM drives WHERE id=$1`
	d := &models.Drive{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&d.ID, &d.VehicleID, &d.StartDate, &d.EndDate, &d.StartPositionID, &d.EndPositionID,
		&d.StartAddressID, &d.EndAddressID, &d.Distance, &d.DurationMin, &d.StartRangeKm,
		&d.EndRangeKm, &d.SpeedMax, &d.PowerMax, &d.PowerMin, &d.StartBatteryLvl,
		&d.EndBatteryLvl, &d.InsideTempAvg, &d.OutsideTempAvg,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return d, err
}
