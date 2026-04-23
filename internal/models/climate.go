package models

import "time"

// ClimateSnapshot mirrors the post-migration `climate_snapshots` schema
// introduced in migrations/000142_baseline_typed.up.sql.
//
// Hot hypertable storing HVAC + temperature history at 0.1-1 Hz from
// Fleet Telemetry. Nullable columns are pointer types; db/json tags
// match column names exactly. Schema is fully typed per ADR-005.
type ClimateSnapshot struct {
	VehicleID               int64     `db:"vehicle_id" json:"vehicle_id"`
	Ts                      time.Time `db:"ts" json:"ts"`
	InsideTempC             *float64  `db:"inside_temp_c" json:"inside_temp_c"`
	OutsideTempC            *float64  `db:"outside_temp_c" json:"outside_temp_c"`
	DriverSetpointC         *float64  `db:"driver_setpoint_c" json:"driver_setpoint_c"`
	PassengerSetpointC      *float64  `db:"passenger_setpoint_c" json:"passenger_setpoint_c"`
	HvacState               *string   `db:"hvac_state" json:"hvac_state"`
	DefrostMode             *string   `db:"defrost_mode" json:"defrost_mode"`
	IsClimateOn             *bool     `db:"is_climate_on" json:"is_climate_on"`
	IsPreconditioning       *bool     `db:"is_preconditioning" json:"is_preconditioning"`
	FanStatus               *int16    `db:"fan_status" json:"fan_status"`
	SeatHeaterLeft          *int16    `db:"seat_heater_left" json:"seat_heater_left"`
	SeatHeaterRight         *int16    `db:"seat_heater_right" json:"seat_heater_right"`
	SeatHeaterRearLeft      *int16    `db:"seat_heater_rear_left" json:"seat_heater_rear_left"`
	SeatHeaterRearRight     *int16    `db:"seat_heater_rear_right" json:"seat_heater_rear_right"`
	SteeringWheelHeater     *bool     `db:"steering_wheel_heater" json:"steering_wheel_heater"`
	CabinOverheatProtection *bool     `db:"cabin_overheat_protection" json:"cabin_overheat_protection"`
	Source                  string    `db:"source" json:"source"`
}
