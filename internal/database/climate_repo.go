package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// ClimateRepo provides typed access to the post-refactor
// `climate_snapshots` hypertable. ADR-001 (typed-by-default)
// eliminates the legacy `signals jsonb` column entirely; ADR-005
// keeps source units (Celsius, raw seat-heater levels) in the row
// and defers conversion to the API layer.
type ClimateRepo struct {
	db *DB
}

func NewClimateRepo(db *DB) *ClimateRepo {
	return &ClimateRepo{db: db}
}

// BulkInsert streams climate snapshots into the `climate_snapshots`
// hypertable using pgx.CopyFrom. This is the high-throughput write
// path used by Fleet Telemetry batch flushes; per-row Insert is
// intentionally not provided on the typed schema.
//
// Columns mirror models.ClimateSnapshot exactly — no JSONB, no
// raw_json, no eliminated fields.
func (r *ClimateRepo) BulkInsert(ctx context.Context, cs []models.ClimateSnapshot) error {
	if len(cs) == 0 {
		return nil
	}

	rows := pgx.CopyFromSlice(len(cs), func(i int) ([]any, error) {
		c := cs[i]
		return []any{
			c.VehicleID,
			c.Ts,
			c.InsideTempC,
			c.OutsideTempC,
			c.DriverSetpointC,
			c.PassengerSetpointC,
			c.HvacState,
			c.DefrostMode,
			c.IsClimateOn,
			c.IsPreconditioning,
			c.FanStatus,
			c.SeatHeaterLeft,
			c.SeatHeaterRight,
			c.SeatHeaterRearLeft,
			c.SeatHeaterRearRight,
			c.SteeringWheelHeater,
			c.CabinOverheatProtection,
			c.Source,
		}, nil
	})

	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"climate_snapshots"},
		[]string{
			"vehicle_id",
			"ts",
			"inside_temp_c",
			"outside_temp_c",
			"driver_setpoint_c",
			"passenger_setpoint_c",
			"hvac_state",
			"defrost_mode",
			"is_climate_on",
			"is_preconditioning",
			"fan_status",
			"seat_heater_left",
			"seat_heater_right",
			"seat_heater_rear_left",
			"seat_heater_rear_right",
			"steering_wheel_heater",
			"cabin_overheat_protection",
			"source",
		},
		rows,
	)
	if err != nil {
		return fmt.Errorf("climate-repo-bulk-insert: %w", err)
	}
	return nil
}

// ListByVehicle returns climate snapshots for a vehicle within the
// inclusive [from, to] time window, ordered by ts ascending. All
// columns from the typed schema are selected so callers receive the
// full ClimateSnapshot model — no JSONB, no eliminated fields.
func (r *ClimateRepo) ListByVehicle(ctx context.Context, vehicleID int64, from, to time.Time) ([]models.ClimateSnapshot, error) {
	const query = `
		SELECT
			vehicle_id,
			ts,
			inside_temp_c,
			outside_temp_c,
			driver_setpoint_c,
			passenger_setpoint_c,
			hvac_state,
			defrost_mode,
			is_climate_on,
			is_preconditioning,
			fan_status,
			seat_heater_left,
			seat_heater_right,
			seat_heater_rear_left,
			seat_heater_rear_right,
			steering_wheel_heater,
			cabin_overheat_protection,
			source
		FROM climate_snapshots
		WHERE vehicle_id = $1
		  AND ts BETWEEN $2 AND $3
		ORDER BY ts ASC
	`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID, from, to)
	if err != nil {
		return nil, fmt.Errorf("climate-repo-list-by-vehicle: %w", err)
	}
	defer rows.Close()

	out := make([]models.ClimateSnapshot, 0)
	for rows.Next() {
		var c models.ClimateSnapshot
		if err := rows.Scan(
			&c.VehicleID,
			&c.Ts,
			&c.InsideTempC,
			&c.OutsideTempC,
			&c.DriverSetpointC,
			&c.PassengerSetpointC,
			&c.HvacState,
			&c.DefrostMode,
			&c.IsClimateOn,
			&c.IsPreconditioning,
			&c.FanStatus,
			&c.SeatHeaterLeft,
			&c.SeatHeaterRight,
			&c.SeatHeaterRearLeft,
			&c.SeatHeaterRearRight,
			&c.SteeringWheelHeater,
			&c.CabinOverheatProtection,
			&c.Source,
		); err != nil {
			return nil, fmt.Errorf("climate-repo-list-by-vehicle-scan: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("climate-repo-list-by-vehicle-rows: %w", err)
	}
	return out, nil
}
