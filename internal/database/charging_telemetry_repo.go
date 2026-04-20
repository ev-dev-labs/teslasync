package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type ChargingTelemetryRepo struct {
	db *DB
}

func NewChargingTelemetryRepo(db *DB) *ChargingTelemetryRepo {
	return &ChargingTelemetryRepo{db: db}
}

func (r *ChargingTelemetryRepo) Insert(ctx context.Context, snap *models.ChargingTelemetry) error {
	query := `INSERT INTO charging_telemetry (vehicle_id, battery_level, soc, charge_state, detailed_charge_state, charge_limit_soc, charge_amps, charge_current_request, charge_current_request_max, charge_enable_request, charger_voltage, charger_phases, charge_rate_mph, dc_charging_power, dc_charging_energy_in, ac_charging_power, ac_charging_energy_in, energy_remaining, est_battery_range, ideal_battery_range, rated_range, pack_voltage, pack_current, charge_port_door_open, charge_port_latch, charge_port_cold_weather_mode, charging_cable_type, fast_charger_present, fast_charger_type, time_to_full_charge, estimated_hours_to_charge, scheduled_charging_mode, scheduled_charging_pending, preconditioning_enabled, brick_voltage_max, brick_voltage_min, num_brick_voltage_max, num_brick_voltage_min, module_temp_max, module_temp_min, num_module_temp_max, num_module_temp_min, battery_heater_on, not_enough_power_to_heat, bms_state, bms_fullcharge_complete, dcdc_enable, isolation_resistance, lifetime_energy_used, supercharger_session_trip_planner, powershare_status, powershare_type, powershare_stop_reason, powershare_hours_left, powershare_power_kw, scheduled_charging_start_time, scheduled_departure_time, expected_energy_pct_at_arrival)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48, $49, $50, $51, $52, $53, $54, $55, $56, $57, $58) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.BatteryLevel, snap.Soc, snap.ChargeState, snap.DetailedChargeState,
		snap.ChargeLimitSoc, snap.ChargeAmps, snap.ChargeCurrentRequest, snap.ChargeCurrentRequestMax,
		snap.ChargeEnableRequest, snap.ChargerVoltage, snap.ChargerPhases, snap.ChargeRateMph,
		snap.DCChargingPower, snap.DCChargingEnergyIn, snap.ACChargingPower, snap.ACChargingEnergyIn,
		snap.EnergyRemaining, snap.EstBatteryRange, snap.IdealBatteryRange, snap.RatedRange,
		snap.PackVoltage, snap.PackCurrent, snap.ChargePortDoorOpen, snap.ChargePortLatch,
		snap.ChargePortColdWeatherMode, snap.ChargingCableType, snap.FastChargerPresent, snap.FastChargerType,
		snap.TimeToFullCharge, snap.EstimatedHoursToCharge, snap.ScheduledChargingMode, snap.ScheduledChargingPending,
		snap.PreconditioningEnabled, snap.BrickVoltageMax, snap.BrickVoltageMin,
		snap.NumBrickVoltageMax, snap.NumBrickVoltageMin,
		snap.ModuleTempMax, snap.ModuleTempMin, snap.NumModuleTempMax, snap.NumModuleTempMin,
		snap.BatteryHeaterOn, snap.NotEnoughPowerToHeat, snap.BmsState, snap.BmsFullchargeComplete,
		snap.DcdcEnable, snap.IsolationResistance, snap.LifetimeEnergyUsed,
		snap.SuperchargerSessionTripPlanner,
		snap.PowershareStatus, snap.PowershareType, snap.PowershareStopReason,
		snap.PowershareHoursLeft, snap.PowersharePowerKw,
		snap.ScheduledChargingStartTime, snap.ScheduledDepartureTime, snap.ExpectedEnergyPctAtArrival,
	).Scan(&snap.ID)
}

func (r *ChargingTelemetryRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.ChargingTelemetry, error) {
	query := `SELECT id, vehicle_id, battery_level, soc, charge_state, detailed_charge_state, charge_limit_soc, charge_amps, charge_current_request, charge_current_request_max, charge_enable_request, charger_voltage, charger_phases, charge_rate_mph, dc_charging_power, dc_charging_energy_in, ac_charging_power, ac_charging_energy_in, energy_remaining, est_battery_range, ideal_battery_range, rated_range, pack_voltage, pack_current, charge_port_door_open, charge_port_latch, charge_port_cold_weather_mode, charging_cable_type, fast_charger_present, fast_charger_type, time_to_full_charge, estimated_hours_to_charge, scheduled_charging_mode, scheduled_charging_pending, preconditioning_enabled, brick_voltage_max, brick_voltage_min, num_brick_voltage_max, num_brick_voltage_min, module_temp_max, module_temp_min, num_module_temp_max, num_module_temp_min, battery_heater_on, not_enough_power_to_heat, bms_state, bms_fullcharge_complete, dcdc_enable, isolation_resistance, lifetime_energy_used, supercharger_session_trip_planner, powershare_status, powershare_type, powershare_stop_reason, powershare_hours_left, powershare_power_kw, scheduled_charging_start_time, scheduled_departure_time, expected_energy_pct_at_arrival, created_at
		FROM charging_telemetry WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.ChargingTelemetry
	for rows.Next() {
		s := &models.ChargingTelemetry{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.BatteryLevel, &s.Soc, &s.ChargeState, &s.DetailedChargeState,
			&s.ChargeLimitSoc, &s.ChargeAmps, &s.ChargeCurrentRequest, &s.ChargeCurrentRequestMax,
			&s.ChargeEnableRequest, &s.ChargerVoltage, &s.ChargerPhases, &s.ChargeRateMph,
			&s.DCChargingPower, &s.DCChargingEnergyIn, &s.ACChargingPower, &s.ACChargingEnergyIn,
			&s.EnergyRemaining, &s.EstBatteryRange, &s.IdealBatteryRange, &s.RatedRange,
			&s.PackVoltage, &s.PackCurrent, &s.ChargePortDoorOpen, &s.ChargePortLatch,
			&s.ChargePortColdWeatherMode, &s.ChargingCableType, &s.FastChargerPresent, &s.FastChargerType,
			&s.TimeToFullCharge, &s.EstimatedHoursToCharge, &s.ScheduledChargingMode, &s.ScheduledChargingPending,
			&s.PreconditioningEnabled, &s.BrickVoltageMax, &s.BrickVoltageMin,
			&s.NumBrickVoltageMax, &s.NumBrickVoltageMin,
			&s.ModuleTempMax, &s.ModuleTempMin, &s.NumModuleTempMax, &s.NumModuleTempMin,
			&s.BatteryHeaterOn, &s.NotEnoughPowerToHeat, &s.BmsState, &s.BmsFullchargeComplete,
			&s.DcdcEnable, &s.IsolationResistance, &s.LifetimeEnergyUsed,
			&s.SuperchargerSessionTripPlanner,
			&s.PowershareStatus, &s.PowershareType, &s.PowershareStopReason,
			&s.PowershareHoursLeft, &s.PowersharePowerKw,
			&s.ScheduledChargingStartTime, &s.ScheduledDepartureTime, &s.ExpectedEnergyPctAtArrival,
			&s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *ChargingTelemetryRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.ChargingTelemetry, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}

// GetLatestMerged returns a composite of the most recent charging telemetry
// by merging the last N records. The vehicle sends different signals in
// different batches, so the latest single record may be sparse. This fills
// in nil fields from older records within the lookback window.
func (r *ChargingTelemetryRepo) GetLatestMerged(ctx context.Context, vehicleID int64, lookback int) (*models.ChargingTelemetry, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, lookback)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	merged := *snaps[0] // start with the newest
	for _, s := range snaps[1:] {
		if merged.BatteryLevel == nil && s.BatteryLevel != nil { merged.BatteryLevel = s.BatteryLevel }
		if merged.Soc == nil && s.Soc != nil { merged.Soc = s.Soc }
		if merged.ChargeState == nil && s.ChargeState != nil { merged.ChargeState = s.ChargeState }
		if merged.ChargeAmps == nil && s.ChargeAmps != nil { merged.ChargeAmps = s.ChargeAmps }
		if merged.ChargerVoltage == nil && s.ChargerVoltage != nil { merged.ChargerVoltage = s.ChargerVoltage }
		if merged.ChargeRateMph == nil && s.ChargeRateMph != nil { merged.ChargeRateMph = s.ChargeRateMph }
		if merged.DCChargingPower == nil && s.DCChargingPower != nil { merged.DCChargingPower = s.DCChargingPower }
		if merged.ACChargingPower == nil && s.ACChargingPower != nil { merged.ACChargingPower = s.ACChargingPower }
		if merged.EstBatteryRange == nil && s.EstBatteryRange != nil { merged.EstBatteryRange = s.EstBatteryRange }
		if merged.IdealBatteryRange == nil && s.IdealBatteryRange != nil { merged.IdealBatteryRange = s.IdealBatteryRange }
		if merged.RatedRange == nil && s.RatedRange != nil { merged.RatedRange = s.RatedRange }
		if merged.TimeToFullCharge == nil && s.TimeToFullCharge != nil { merged.TimeToFullCharge = s.TimeToFullCharge }
		if merged.PackVoltage == nil && s.PackVoltage != nil { merged.PackVoltage = s.PackVoltage }
		if merged.PackCurrent == nil && s.PackCurrent != nil { merged.PackCurrent = s.PackCurrent }
		if merged.ChargeLimitSoc == nil && s.ChargeLimitSoc != nil { merged.ChargeLimitSoc = s.ChargeLimitSoc }
	}
	return &merged, nil
}
