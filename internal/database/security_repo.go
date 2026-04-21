package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type SecurityRepo struct {
	db *DB
}

func NewSecurityRepo(db *DB) *SecurityRepo {
	return &SecurityRepo{db: db}
}

func (r *SecurityRepo) Insert(ctx context.Context, ev *models.SecurityEvent) error {
	if ev.Signals == nil {
		ev.Signals = models.SignalsMap{}
	}
	query := `INSERT INTO security_events (vehicle_id, locked, sentry_mode, door_state, fd_window, fp_window, rd_window, rp_window, homelink_nearby, guest_mode, homelink_device_count, guest_mode_mobile_access_state, driver_seat_occupied, center_display, speed_limit_mode, valet_mode_enabled, service_mode, current_limit_mph, paired_phone_key_count, lights_hazards_active, lights_high_beams, lights_turn_signal, tonneau_position, tonneau_open_percent, tonneau_tent_mode, driver_seat_belt, passenger_seat_belt, signals)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		ev.VehicleID, ev.Locked, ev.SentryMode, ev.DoorState,
		ev.FdWindow, ev.FpWindow, ev.RdWindow, ev.RpWindow,
		ev.HomelinkNearby, ev.GuestMode,
		ev.HomelinkDeviceCount, ev.GuestModeMobileAccessState,
		ev.DriverSeatOccupied, ev.CenterDisplay,
		ev.SpeedLimitMode, ev.ValetModeEnabled, ev.ServiceMode,
		ev.CurrentLimitMph, ev.PairedPhoneKeyCount,
		ev.LightsHazardsActive, ev.LightsHighBeams, ev.LightsTurnSignal,
		ev.TonneauPosition, ev.TonneauOpenPercent, ev.TonneauTentMode,
		ev.DriverSeatBelt, ev.PassengerSeatBelt,
		ev.Signals,
	).Scan(&ev.ID)
}

func (r *SecurityRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.SecurityEvent, error) {
	query := `SELECT id, vehicle_id, locked, sentry_mode, door_state, fd_window, fp_window, rd_window, rp_window, homelink_nearby, guest_mode, homelink_device_count, guest_mode_mobile_access_state, driver_seat_occupied, center_display, speed_limit_mode, valet_mode_enabled, service_mode, current_limit_mph, paired_phone_key_count, lights_hazards_active, lights_high_beams, lights_turn_signal, tonneau_position, tonneau_open_percent, tonneau_tent_mode, driver_seat_belt, passenger_seat_belt, signals, created_at
		FROM security_events WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var evts []*models.SecurityEvent
	for rows.Next() {
		e := &models.SecurityEvent{}
		if err := rows.Scan(&e.ID, &e.VehicleID, &e.Locked, &e.SentryMode, &e.DoorState,
			&e.FdWindow, &e.FpWindow, &e.RdWindow, &e.RpWindow,
			&e.HomelinkNearby, &e.GuestMode,
			&e.HomelinkDeviceCount, &e.GuestModeMobileAccessState,
			&e.DriverSeatOccupied, &e.CenterDisplay,
			&e.SpeedLimitMode, &e.ValetModeEnabled, &e.ServiceMode,
			&e.CurrentLimitMph, &e.PairedPhoneKeyCount,
			&e.LightsHazardsActive, &e.LightsHighBeams, &e.LightsTurnSignal,
			&e.TonneauPosition, &e.TonneauOpenPercent, &e.TonneauTentMode,
			&e.DriverSeatBelt, &e.PassengerSeatBelt,
			&e.Signals,
			&e.CreatedAt); err != nil {
			return nil, err
		}
		evts = append(evts, e)
	}
	return evts, rows.Err()
}

func (r *SecurityRepo) GetLatest(ctx context.Context, vehicleID int64) (*models.SecurityEvent, error) {
	evts, err := r.GetByVehicle(ctx, vehicleID, 1)
	if err != nil || len(evts) == 0 {
		return nil, err
	}
	return evts[0], nil
}
