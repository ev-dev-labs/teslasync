package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type VehicleConfigRepo struct {
	db *DB
}

func NewVehicleConfigRepo(db *DB) *VehicleConfigRepo {
	return &VehicleConfigRepo{db: db}
}

func (r *VehicleConfigRepo) Insert(ctx context.Context, snap *models.VehicleConfigSnapshot) error {
	query := `INSERT INTO vehicle_config_snapshots (vehicle_id, car_type, trim, exterior_color, roof_color, wheel_type, rear_seat_heaters, sunroof_installed, efficiency_package, europe_vehicle, right_hand_drive, remote_start_enabled, charge_port, offroad_lightbar_present, version, vehicle_name, software_update_version, software_update_download_pct, software_update_install_pct, software_update_expected_duration, software_update_scheduled_start)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		snap.VehicleID, snap.CarType, snap.Trim, snap.ExteriorColor, snap.RoofColor,
		snap.WheelType, snap.RearSeatHeaters, snap.SunroofInstalled, snap.EfficiencyPackage,
		snap.EuropeVehicle, snap.RightHandDrive, snap.RemoteStartEnabled, snap.ChargePort,
		snap.OffroadLightbarPresent, snap.Version, snap.VehicleName,
		snap.SoftwareUpdateVersion, snap.SoftwareUpdateDownloadPct,
		snap.SoftwareUpdateInstallPct, snap.SoftwareUpdateExpectedDuration,
		snap.SoftwareUpdateScheduledStart,
	).Scan(&snap.ID)
}

func (r *VehicleConfigRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.VehicleConfigSnapshot, error) {
	query := `SELECT id, vehicle_id, car_type, trim, exterior_color, roof_color, wheel_type, rear_seat_heaters, sunroof_installed, efficiency_package, europe_vehicle, right_hand_drive, remote_start_enabled, charge_port, offroad_lightbar_present, version, vehicle_name, software_update_version, software_update_download_pct, software_update_install_pct, software_update_expected_duration, created_at
		FROM vehicle_config_snapshots WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var snaps []*models.VehicleConfigSnapshot
	for rows.Next() {
		s := &models.VehicleConfigSnapshot{}
		if err := rows.Scan(&s.ID, &s.VehicleID, &s.CarType, &s.Trim, &s.ExteriorColor, &s.RoofColor,
			&s.WheelType, &s.RearSeatHeaters, &s.SunroofInstalled, &s.EfficiencyPackage,
			&s.EuropeVehicle, &s.RightHandDrive, &s.RemoteStartEnabled, &s.ChargePort,
			&s.OffroadLightbarPresent, &s.Version, &s.VehicleName,
			&s.SoftwareUpdateVersion, &s.SoftwareUpdateDownloadPct,
			&s.SoftwareUpdateInstallPct, &s.SoftwareUpdateExpectedDuration,
			&s.CreatedAt); err != nil {
			return nil, err
		}
		snaps = append(snaps, s)
	}
	return snaps, rows.Err()
}

func (r *VehicleConfigRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.VehicleConfigSnapshot, error) {
	snaps, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(snaps) == 0 {
		return nil, err
	}
	return snaps[0], nil
}
