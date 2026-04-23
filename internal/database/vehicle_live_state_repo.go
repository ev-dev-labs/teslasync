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
