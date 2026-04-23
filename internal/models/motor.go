package models

import "time"

// MotorSnapshot mirrors the post-migration `motor_snapshots` schema
// introduced in migrations/000142_baseline_typed.up.sql.
//
// Hot hypertable storing high-frequency drivetrain telemetry from
// Fleet Telemetry. 90-day retention; only fed to perf analytics.
// Nullable columns are pointer types; db/json tags match column names
// exactly. Schema is fully typed per ADR-005 (no JSONB carve-out).
type MotorSnapshot struct {
	VehicleID       int64     `db:"vehicle_id" json:"vehicle_id"`
	Ts              time.Time `db:"ts" json:"ts"`
	PowerKw         *float64  `db:"power_kw" json:"power_kw"`
	MotorRpmFront   *int32    `db:"motor_rpm_front" json:"motor_rpm_front"`
	MotorRpmRear    *int32    `db:"motor_rpm_rear" json:"motor_rpm_rear"`
	TorqueNmFront   *float64  `db:"torque_nm_front" json:"torque_nm_front"`
	TorqueNmRear    *float64  `db:"torque_nm_rear" json:"torque_nm_rear"`
	MotorTempCFront *float64  `db:"motor_temp_c_front" json:"motor_temp_c_front"`
	MotorTempCRear  *float64  `db:"motor_temp_c_rear" json:"motor_temp_c_rear"`
	InverterTempC   *float64  `db:"inverter_temp_c" json:"inverter_temp_c"`
	BatteryTempC    *float64  `db:"battery_temp_c" json:"battery_temp_c"`
	RegenKw         *float64  `db:"regen_kw" json:"regen_kw"`
	ShiftState      *string   `db:"shift_state" json:"shift_state"`
	Source          string    `db:"source" json:"source"`
}
