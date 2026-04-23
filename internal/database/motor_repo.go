package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// MotorRepo is the repository for motor_snapshots (post-baseline schema).
// See migrations/000142_baseline_typed.up.sql for the table definition.
type MotorRepo struct {
	db *DB
}

func NewMotorRepo(db *DB) *MotorRepo {
	return &MotorRepo{db: db}
}

// BulkInsert performs a high-throughput insert of motor snapshots using
// pgx.CopyFrom. All columns of the post-refactor motor_snapshots schema
// are written; nullable pointer fields are passed through directly so pgx
// encodes them as NULL when nil.
func (r *MotorRepo) BulkInsert(ctx context.Context, ms []models.MotorSnapshot) error {
	if len(ms) == 0 {
		return nil
	}
	rows := pgx.CopyFromSlice(len(ms), func(i int) ([]any, error) {
		m := ms[i]
		return []any{
			m.VehicleID,
			m.Ts,
			m.PowerKw,
			m.MotorRpmFront,
			m.MotorRpmRear,
			m.TorqueNmFront,
			m.TorqueNmRear,
			m.MotorTempCFront,
			m.MotorTempCRear,
			m.InverterTempC,
			m.BatteryTempC,
			m.RegenKw,
			m.ShiftState,
			m.Source,
		}, nil
	})
	_, err := r.db.Pool.CopyFrom(
		ctx,
		pgx.Identifier{"motor_snapshots"},
		[]string{
			"vehicle_id",
			"ts",
			"power_kw",
			"motor_rpm_front",
			"motor_rpm_rear",
			"torque_nm_front",
			"torque_nm_rear",
			"motor_temp_c_front",
			"motor_temp_c_rear",
			"inverter_temp_c",
			"battery_temp_c",
			"regen_kw",
			"shift_state",
			"source",
		},
		rows,
	)
	if err != nil {
		return fmt.Errorf("motor-repo-bulk-insert: %w", err)
	}
	return nil
}

// GetLatest returns the most recent motor snapshot for the given vehicle, or
// nil if no rows exist. All columns of the post-refactor motor_snapshots
// schema are selected.
func (r *MotorRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.MotorSnapshot, error) {
	var m models.MotorSnapshot
	err := r.db.Pool.QueryRow(ctx, `
		SELECT vehicle_id, ts, power_kw, motor_rpm_front, motor_rpm_rear,
		       torque_nm_front, torque_nm_rear, motor_temp_c_front, motor_temp_c_rear,
		       inverter_temp_c, battery_temp_c, regen_kw, shift_state, source
		FROM motor_snapshots
		WHERE vehicle_id = $1
		ORDER BY ts DESC
		LIMIT 1
	`, vehicleID).Scan(
		&m.VehicleID,
		&m.Ts,
		&m.PowerKw,
		&m.MotorRpmFront,
		&m.MotorRpmRear,
		&m.TorqueNmFront,
		&m.TorqueNmRear,
		&m.MotorTempCFront,
		&m.MotorTempCRear,
		&m.InverterTempC,
		&m.BatteryTempC,
		&m.RegenKw,
		&m.ShiftState,
		&m.Source,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("motor-repo-get-latest: %w", err)
	}
	return &m, nil
}
