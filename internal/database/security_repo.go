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
	query := `INSERT INTO security_events (vehicle_id, locked, sentry_mode, door_state, fd_window, fp_window, rd_window, rp_window, homelink_nearby, guest_mode)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		ev.VehicleID, ev.Locked, ev.SentryMode, ev.DoorState,
		ev.FdWindow, ev.FpWindow, ev.RdWindow, ev.RpWindow,
		ev.HomelinkNearby, ev.GuestMode,
	).Scan(&ev.ID)
}

func (r *SecurityRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.SecurityEvent, error) {
	query := `SELECT id, vehicle_id, locked, sentry_mode, door_state, fd_window, fp_window, rd_window, rp_window, homelink_nearby, guest_mode, created_at
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
			&e.HomelinkNearby, &e.GuestMode, &e.CreatedAt); err != nil {
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
