package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
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

// GetLatestVersion returns the most recent version string for a vehicle.
// Returns empty string if no records exist.
func (r *SoftwareUpdateRepo) GetLatestVersion(ctx context.Context, vehicleID int64) (string, error) {
	var version string
	err := r.db.Pool.QueryRow(ctx,
		`SELECT version FROM software_updates WHERE vehicle_id=$1 ORDER BY created_at DESC LIMIT 1`,
		vehicleID).Scan(&version)
	if err != nil {
		return "", err
	}
	return version, nil
}

// InsertIfChanged inserts a new firmware version record only if it differs
// from the latest stored version. Returns true if a new record was inserted.
func (r *SoftwareUpdateRepo) InsertIfChanged(ctx context.Context, vehicleID int64, version, status string) (bool, error) {
	// Check if this version already exists as the latest
	latest, err := r.GetLatestVersion(ctx, vehicleID)
	if err == nil && latest == version {
		return false, nil // same version, skip
	}

	_, err = r.db.Pool.Exec(ctx,
		`INSERT INTO software_updates (vehicle_id, version, status, installed_at, created_at)
		 VALUES ($1, $2, $3, NOW(), NOW())`,
		vehicleID, version, status)
	if err != nil {
		return false, err
	}
	return true, nil
}
