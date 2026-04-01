package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
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
		INSERT INTO charging_sessions (vehicle_id, start_date, address_id, start_battery_level, start_range_km, latitude, longitude)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		c.VehicleID, c.StartDate, c.AddressID, c.StartBatteryLevel, c.StartRangeKm, c.Latitude, c.Longitude,
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
		charger_power, fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min,
		latitude, longitude, location_name, inside_temp_avg, outside_temp_avg
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
			&c.Latitude, &c.Longitude, &c.LocationName, &c.InsideTempAvg, &c.OutsideTempAvg,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

func (r *ChargingRepo) GetByID(ctx context.Context, id int64) (*models.ChargingSession, error) {
	query := `SELECT cs.id, cs.vehicle_id, cs.start_date, cs.end_date, cs.address_id,
		cs.charge_energy_added, cs.charge_energy_used, cs.start_battery_level, cs.end_battery_level,
		cs.start_range_km, cs.end_range_km, cs.charger_phases, cs.charger_voltage, cs.charger_actual_current,
		cs.charger_power, cs.fast_charger_type, cs.fast_charger_brand, cs.conn_charge_cable, cs.cost, cs.duration_min,
		cs.latitude, cs.longitude, cs.location_name, cs.inside_temp_avg, cs.outside_temp_avg,
		a.id, a.display_name, a.latitude, a.longitude, a.name, a.house_number,
		a.road, a.city, a.county, a.state, a.country, a.postcode
		FROM charging_sessions cs
		LEFT JOIN addresses a ON a.id = cs.address_id
		WHERE cs.id=$1`
	c := &models.ChargingSession{}
	var addrID *int64
	var addrDisplay, addrName, addrHouse, addrRoad, addrCity, addrCounty, addrState, addrCountry, addrPost *string
	var addrLat, addrLon *float64
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&c.ID, &c.VehicleID, &c.StartDate, &c.EndDate, &c.AddressID,
		&c.ChargeEnergyAdded, &c.ChargeEnergyUsed, &c.StartBatteryLevel, &c.EndBatteryLevel,
		&c.StartRangeKm, &c.EndRangeKm, &c.ChargerPhases, &c.ChargerVoltage,
		&c.ChargerActualCurrent, &c.ChargerPower, &c.FastChargerType, &c.FastChargerBrand,
		&c.ConnChargeCable, &c.Cost, &c.DurationMin,
		&c.Latitude, &c.Longitude, &c.LocationName, &c.InsideTempAvg, &c.OutsideTempAvg,
		&addrID, &addrDisplay, &addrLat, &addrLon, &addrName, &addrHouse,
		&addrRoad, &addrCity, &addrCounty, &addrState, &addrCountry, &addrPost,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if addrID != nil {
		c.Address = &models.Address{
			ID:          *addrID,
			DisplayName: ptrStr(addrDisplay),
			Latitude:    ptrFloat(addrLat),
			Longitude:   ptrFloat(addrLon),
			Name:        addrName,
			HouseNumber: addrHouse,
			Road:        addrRoad,
			City:        addrCity,
			County:      addrCounty,
			State:       addrState,
			Country:     addrCountry,
			PostCode:    addrPost,
		}
		// Populate lat/lon/location_name from address if not set on session
		if c.Latitude == nil && addrLat != nil {
			c.Latitude = addrLat
		}
		if c.Longitude == nil && addrLon != nil {
			c.Longitude = addrLon
		}
		if c.LocationName == nil && addrDisplay != nil {
			c.LocationName = addrDisplay
		}
	}
	return c, nil
}

// GetStale returns charging sessions that have no end_date and started before the cutoff time.
func (r *ChargingRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*models.ChargingSession, error) {
	query := `SELECT id, vehicle_id, start_date, end_date, address_id,
		charge_energy_added, charge_energy_used, start_battery_level, end_battery_level,
		start_range_km, end_range_km, charger_phases, charger_voltage, charger_actual_current,
		charger_power, fast_charger_type, fast_charger_brand, conn_charge_cable, cost, duration_min,
		latitude, longitude, location_name, inside_temp_avg, outside_temp_avg
		FROM charging_sessions WHERE end_date IS NULL AND start_date < $1
		ORDER BY start_date DESC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
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
			&c.Latitude, &c.Longitude, &c.LocationName, &c.InsideTempAvg, &c.OutsideTempAvg,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

// chargingPartialAllowed maps JSON field names to database columns for charging partial updates.
var chargingPartialAllowed = map[string]string{
	"end_date":              "end_date",
	"charge_energy_added":   "charge_energy_added",
	"charge_energy_used":    "charge_energy_used",
	"end_battery_level":     "end_battery_level",
	"end_range_km":          "end_range_km",
	"charger_phases":        "charger_phases",
	"charger_voltage":       "charger_voltage",
	"charger_actual_current":"charger_actual_current",
	"charger_power":         "charger_power",
	"fast_charger_type":     "fast_charger_type",
	"fast_charger_brand":    "fast_charger_brand",
	"conn_charge_cable":     "conn_charge_cable",
	"cost":                  "cost",
	"duration_min":          "duration_min",
	"start_battery_level":   "start_battery_level",
	"latitude":              "latitude",
	"longitude":             "longitude",
	"location_name":         "location_name",
	"inside_temp_avg":       "inside_temp_avg",
	"outside_temp_avg":      "outside_temp_avg",
}

// PartialUpdate updates only the provided fields on a charging session.
func (r *ChargingRepo) PartialUpdate(ctx context.Context, id int64, fields map[string]interface{}) error {
	query, args := buildPartialUpdate("charging_sessions", id, fields, chargingPartialAllowed)
	if query == "" {
		return nil
	}
	_, err := r.db.Pool.Exec(ctx, query, args...)
	return err
}

// Delete removes a charging session by ID.
func (r *ChargingRepo) Delete(ctx context.Context, id int64) error {
	_, err := r.db.Pool.Exec(ctx, "DELETE FROM charging_sessions WHERE id=$1", id)
	return err
}

// CompleteWithTx is like Complete but uses the provided transaction.
func (r *ChargingRepo) CompleteWithTx(ctx context.Context, tx DBTX, id int64, endDate time.Time,
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
	_, err := tx.Exec(ctx, query, id, endDate, energyAdded, energyUsed,
		endBattery, endRange, phases, voltage, current, power,
		fastType, fastBrand, cable, cost, duration)
	return err
}

// PartialUpdateWithTx is like PartialUpdate but uses the provided transaction.
func (r *ChargingRepo) PartialUpdateWithTx(ctx context.Context, tx DBTX, id int64, fields map[string]interface{}) error {
	query, args := buildPartialUpdate("charging_sessions", id, fields, chargingPartialAllowed)
	if query == "" {
		return nil
	}
	_, err := tx.Exec(ctx, query, args...)
	return err
}
