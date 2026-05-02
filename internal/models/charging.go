package models

import "time"

// ChargingSession mirrors the post-migration `charging_sessions` schema
// introduced in migrations/000142_baseline_typed.up.sql.
//
// One row per charging session. EndTs is NULL while a session is in progress.
// Nullable columns are pointer types; db/json tags match column names exactly.
type ChargingSession struct {
	ID                int64      `db:"id" json:"id"`
	VehicleID         int64      `db:"vehicle_id" json:"vehicle_id"`
	StartTs           time.Time  `db:"start_ts" json:"start_ts"`
	EndTs             *time.Time `db:"end_ts" json:"end_ts"`
	DurationMin       *float64   `db:"duration_min" json:"duration_min"`
	StartBatteryPct   *int16     `db:"start_battery_pct" json:"start_battery_pct"`
	EndBatteryPct     *int16     `db:"end_battery_pct" json:"end_battery_pct"`
	EnergyAddedKwh    *float64   `db:"energy_added_kwh" json:"energy_added_kwh"`
	MilesAdded        *float64   `db:"miles_added" json:"miles_added"`
	ChargerType       *string    `db:"charger_type" json:"charger_type"`
	ChargerLocation   *string    `db:"charger_location" json:"charger_location"`
	ChargerPowerKwMax *float64   `db:"charger_power_kw_max" json:"charger_power_kw_max"`
	ChargerPowerKwAvg *float64   `db:"charger_power_kw_avg" json:"charger_power_kw_avg"`
	Cost              *float64   `db:"cost" json:"cost"`
	CostCurrency      *string    `db:"cost_currency" json:"cost_currency"`
	MaxChargerVoltage *int16     `db:"max_charger_voltage" json:"max_charger_voltage,omitempty"`
	ChargerPhases     *int16     `db:"charger_phases" json:"charger_phases,omitempty"`
	CableType         *string    `db:"cable_type" json:"cable_type,omitempty"`
	EndedStatus       *string    `db:"ended_status" json:"ended_status"`
	CreatedAt         time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt         time.Time  `db:"updated_at" json:"updated_at"`
}

// IsActive reports whether the charging session is still in progress
// (i.e. EndTs has not been set yet).
func (c *ChargingSession) IsActive() bool { return c.EndTs == nil }

// ChargeTelemetryReading represents a single telemetry snapshot during a charging session.
type ChargeTelemetryReading struct {
	ID           int64     `json:"id" db:"id"`
	SessionID    int64     `json:"session_id" db:"session_id"`
	VehicleID    int64     `json:"vehicle_id" db:"vehicle_id"`
	BatteryLevel *int      `json:"battery_level,omitempty" db:"battery_level"`
	Soc          *float64  `json:"soc,omitempty" db:"soc"`
	PowerKW      *float64  `json:"power_kw,omitempty" db:"power_kw"`
	Voltage      *float64  `json:"voltage,omitempty" db:"voltage"`
	CurrentAmps  *float64  `json:"current_amps,omitempty" db:"current_amps"`
	Phases       *int      `json:"phases,omitempty" db:"phases"`
	EnergyAdded  *float64  `json:"energy_added,omitempty" db:"energy_added"`
	RatedRange   *float64  `json:"rated_range,omitempty" db:"rated_range"`
	IdealRange   *float64  `json:"ideal_range,omitempty" db:"ideal_range"`
	EstRange     *float64  `json:"est_range,omitempty" db:"est_range"`
	InsideTemp   *float64  `json:"inside_temp,omitempty" db:"inside_temp"`
	OutsideTemp  *float64  `json:"outside_temp,omitempty" db:"outside_temp"`
	BatteryTemp  *float64  `json:"battery_temp,omitempty" db:"battery_temp"`
	Latitude     *float64  `json:"latitude,omitempty" db:"latitude"`
	Longitude    *float64  `json:"longitude,omitempty" db:"longitude"`
	ChargeRate   *float64  `json:"charge_rate,omitempty" db:"charge_rate"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
}
