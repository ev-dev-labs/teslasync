package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/teslasync/teslasync/internal/models"
)

// ChargingRepo provides charging session data access.
type ChargingRepo struct {
	db *DB
}

func NewChargingRepo(db *DB) *ChargingRepo {
	return &ChargingRepo{db: db}
}

func (r *ChargingRepo) Create(ctx context.Context, c *models.ChargingSession) error {
	query := `
		INSERT INTO charging_sessions (vehicle_id, start_date, address_id, start_battery_level, start_range_km)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		c.VehicleID, c.StartDate, c.AddressID, c.StartBatteryLevel, c.StartRangeKm,
	).Scan(&c.ID)
}

func (r *ChargingRepo) Complete(ctx context.Context, id int64, endDate time.Time,
	energyAdded float64, energyUsed *float64, endBattery *int, endRange *float64,
	phases, voltage, current *int, power *float64,
	fastType, fastBrand, cable *string, cost *float64, duration float64) error {
	query := `
		UPDATE charging_sessions SET
		end_date=$2, charge_energy_added=$3, charge_energy_used=$4,
		end_battery_level=$5, end_range_km=$6, charger_phases=$7, charger_voltage=$8,
		charger_actual_current=$9, charger_power=$10, fast_charger_type=$11,
		fast_charger_brand=$12, conn_charge_cable=$13, cost=$14, duration_min=$15
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endDate, energyAdded, energyUsed,
		endBattery, endRange, phases, voltage, current, power,
		fastType, fastBrand, cable, cost, duration)
	return err
}

func (r *ChargingRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.ChargingSession, error) {
	query := `SELECT id, vehicle_id, start_date, end_date, address_id,
		charge_energy_added, charge_energy_used, start_battery_level, end_battery_level,
		start_range_km, end_range_km, charger_phases, charger_voltage, charger_actual_current,
		charger_power, fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min
		FROM charging_sessions WHERE vehicle_id=$1`
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

	var sessions []*models.ChargingSession
	for rows.Next() {
		c := &models.ChargingSession{}
		if err := rows.Scan(
			&c.ID, &c.VehicleID, &c.StartDate, &c.EndDate, &c.AddressID,
			&c.ChargeEnergyAdded, &c.ChargeEnergyUsed, &c.StartBatteryLevel, &c.EndBatteryLevel,
			&c.StartRangeKm, &c.EndRangeKm, &c.ChargerPhases, &c.ChargerVoltage,
			&c.ChargerActualCurrent, &c.ChargerPower, &c.FastChargerType, &c.FastChargerBrand,
			&c.ConnChargeCable, &c.Cost, &c.DurationMin,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

func (r *ChargingRepo) GetByID(ctx context.Context, id int64) (*models.ChargingSession, error) {
	query := `SELECT id, vehicle_id, start_date, end_date, address_id,
		charge_energy_added, charge_energy_used, start_battery_level, end_battery_level,
		start_range_km, end_range_km, charger_phases, charger_voltage, charger_actual_current,
		charger_power, fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min
		FROM charging_sessions WHERE id=$1`
	c := &models.ChargingSession{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&c.ID, &c.VehicleID, &c.StartDate, &c.EndDate, &c.AddressID,
		&c.ChargeEnergyAdded, &c.ChargeEnergyUsed, &c.StartBatteryLevel, &c.EndBatteryLevel,
		&c.StartRangeKm, &c.EndRangeKm, &c.ChargerPhases, &c.ChargerVoltage,
		&c.ChargerActualCurrent, &c.ChargerPower, &c.FastChargerType, &c.FastChargerBrand,
		&c.ConnChargeCable, &c.Cost, &c.DurationMin,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	return c, err
}
