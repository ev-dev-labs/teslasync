package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type ClimateRepo struct {
	db *DB
}

func NewClimateRepo(db *DB) *ClimateRepo {
	return &ClimateRepo{db: db}
}

func (r *ClimateRepo) Insert(ctx context.Context, snap *models.ClimateSnapshot) error {
	query := `INSERT INTO climate_snapshots (vehicle_id, inside_temp, outside_temp, hvac_power, hvac_fan_speed, hvac_left_temp_request, hvac_right_temp_request, cabin_overheat_mode, defrost_mode, battery_heater_on, hvac_ac_enabled, hvac_auto_mode, hvac_fan_status, hvac_steering_wheel_heat_auto, hvac_steering_wheel_heat_level, climate_keeper_mode, cabin_overheat_protection_temp_limit, defrost_for_preconditioning, seat_heater_left, seat_heater_right, seat_heater_rear_left, seat_heater_rear_center, seat_heater_rear_right, seat_vent_enabled, climate_seat_cooling_front_left, climate_seat_cooling_front_right, auto_seat_climate_left, auto_seat_climate_right, rear_defrost_enabled, rear_display_hvac_enabled, wiper_heat_enabled)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.InsideTemp, snap.OutsideTemp, snap.HvacPower, snap.HvacFanSpeed,
		snap.HvacLeftTempRequest, snap.HvacRightTempRequest, snap.CabinOverheatMode,
		snap.DefrostMode, snap.BatteryHeaterOn,
		snap.HvacACEnabled, snap.HvacAutoMode, snap.HvacFanStatus,
		snap.HvacSteeringWheelHeatAuto, snap.HvacSteeringWheelHeatLevel,
		snap.ClimateKeeperMode, snap.CabinOverheatProtectionTempLimit,
		snap.DefrostForPreconditioning,
		snap.SeatHeaterLeft, snap.SeatHeaterRight,
		snap.SeatHeaterRearLeft, snap.SeatHeaterRearCenter, snap.SeatHeaterRearRight,
		snap.SeatVentEnabled, snap.ClimateSeatCoolingFrontLeft, snap.ClimateSeatCoolingFrontRight,
		snap.AutoSeatClimateLeft, snap.AutoSeatClimateRight,
		snap.RearDefrostEnabled, snap.RearDisplayHvacEnabled, snap.WiperHeatEnabled,
	).Scan(&snap.ID)
}

func (r *ClimateRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.ClimateSnapshot, error) {
	query := `SELECT id, vehicle_id, inside_temp, outside_temp, hvac_power, hvac_fan_speed, hvac_left_temp_request, hvac_right_temp_request, cabin_overheat_mode, defrost_mode, battery_heater_on, hvac_ac_enabled, hvac_auto_mode, hvac_fan_status, hvac_steering_wheel_heat_auto, hvac_steering_wheel_heat_level, climate_keeper_mode, cabin_overheat_protection_temp_limit, defrost_for_preconditioning, seat_heater_left, seat_heater_right, seat_heater_rear_left, seat_heater_rear_center, seat_heater_rear_right, seat_vent_enabled, climate_seat_cooling_front_left, climate_seat_cooling_front_right, auto_seat_climate_left, auto_seat_climate_right, rear_defrost_enabled, rear_display_hvac_enabled, wiper_heat_enabled, created_at
		FROM climate_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.ClimateSnapshot
	for rows.Next() {
		s := &models.ClimateSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.InsideTemp, &s.OutsideTemp, &s.HvacPower, &s.HvacFanSpeed,
			&s.HvacLeftTempRequest, &s.HvacRightTempRequest, &s.CabinOverheatMode,
			&s.DefrostMode, &s.BatteryHeaterOn,
			&s.HvacACEnabled, &s.HvacAutoMode, &s.HvacFanStatus,
			&s.HvacSteeringWheelHeatAuto, &s.HvacSteeringWheelHeatLevel,
			&s.ClimateKeeperMode, &s.CabinOverheatProtectionTempLimit,
			&s.DefrostForPreconditioning,
			&s.SeatHeaterLeft, &s.SeatHeaterRight,
			&s.SeatHeaterRearLeft, &s.SeatHeaterRearCenter, &s.SeatHeaterRearRight,
			&s.SeatVentEnabled, &s.ClimateSeatCoolingFrontLeft, &s.ClimateSeatCoolingFrontRight,
			&s.AutoSeatClimateLeft, &s.AutoSeatClimateRight,
			&s.RearDefrostEnabled, &s.RearDisplayHvacEnabled, &s.WiperHeatEnabled,
			&s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *ClimateRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.ClimateSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
