package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// securityCoreCols are the access/security fields kept as dedicated SQL columns.
// Everything else lives in the signals JSONB column. See migrations 000142-000144.
var securityCoreCols = []string{
	"locked",
	"sentry_mode",
	"door_state",
	"driver_seat_occupied",
}

type SecurityRepo struct {
	db *DB
}

func NewSecurityRepo(db *DB) *SecurityRepo {
	return &SecurityRepo{db: db}
}

func (r *SecurityRepo) Insert(ctx context.Context, ev *models.SecurityEvent) error {
	signalsJSON, err := marshalSignals(ev, securityCoreCols...)
	if err != nil {
		return err
	}
	query := `INSERT INTO security_events
		(vehicle_id, locked, sentry_mode, door_state, driver_seat_occupied, signals)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		ev.VehicleID, ev.Locked, ev.SentryMode, ev.DoorState, ev.DriverSeatOccupied,
		signalsJSON,
	).Scan(&ev.ID)
}

func (r *SecurityRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.SecurityEvent, error) {
	query := `SELECT id, vehicle_id, locked, sentry_mode, door_state, driver_seat_occupied,
			signals, created_at
		FROM security_events WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var evts []*models.SecurityEvent
	for rows.Next() {
		e := &models.SecurityEvent{}
		var signalsRaw []byte
		if err := rows.Scan(&e.ID, &e.VehicleID, &e.Locked, &e.SentryMode, &e.DoorState,
			&e.DriverSeatOccupied, &signalsRaw, &e.CreatedAt); err != nil {
			return nil, err
		}
		if err := hydrateFromSignals(signalsRaw, e); err != nil {
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
