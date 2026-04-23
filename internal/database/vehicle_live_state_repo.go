package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/jackc/pgx/v5"
)

// VehicleLiveStateRepo serves the single hot-path row of `vehicle_live_state`
// for a given vehicle.
//
// ADR-002: this row is the single source of truth for current vehicle state.
// It is write-through from the in-memory SignalStore (flushed on every
// telemetry batch) and backs /vehicles/{id}/state and Grafana "now" panels.
// Never query snapshot tables for current values.
type VehicleLiveStateRepo struct {
	db *DB
}

func NewVehicleLiveStateRepo(db *DB) *VehicleLiveStateRepo {
	return &VehicleLiveStateRepo{db: db}
}

// Get returns the live-state row for the given vehicle, or (nil, nil) when no
// row exists.
func (r *VehicleLiveStateRepo) Get(ctx context.Context, vehicleID int64) (*models.VehicleLiveState, error) {
	const query = `
		SELECT
			vehicle_id,
			battery_level, battery_range_mi, charging_state, charge_limit_soc,
			charger_voltage, charger_actual_current, charger_power_kw, battery_last_updated_at,
			latitude, longitude, heading, speed_mph, elevation_m, gps_state, position_last_updated_at,
			inside_temp_c, outside_temp_c, hvac_state, is_climate_on, defrost_mode, climate_last_updated_at,
			shift_state, drive_state, power_kw, motor_rpm, drive_last_updated_at,
			locked, sentry_mode, user_present, doors_open, windows_open, security_last_updated_at,
			software_version,
			created_at, updated_at
		FROM vehicle_live_state
		WHERE vehicle_id = $1`

	var s models.VehicleLiveState
	err := r.db.Pool.QueryRow(ctx, query, vehicleID).Scan(
		&s.VehicleID,
		&s.BatteryLevel, &s.BatteryRangeMi, &s.ChargingState, &s.ChargeLimitSOC,
		&s.ChargerVoltage, &s.ChargerActualCurrent, &s.ChargerPowerKW, &s.BatteryLastUpdatedAt,
		&s.Latitude, &s.Longitude, &s.Heading, &s.SpeedMph, &s.ElevationM, &s.GPSState, &s.PositionLastUpdatedAt,
		&s.InsideTempC, &s.OutsideTempC, &s.HVACState, &s.IsClimateOn, &s.DefrostMode, &s.ClimateLastUpdatedAt,
		&s.ShiftState, &s.DriveState, &s.PowerKW, &s.MotorRPM, &s.DriveLastUpdatedAt,
		&s.Locked, &s.SentryMode, &s.UserPresent, &s.DoorsOpen, &s.WindowsOpen, &s.SecurityLastUpdatedAt,
		&s.SoftwareVersion,
		&s.CreatedAt, &s.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("vehicle-live-state-repo-get: %w", err)
	}
	return &s, nil
}

// Upsert performs a write-through upsert into vehicle_live_state.
//
// ADR-002: this is the only write path for current vehicle state. Per-domain
// `*_last_updated_at` timestamps are advanced with GREATEST so a late-arriving
// batch can never regress them. Value columns use COALESCE(EXCLUDED, existing)
// so a partial telemetry batch (e.g. climate-only) does not blank out fields
// owned by other domains.
func (r *VehicleLiveStateRepo) Upsert(ctx context.Context, s models.VehicleLiveState) error {
	const query = `
		INSERT INTO vehicle_live_state (
			vehicle_id,
			battery_level, battery_range_mi, charging_state, charge_limit_soc,
			charger_voltage, charger_actual_current, charger_power_kw, battery_last_updated_at,
			latitude, longitude, heading, speed_mph, elevation_m, gps_state, position_last_updated_at,
			inside_temp_c, outside_temp_c, hvac_state, is_climate_on, defrost_mode, climate_last_updated_at,
			shift_state, drive_state, power_kw, motor_rpm, drive_last_updated_at,
			locked, sentry_mode, user_present, doors_open, windows_open, security_last_updated_at,
			software_version
		) VALUES (
			$1,
			$2, $3, $4, $5,
			$6, $7, $8, $9,
			$10, $11, $12, $13, $14, $15, $16,
			$17, $18, $19, $20, $21, $22,
			$23, $24, $25, $26, $27,
			$28, $29, $30, $31, $32, $33,
			$34
		)
		ON CONFLICT (vehicle_id) DO UPDATE SET
			battery_level           = COALESCE(EXCLUDED.battery_level,           vehicle_live_state.battery_level),
			battery_range_mi        = COALESCE(EXCLUDED.battery_range_mi,        vehicle_live_state.battery_range_mi),
			charging_state          = COALESCE(EXCLUDED.charging_state,          vehicle_live_state.charging_state),
			charge_limit_soc        = COALESCE(EXCLUDED.charge_limit_soc,        vehicle_live_state.charge_limit_soc),
			charger_voltage         = COALESCE(EXCLUDED.charger_voltage,         vehicle_live_state.charger_voltage),
			charger_actual_current  = COALESCE(EXCLUDED.charger_actual_current,  vehicle_live_state.charger_actual_current),
			charger_power_kw        = COALESCE(EXCLUDED.charger_power_kw,        vehicle_live_state.charger_power_kw),
			battery_last_updated_at = GREATEST(vehicle_live_state.battery_last_updated_at, EXCLUDED.battery_last_updated_at),

			latitude                 = COALESCE(EXCLUDED.latitude,                 vehicle_live_state.latitude),
			longitude                = COALESCE(EXCLUDED.longitude,                vehicle_live_state.longitude),
			heading                  = COALESCE(EXCLUDED.heading,                  vehicle_live_state.heading),
			speed_mph                = COALESCE(EXCLUDED.speed_mph,                vehicle_live_state.speed_mph),
			elevation_m              = COALESCE(EXCLUDED.elevation_m,              vehicle_live_state.elevation_m),
			gps_state                = COALESCE(EXCLUDED.gps_state,                vehicle_live_state.gps_state),
			position_last_updated_at = GREATEST(vehicle_live_state.position_last_updated_at, EXCLUDED.position_last_updated_at),

			inside_temp_c           = COALESCE(EXCLUDED.inside_temp_c,           vehicle_live_state.inside_temp_c),
			outside_temp_c          = COALESCE(EXCLUDED.outside_temp_c,          vehicle_live_state.outside_temp_c),
			hvac_state              = COALESCE(EXCLUDED.hvac_state,              vehicle_live_state.hvac_state),
			is_climate_on           = COALESCE(EXCLUDED.is_climate_on,           vehicle_live_state.is_climate_on),
			defrost_mode            = COALESCE(EXCLUDED.defrost_mode,            vehicle_live_state.defrost_mode),
			climate_last_updated_at = GREATEST(vehicle_live_state.climate_last_updated_at, EXCLUDED.climate_last_updated_at),

			shift_state           = COALESCE(EXCLUDED.shift_state,           vehicle_live_state.shift_state),
			drive_state           = COALESCE(EXCLUDED.drive_state,           vehicle_live_state.drive_state),
			power_kw              = COALESCE(EXCLUDED.power_kw,              vehicle_live_state.power_kw),
			motor_rpm             = COALESCE(EXCLUDED.motor_rpm,             vehicle_live_state.motor_rpm),
			drive_last_updated_at = GREATEST(vehicle_live_state.drive_last_updated_at, EXCLUDED.drive_last_updated_at),

			locked                   = COALESCE(EXCLUDED.locked,                   vehicle_live_state.locked),
			sentry_mode              = COALESCE(EXCLUDED.sentry_mode,              vehicle_live_state.sentry_mode),
			user_present             = COALESCE(EXCLUDED.user_present,             vehicle_live_state.user_present),
			doors_open               = COALESCE(EXCLUDED.doors_open,               vehicle_live_state.doors_open),
			windows_open             = COALESCE(EXCLUDED.windows_open,             vehicle_live_state.windows_open),
			security_last_updated_at = GREATEST(vehicle_live_state.security_last_updated_at, EXCLUDED.security_last_updated_at),

			software_version = COALESCE(EXCLUDED.software_version, vehicle_live_state.software_version),

			updated_at = now()`

	_, err := r.db.Pool.Exec(ctx, query,
		s.VehicleID,
		s.BatteryLevel, s.BatteryRangeMi, s.ChargingState, s.ChargeLimitSOC,
		s.ChargerVoltage, s.ChargerActualCurrent, s.ChargerPowerKW, s.BatteryLastUpdatedAt,
		s.Latitude, s.Longitude, s.Heading, s.SpeedMph, s.ElevationM, s.GPSState, s.PositionLastUpdatedAt,
		s.InsideTempC, s.OutsideTempC, s.HVACState, s.IsClimateOn, s.DefrostMode, s.ClimateLastUpdatedAt,
		s.ShiftState, s.DriveState, s.PowerKW, s.MotorRPM, s.DriveLastUpdatedAt,
		s.Locked, s.SentryMode, s.UserPresent, s.DoorsOpen, s.WindowsOpen, s.SecurityLastUpdatedAt,
		s.SoftwareVersion,
	)
	if err != nil {
		return fmt.Errorf("vehicle-live-state-repo-upsert: %w", err)
	}
	return nil
}
