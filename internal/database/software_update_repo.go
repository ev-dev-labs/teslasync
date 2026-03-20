package database

import (
	"context"

	"github.com/teslasync/teslasync/internal/models"
)

type SoftwareUpdateRepo struct {
	db *DB
}

func NewSoftwareUpdateRepo(db *DB) *SoftwareUpdateRepo {
	return &SoftwareUpdateRepo{db: db}
}

func (r *SoftwareUpdateRepo) GetByVehicle(ctx context.Context, vehicleID int64, limit int) ([]*models.SoftwareUpdate, error) {
	query := `SELECT id, vehicle_id, version, status, scheduled_at, installed_at, created_at
		FROM software_updates WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, vehicleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var updates []*models.SoftwareUpdate
	for rows.Next() {
		u := &models.SoftwareUpdate{}
		if err := rows.Scan(&u.ID, &u.VehicleID, &u.Version, &u.Status, &u.ScheduledAt, &u.InstalledAt, &u.CreatedAt); err != nil {
			return nil, err
		}
		updates = append(updates, u)
	}
	return updates, rows.Err()
}

func (r *SoftwareUpdateRepo) GetAll(ctx context.Context, limit int) ([]*models.SoftwareUpdate, error) {
	query := `SELECT id, vehicle_id, version, status, scheduled_at, installed_at, created_at
		FROM software_updates ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var updates []*models.SoftwareUpdate
	for rows.Next() {
		u := &models.SoftwareUpdate{}
		if err := rows.Scan(&u.ID, &u.VehicleID, &u.Version, &u.Status, &u.ScheduledAt, &u.InstalledAt, &u.CreatedAt); err != nil {
			return nil, err
		}
		updates = append(updates, u)
	}
	return updates, rows.Err()
}
