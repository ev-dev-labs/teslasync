package models

import "time"

// VehicleLiveState mirrors the post-migration `vehicle_live_state` table.
//
// ADR-002: single source of truth for the *current* state of a vehicle. One
// row per vehicle, write-through from the in-memory SignalStore on every
// telemetry batch (zero lag). Reads here back the /vehicles/{id}/state
// endpoint and every Grafana "now" panel — never query snapshot tables for
// current values.
//
// ADR-001: typed-by-default — no raw_json, no JSONB carve-outs. Every column
// in the schema is represented as a typed Go field (pointer for nullable).
//
// See migration 000142_baseline_typed and
// .github/prompts/db-refactor/phase-3-schema/02-create-vehicle-live-state.prompt.md.
type VehicleLiveState struct {
	VehicleID int64 `db:"vehicle_id" json:"vehicle_id"`

	// Battery / charge
	BatteryLevel         *int16     `db:"battery_level"           json:"battery_level,omitempty"`
	BatteryRangeMi       *float64   `db:"battery_range_mi"        json:"battery_range_mi,omitempty"`
	ChargingState        *string    `db:"charging_state"          json:"charging_state,omitempty"`
	ChargeLimitSOC       *int16     `db:"charge_limit_soc"        json:"charge_limit_soc,omitempty"`
	ChargerVoltage       *float64   `db:"charger_voltage"         json:"charger_voltage,omitempty"`
	ChargerActualCurrent *float64   `db:"charger_actual_current"  json:"charger_actual_current,omitempty"`
	ChargerPowerKW       *float64   `db:"charger_power_kw"        json:"charger_power_kw,omitempty"`
	BatteryLastUpdatedAt *time.Time `db:"battery_last_updated_at" json:"battery_last_updated_at,omitempty"`

	// Position
	Latitude              *float64   `db:"latitude"                 json:"latitude,omitempty"`
	Longitude             *float64   `db:"longitude"                json:"longitude,omitempty"`
	Heading               *int16     `db:"heading"                  json:"heading,omitempty"`
	SpeedMph              *float64   `db:"speed_mph"                json:"speed_mph,omitempty"`
	ElevationM            *float64   `db:"elevation_m"              json:"elevation_m,omitempty"`
	GPSState              *string    `db:"gps_state"                json:"gps_state,omitempty"`
	PositionLastUpdatedAt *time.Time `db:"position_last_updated_at" json:"position_last_updated_at,omitempty"`

	// Climate
	InsideTempC          *float64   `db:"inside_temp_c"          json:"inside_temp_c,omitempty"`
	OutsideTempC         *float64   `db:"outside_temp_c"         json:"outside_temp_c,omitempty"`
	HVACState            *string    `db:"hvac_state"             json:"hvac_state,omitempty"`
	IsClimateOn          *bool      `db:"is_climate_on"          json:"is_climate_on,omitempty"`
	DefrostMode          *string    `db:"defrost_mode"           json:"defrost_mode,omitempty"`
	ClimateLastUpdatedAt *time.Time `db:"climate_last_updated_at" json:"climate_last_updated_at,omitempty"`

	// Drive / motor
	ShiftState         *string    `db:"shift_state"           json:"shift_state,omitempty"`
	DriveState         *string    `db:"drive_state"           json:"drive_state,omitempty"`
	PowerKW            *float64   `db:"power_kw"              json:"power_kw,omitempty"`
	MotorRPM           *int32     `db:"motor_rpm"             json:"motor_rpm,omitempty"`
	DriveLastUpdatedAt *time.Time `db:"drive_last_updated_at" json:"drive_last_updated_at,omitempty"`

	// Security
	Locked                *bool      `db:"locked"                   json:"locked,omitempty"`
	SentryMode            *bool      `db:"sentry_mode"              json:"sentry_mode,omitempty"`
	UserPresent           *bool      `db:"user_present"             json:"user_present,omitempty"`
	DoorsOpen             *string    `db:"doors_open"               json:"doors_open,omitempty"`
	WindowsOpen           *string    `db:"windows_open"             json:"windows_open,omitempty"`
	SecurityLastUpdatedAt *time.Time `db:"security_last_updated_at" json:"security_last_updated_at,omitempty"`

	// Software / firmware
	SoftwareVersion *string `db:"software_version" json:"software_version,omitempty"`

	// Bookkeeping
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}
