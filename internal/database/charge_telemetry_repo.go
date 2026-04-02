package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type ChargeTelemetryReadingRepo struct {
	db *DB
}

func NewChargeTelemetryReadingRepo(db *DB) *ChargeTelemetryReadingRepo {
	return &ChargeTelemetryReadingRepo{db: db}
}

func (r *ChargeTelemetryReadingRepo) Insert(ctx context.Context, reading *models.ChargeTelemetryReading) error {
	query := `
		INSERT INTO charge_telemetry_readings (
			session_id, vehicle_id, battery_level, soc, power_kw, voltage, current_amps,
			phases, energy_added, rated_range, ideal_range, est_range,
			inside_temp, outside_temp, battery_temp,
			latitude, longitude, charge_rate
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		reading.SessionID, reading.VehicleID,
		reading.BatteryLevel, reading.Soc, reading.PowerKW, reading.Voltage, reading.CurrentAmps,
		reading.Phases, reading.EnergyAdded, reading.RatedRange, reading.IdealRange, reading.EstRange,
		reading.InsideTemp, reading.OutsideTemp, reading.BatteryTemp,
		reading.Latitude, reading.Longitude, reading.ChargeRate,
	).Scan(&reading.ID)
}

func (r *ChargeTelemetryReadingRepo) GetBySessionID(ctx context.Context, sessionID int64) ([]*models.ChargeTelemetryReading, error) {
	query := `SELECT id, session_id, vehicle_id, battery_level, soc, power_kw, voltage, current_amps,
		phases, energy_added, rated_range, ideal_range, est_range,
		inside_temp, outside_temp, battery_temp,
		latitude, longitude, charge_rate, created_at
		FROM charge_telemetry_readings WHERE session_id = $1
		ORDER BY created_at ASC`
	rows, err := r.db.Pool.Query(ctx, query, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var readings []*models.ChargeTelemetryReading
	for rows.Next() {
		rd := &models.ChargeTelemetryReading{}
		if err := rows.Scan(
			&rd.ID, &rd.SessionID, &rd.VehicleID,
			&rd.BatteryLevel, &rd.Soc, &rd.PowerKW, &rd.Voltage, &rd.CurrentAmps,
			&rd.Phases, &rd.EnergyAdded, &rd.RatedRange, &rd.IdealRange, &rd.EstRange,
			&rd.InsideTemp, &rd.OutsideTemp, &rd.BatteryTemp,
			&rd.Latitude, &rd.Longitude, &rd.ChargeRate, &rd.CreatedAt,
		); err != nil {
			return nil, err
		}
		readings = append(readings, rd)
	}
	return readings, rows.Err()
}
