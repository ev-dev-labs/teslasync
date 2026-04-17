package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type DriveTelemetryRepo struct {
	db *DB
}

func NewDriveTelemetryRepo(db *DB) *DriveTelemetryRepo {
	return &DriveTelemetryRepo{db: db}
}

func (r *DriveTelemetryRepo) Insert(ctx context.Context, reading *models.DriveTelemetryReading) error {
	query := `
		INSERT INTO drive_telemetry_readings (
			drive_id, vehicle_id, latitude, longitude, elevation, heading, odometer,
			speed, power, battery_level, soc, usable_soc, rated_range, ideal_range, est_range,
			inside_temp, outside_temp, driver_temp, passenger_temp,
			fan_status, is_climate_on,
			tire_pressure_fl, tire_pressure_fr, tire_pressure_rl, tire_pressure_rr,
			battery_heater_on, acceleration_gs
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		reading.DriveID, reading.VehicleID,
		reading.Latitude, reading.Longitude, reading.Elevation, reading.Heading, reading.Odometer,
		reading.Speed, reading.Power, reading.BatteryLevel, reading.Soc, reading.UsableSoc,
		reading.RatedRange, reading.IdealRange, reading.EstRange,
		reading.InsideTemp, reading.OutsideTemp, reading.DriverTemp, reading.PassengerTemp,
		reading.FanStatus, reading.IsClimateOn,
		reading.TirePressureFL, reading.TirePressureFR, reading.TirePressureRL, reading.TirePressureRR,
		reading.BatteryHeaterOn, reading.AccelerationGs,
	).Scan(&reading.ID)
}

func (r *DriveTelemetryRepo) GetByDriveID(ctx context.Context, driveID int64) ([]*models.DriveTelemetryReading, error) {
	query := `SELECT id, drive_id, vehicle_id, latitude, longitude, elevation, heading, odometer,
		speed, power, battery_level, soc, usable_soc, rated_range, ideal_range, est_range,
		inside_temp, outside_temp, driver_temp, passenger_temp,
		fan_status, is_climate_on,
		tire_pressure_fl, tire_pressure_fr, tire_pressure_rl, tire_pressure_rr,
		battery_heater_on, acceleration_gs, created_at
		FROM drive_telemetry_readings WHERE drive_id = $1
		ORDER BY created_at ASC`
	rows, err := r.db.Pool.Query(ctx, query, driveID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var readings []*models.DriveTelemetryReading
	for rows.Next() {
		rd := &models.DriveTelemetryReading{}
		if err := rows.Scan(
			&rd.ID, &rd.DriveID, &rd.VehicleID,
			&rd.Latitude, &rd.Longitude, &rd.Elevation, &rd.Heading, &rd.Odometer,
			&rd.Speed, &rd.Power, &rd.BatteryLevel, &rd.Soc, &rd.UsableSoc,
			&rd.RatedRange, &rd.IdealRange, &rd.EstRange,
			&rd.InsideTemp, &rd.OutsideTemp, &rd.DriverTemp, &rd.PassengerTemp,
			&rd.FanStatus, &rd.IsClimateOn,
			&rd.TirePressureFL, &rd.TirePressureFR, &rd.TirePressureRL, &rd.TirePressureRR,
			&rd.BatteryHeaterOn, &rd.AccelerationGs, &rd.CreatedAt,
		); err != nil {
			return nil, err
		}
		readings = append(readings, rd)
	}
	return readings, rows.Err()
}
