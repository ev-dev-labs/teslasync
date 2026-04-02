package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type MotorRepo struct {
	db *DB
}

func NewMotorRepo(db *DB) *MotorRepo {
	return &MotorRepo{db: db}
}

func (r *MotorRepo) Insert(ctx context.Context, snap *models.MotorSnapshot) error {
	query := `INSERT INTO motor_snapshots (vehicle_id, di_state, di_torque, di_axle_speed, di_stator_temp, pedal_position, brake_pedal, lateral_accel, longitudinal_accel, vehicle_speed, gear, di_torque_actual_f, di_torque_actual_r, di_torque_actual_rel, di_torque_actual_rer, di_axle_speed_f, di_axle_speed_rel, di_axle_speed_rer, di_state_f, di_state_rel, di_state_rer, di_stator_temp_f, di_stator_temp_rel, di_stator_temp_rer, di_heatsink_t_f, di_heatsink_t_r, di_heatsink_t_rel, di_heatsink_t_rer, di_inverter_t_f, di_inverter_t_r, di_inverter_t_rel, di_inverter_t_rer, di_motor_current_f, di_motor_current_r, di_motor_current_rel, di_motor_current_rer, di_v_bat_f, di_v_bat_r, di_v_bat_rel, di_v_bat_rer, di_slave_torque_cmd, hvil, brake_pedal_pos, cruise_set_speed, drive_rail, lifetime_energy_gained_regen, lifetime_energy_used_drive)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.DiState, snap.DiTorque, snap.DiAxleSpeed, snap.DiStatorTemp,
		snap.PedalPosition, snap.BrakePedal, snap.LateralAccel, snap.LongitudinalAccel,
		snap.VehicleSpeed, snap.Gear,
		snap.DiTorqueActualF, snap.DiTorqueActualR, snap.DiTorqueActualREL, snap.DiTorqueActualRER,
		snap.DiAxleSpeedF, snap.DiAxleSpeedREL, snap.DiAxleSpeedRER,
		snap.DiStateF, snap.DiStateREL, snap.DiStateRER,
		snap.DiStatorTempF, snap.DiStatorTempREL, snap.DiStatorTempRER,
		snap.DiHeatsinkTF, snap.DiHeatsinkTR, snap.DiHeatsinkTREL, snap.DiHeatsinkTRER,
		snap.DiInverterTF, snap.DiInverterTR, snap.DiInverterTREL, snap.DiInverterTRER,
		snap.DiMotorCurrentF, snap.DiMotorCurrentR, snap.DiMotorCurrentREL, snap.DiMotorCurrentRER,
		snap.DiVBatF, snap.DiVBatR, snap.DiVBatREL, snap.DiVBatRER,
		snap.DiSlaveTorqueCmd, snap.Hvil, snap.BrakePedalPos, snap.CruiseSetSpeed, snap.DriveRail,
		snap.LifetimeEnergyGainedRegen, snap.LifetimeEnergyUsedDrive,
	).Scan(&snap.ID)
}

func (r *MotorRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.MotorSnapshot, error) {
	query := `SELECT id, vehicle_id, di_state, di_torque, di_axle_speed, di_stator_temp, pedal_position, brake_pedal, lateral_accel, longitudinal_accel, vehicle_speed, gear, di_torque_actual_f, di_torque_actual_r, di_torque_actual_rel, di_torque_actual_rer, di_axle_speed_f, di_axle_speed_rel, di_axle_speed_rer, di_state_f, di_state_rel, di_state_rer, di_stator_temp_f, di_stator_temp_rel, di_stator_temp_rer, di_heatsink_t_f, di_heatsink_t_r, di_heatsink_t_rel, di_heatsink_t_rer, di_inverter_t_f, di_inverter_t_r, di_inverter_t_rel, di_inverter_t_rer, di_motor_current_f, di_motor_current_r, di_motor_current_rel, di_motor_current_rer, di_v_bat_f, di_v_bat_r, di_v_bat_rel, di_v_bat_rer, di_slave_torque_cmd, hvil, brake_pedal_pos, cruise_set_speed, drive_rail, created_at
		FROM motor_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.MotorSnapshot
	for rows.Next() {
		s := &models.MotorSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.DiState, &s.DiTorque, &s.DiAxleSpeed, &s.DiStatorTemp,
			&s.PedalPosition, &s.BrakePedal, &s.LateralAccel, &s.LongitudinalAccel,
			&s.VehicleSpeed, &s.Gear,
			&s.DiTorqueActualF, &s.DiTorqueActualR, &s.DiTorqueActualREL, &s.DiTorqueActualRER,
			&s.DiAxleSpeedF, &s.DiAxleSpeedREL, &s.DiAxleSpeedRER,
			&s.DiStateF, &s.DiStateREL, &s.DiStateRER,
			&s.DiStatorTempF, &s.DiStatorTempREL, &s.DiStatorTempRER,
			&s.DiHeatsinkTF, &s.DiHeatsinkTR, &s.DiHeatsinkTREL, &s.DiHeatsinkTRER,
			&s.DiInverterTF, &s.DiInverterTR, &s.DiInverterTREL, &s.DiInverterTRER,
			&s.DiMotorCurrentF, &s.DiMotorCurrentR, &s.DiMotorCurrentREL, &s.DiMotorCurrentRER,
			&s.DiVBatF, &s.DiVBatR, &s.DiVBatREL, &s.DiVBatRER,
			&s.DiSlaveTorqueCmd, &s.Hvil, &s.BrakePedalPos, &s.CruiseSetSpeed, &s.DriveRail,
			&s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *MotorRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.MotorSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
