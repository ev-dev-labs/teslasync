package database

import (
	"context"
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
