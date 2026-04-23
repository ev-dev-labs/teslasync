package database

import (
	"context"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// ChargingTelemetryRepo persists 1 Hz charging telemetry samples to the
// `charging_telemetry` hypertable (see migrations/000142_baseline_typed.up.sql).
type ChargingTelemetryRepo struct {
	db *DB
}

func NewChargingTelemetryRepo(db *DB) *ChargingTelemetryRepo {
	return &ChargingTelemetryRepo{db: db}
}

// BulkInsert efficiently writes a batch of charging telemetry samples using
// pgx.CopyFrom. Returns nil for empty input.
func (r *ChargingTelemetryRepo) BulkInsert(ctx context.Context, ts []models.ChargingTelemetry) error {
	if len(ts) == 0 {
		return nil
	}
	cols := []string{
		"vehicle_id",
		"ts",
		"session_id",
		"battery_level",
		"battery_range_mi",
		"charging_state",
		"charger_voltage",
		"charger_actual_current",
		"charger_power_kw",
		"charger_phases",
		"charge_energy_added_kwh",
		"charge_miles_added",
		"charge_rate_mph",
		"charger_pilot_current",
		"scheduled_charging_at",
		"source",
	}
	rows := pgx.CopyFromSlice(len(ts), func(i int) ([]any, error) {
		t := ts[i]
		return []any{
			t.VehicleID,
			t.Ts,
			t.SessionID,
			t.BatteryLevel,
			t.BatteryRangeMi,
			t.ChargingState,
			t.ChargerVoltage,
			t.ChargerActualCurrent,
			t.ChargerPowerKw,
			t.ChargerPhases,
			t.ChargeEnergyAddedKwh,
			t.ChargeMilesAdded,
			t.ChargeRateMph,
			t.ChargerPilotCurrent,
			t.ScheduledChargingAt,
			t.Source,
		}, nil
	})
	if _, err := r.db.Pool.CopyFrom(ctx, pgx.Identifier{"charging_telemetry"}, cols, rows); err != nil {
		return fmt.Errorf("charging-telemetry-repo-bulk-insert: %w", err)
	}
	return nil
}

// ListBySession returns all telemetry samples for a charging session ordered
// by timestamp ascending.
func (r *ChargingTelemetryRepo) ListBySession(ctx context.Context, sessionID int64) ([]models.ChargingTelemetry, error) {
	const q = `
		SELECT vehicle_id, ts, session_id, battery_level, battery_range_mi,
		       charging_state, charger_voltage, charger_actual_current,
		       charger_power_kw, charger_phases, charge_energy_added_kwh,
		       charge_miles_added, charge_rate_mph, charger_pilot_current,
		       scheduled_charging_at, source
		FROM charging_telemetry
		WHERE session_id = $1
		ORDER BY ts ASC`
	rows, err := r.db.Pool.Query(ctx, q, sessionID)
	if err != nil {
		return nil, fmt.Errorf("charging-telemetry-repo-list-by-session: %w", err)
	}
	defer rows.Close()
	var out []models.ChargingTelemetry
	for rows.Next() {
		var t models.ChargingTelemetry
		if err := rows.Scan(
			&t.VehicleID, &t.Ts, &t.SessionID, &t.BatteryLevel, &t.BatteryRangeMi,
			&t.ChargingState, &t.ChargerVoltage, &t.ChargerActualCurrent,
			&t.ChargerPowerKw, &t.ChargerPhases, &t.ChargeEnergyAddedKwh,
			&t.ChargeMilesAdded, &t.ChargeRateMph, &t.ChargerPilotCurrent,
			&t.ScheduledChargingAt, &t.Source,
		); err != nil {
			return nil, fmt.Errorf("charging-telemetry-repo-list-by-session: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("charging-telemetry-repo-list-by-session: %w", err)
	}
	return out, nil
}
