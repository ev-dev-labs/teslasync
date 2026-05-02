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
		INSERT INTO charging_sessions (vehicle_id, start_ts, start_battery_pct, charger_type, charger_location)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		c.VehicleID, c.StartTs, c.StartBatteryPct, c.ChargerType, c.ChargerLocation,
	).Scan(&c.ID)
}

func (r *ChargingRepo) Complete(ctx context.Context, id int64, endTs time.Time,
	energyAddedKwh *float64, endBatteryPct *int16, milesAdded *float64,
	chargerPowerKwMax, chargerPowerKwAvg *float64,
	cost *float64, costCurrency *string, durationMin *float64, endedStatus *string) error {
	query := `
		UPDATE charging_sessions SET
		end_ts=$2, energy_added_kwh=$3, end_battery_pct=$4, miles_added=$5,
		charger_power_kw_max=$6, charger_power_kw_avg=$7,
		cost=$8, cost_currency=$9, duration_min=$10, ended_status=$11
		WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, endTs, energyAddedKwh, endBatteryPct,
		milesAdded, chargerPowerKwMax, chargerPowerKwAvg,
		cost, costCurrency, durationMin, endedStatus)
	return err
}

func (r *ChargingRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*models.ChargingSession, error) {
	query := `SELECT id, vehicle_id, start_ts, end_ts, duration_min,
		start_battery_pct, end_battery_pct, energy_added_kwh, miles_added,
		charger_type, charger_location, charger_power_kw_max, charger_power_kw_avg,
		cost, cost_currency, max_charger_voltage, charger_phases, cable_type,
		ended_status, created_at, updated_at
		FROM charging_sessions WHERE vehicle_id=$1`
	args := []interface{}{vehicleID}
	argIdx := 2
	if !startTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts >= $%d", argIdx)
		args = append(args, startTime)
		argIdx++
	}
	if !endTime.IsZero() {
		query += fmt.Sprintf(" AND start_ts <= $%d", argIdx)
		args = append(args, endTime)
		argIdx++
	}
	query += fmt.Sprintf(" ORDER BY start_ts DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
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
			&c.ID, &c.VehicleID, &c.StartTs, &c.EndTs, &c.DurationMin,
			&c.StartBatteryPct, &c.EndBatteryPct, &c.EnergyAddedKwh, &c.MilesAdded,
			&c.ChargerType, &c.ChargerLocation, &c.ChargerPowerKwMax, &c.ChargerPowerKwAvg,
			&c.Cost, &c.CostCurrency, &c.MaxChargerVoltage, &c.ChargerPhases, &c.CableType,
			&c.EndedStatus, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

func (r *ChargingRepo) GetByID(ctx context.Context, id int64) (*models.ChargingSession, error) {
	query := `SELECT id, vehicle_id, start_ts, end_ts, duration_min,
		start_battery_pct, end_battery_pct, energy_added_kwh, miles_added,
		charger_type, charger_location, charger_power_kw_max, charger_power_kw_avg,
		cost, cost_currency, max_charger_voltage, charger_phases, cable_type,
		ended_status, created_at, updated_at
		FROM charging_sessions WHERE id=$1`
	c := &models.ChargingSession{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&c.ID, &c.VehicleID, &c.StartTs, &c.EndTs, &c.DurationMin,
		&c.StartBatteryPct, &c.EndBatteryPct, &c.EnergyAddedKwh, &c.MilesAdded,
		&c.ChargerType, &c.ChargerLocation, &c.ChargerPowerKwMax, &c.ChargerPowerKwAvg,
		&c.Cost, &c.CostCurrency, &c.MaxChargerVoltage, &c.ChargerPhases, &c.CableType,
		&c.EndedStatus, &c.CreatedAt, &c.UpdatedAt,
	)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return c, nil
}

// GetStale returns charging sessions that have no end_ts and started before the cutoff time.
func (r *ChargingRepo) GetStale(ctx context.Context, cutoff time.Time) ([]*models.ChargingSession, error) {
	query := `SELECT id, vehicle_id, start_ts, end_ts, duration_min,
		start_battery_pct, end_battery_pct, energy_added_kwh, miles_added,
		charger_type, charger_location, charger_power_kw_max, charger_power_kw_avg,
		cost, cost_currency, max_charger_voltage, charger_phases, cable_type,
		ended_status, created_at, updated_at
		FROM charging_sessions WHERE end_ts IS NULL AND start_ts < $1
		ORDER BY start_ts DESC`
	rows, err := r.db.Pool.Query(ctx, query, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*models.ChargingSession
	for rows.Next() {
		c := &models.ChargingSession{}
		if err := rows.Scan(
			&c.ID, &c.VehicleID, &c.StartTs, &c.EndTs, &c.DurationMin,
			&c.StartBatteryPct, &c.EndBatteryPct, &c.EnergyAddedKwh, &c.MilesAdded,
			&c.ChargerType, &c.ChargerLocation, &c.ChargerPowerKwMax, &c.ChargerPowerKwAvg,
			&c.Cost, &c.CostCurrency, &c.MaxChargerVoltage, &c.ChargerPhases, &c.CableType,
			&c.EndedStatus, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, c)
	}
	return sessions, rows.Err()
}

// chargingPartialAllowed maps JSON field names to database columns for charging partial updates.
var chargingPartialAllowed = map[string]string{
	"end_ts":               "end_ts",
	"duration_min":         "duration_min",
	"start_battery_pct":    "start_battery_pct",
	"end_battery_pct":      "end_battery_pct",
	"energy_added_kwh":     "energy_added_kwh",
	"miles_added":          "miles_added",
	"charger_type":         "charger_type",
	"charger_location":     "charger_location",
	"charger_power_kw_max": "charger_power_kw_max",
	"charger_power_kw_avg": "charger_power_kw_avg",
	"cost":                 "cost",
	"cost_currency":        "cost_currency",
	"max_charger_voltage":  "max_charger_voltage",
	"charger_phases":       "charger_phases",
	"cable_type":           "cable_type",
	"ended_status":         "ended_status",
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

// FilterExistingIDs returns the subset of `ids` that exist in the
// charging_sessions table, in arbitrary order. Used by bulk handlers to
// surface {id, "not_found"} per-id failures without round-tripping per id.
func (r *ChargingRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM charging_sessions WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// BulkDelete removes charging sessions whose IDs are in `ids`, all inside a
// single transaction. Returns the actual rows-affected count. Callers should
// pre-validate which ids exist via FilterExistingIDs to surface failed ids
// to the client.
func (r *ChargingRepo) BulkDelete(ctx context.Context, ids []int64) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var deleted int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM charging_sessions WHERE id = ANY($1)`, ids)
		if err != nil {
			return err
		}
		deleted = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("bulk delete charging sessions: %w", err)
	}
	return deleted, nil
}

// CompleteWithTx is like Complete but uses the provided transaction.
func (r *ChargingRepo) CompleteWithTx(ctx context.Context, tx DBTX, id int64, endTs time.Time,
	energyAddedKwh *float64, endBatteryPct *int16, milesAdded *float64,
	chargerPowerKwMax, chargerPowerKwAvg *float64,
	cost *float64, costCurrency *string, durationMin *float64, endedStatus *string) error {
	query := `
		UPDATE charging_sessions SET
		end_ts=$2, energy_added_kwh=$3, end_battery_pct=$4, miles_added=$5,
		charger_power_kw_max=$6, charger_power_kw_avg=$7,
		cost=$8, cost_currency=$9, duration_min=$10, ended_status=$11
		WHERE id=$1`
	_, err := tx.Exec(ctx, query, id, endTs, energyAddedKwh, endBatteryPct,
		milesAdded, chargerPowerKwMax, chargerPowerKwAvg,
		cost, costCurrency, durationMin, endedStatus)
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
