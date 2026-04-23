package models

import "time"

// ChargingTelemetry mirrors the post-migration `charging_telemetry` schema
// introduced in migrations/000142_baseline_typed.up.sql.
//
// One row per 1 Hz sample while a vehicle is charging. The natural primary
// key is (vehicle_id, ts). Nullable columns are pointer types; db/json tags
// match column names exactly. No raw_json / JSONB carve-outs (ADR-005).
type ChargingTelemetry struct {
	VehicleID             int64      `db:"vehicle_id" json:"vehicle_id"`
	Ts                    time.Time  `db:"ts" json:"ts"`
	SessionID             *int64     `db:"session_id" json:"session_id"`
	BatteryLevel          *int16     `db:"battery_level" json:"battery_level"`
	BatteryRangeMi        *float64   `db:"battery_range_mi" json:"battery_range_mi"`
	ChargingState         *string    `db:"charging_state" json:"charging_state"`
	ChargerVoltage        *float64   `db:"charger_voltage" json:"charger_voltage"`
	ChargerActualCurrent  *float64   `db:"charger_actual_current" json:"charger_actual_current"`
	ChargerPowerKw        *float64   `db:"charger_power_kw" json:"charger_power_kw"`
	ChargerPhases         *int16     `db:"charger_phases" json:"charger_phases"`
	ChargeEnergyAddedKwh  *float64   `db:"charge_energy_added_kwh" json:"charge_energy_added_kwh"`
	ChargeMilesAdded      *float64   `db:"charge_miles_added" json:"charge_miles_added"`
	ChargeRateMph         *float64   `db:"charge_rate_mph" json:"charge_rate_mph"`
	ChargerPilotCurrent   *float64   `db:"charger_pilot_current" json:"charger_pilot_current"`
	ScheduledChargingAt   *time.Time `db:"scheduled_charging_at" json:"scheduled_charging_at"`
	Source                string     `db:"source" json:"source"`
}
