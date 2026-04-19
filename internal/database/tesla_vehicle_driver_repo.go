package database

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TeslaVehicleDriverRepo provides data access for vehicle drivers and share invitations.
type TeslaVehicleDriverRepo struct {
	db *DB
}

// NewTeslaVehicleDriverRepo creates a new repository.
func NewTeslaVehicleDriverRepo(db *DB) *TeslaVehicleDriverRepo {
	return &TeslaVehicleDriverRepo{db: db}
}

// GetDriversByVehicleID returns all drivers for a given vehicle.
func (r *TeslaVehicleDriverRepo) GetDriversByVehicleID(ctx context.Context, vehicleID int64) ([]*models.TeslaVehicleDriver, error) {
	query := `SELECT id, vehicle_id, vin, share_user_id, driver_email, driver_name, role, raw_json, fetched_at
		FROM tesla_vehicle_drivers WHERE vehicle_id = $1 ORDER BY id ASC`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("query vehicle drivers: %w", err)
	}
	defer rows.Close()

	var results []*models.TeslaVehicleDriver
	for rows.Next() {
		d := &models.TeslaVehicleDriver{}
		if err := rows.Scan(
			&d.ID, &d.VehicleID, &d.VIN, &d.ShareUserID,
			&d.DriverEmail, &d.DriverName, &d.Role, &d.RawJSON, &d.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan vehicle driver: %w", err)
		}
		results = append(results, d)
	}
	return results, rows.Err()
}

// ReplaceDriversForVehicle replaces all drivers for a vehicle with the given set.
func (r *TeslaVehicleDriverRepo) ReplaceDriversForVehicle(ctx context.Context, vehicleID int64, drivers []*models.TeslaVehicleDriver) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	now := time.Now().UTC()

	if _, err := tx.Exec(ctx, `DELETE FROM tesla_vehicle_drivers WHERE vehicle_id = $1`, vehicleID); err != nil {
		return fmt.Errorf("delete old drivers: %w", err)
	}

	for _, d := range drivers {
		rawJSON := d.RawJSON
		if rawJSON == "" {
			rawJSON = "{}"
		}
		_, err := tx.Exec(ctx, `INSERT INTO tesla_vehicle_drivers
			(vehicle_id, vin, share_user_id, driver_email, driver_name, role, raw_json, fetched_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			d.VehicleID, d.VIN, d.ShareUserID, d.DriverEmail, d.DriverName, d.Role, rawJSON, now,
		)
		if err != nil {
			return fmt.Errorf("insert driver: %w", err)
		}
	}

	return tx.Commit(ctx)
}

// GetInvitationsByVehicleID returns all invitations for a given vehicle.
func (r *TeslaVehicleDriverRepo) GetInvitationsByVehicleID(ctx context.Context, vehicleID int64) ([]*models.TeslaVehicleInvitation, error) {
	query := `SELECT id, vehicle_id, vin, invitation_id, invite_url, status, expires_at, created_by, raw_json, fetched_at, created_at
		FROM tesla_vehicle_invitations WHERE vehicle_id = $1 ORDER BY created_at DESC`

	rows, err := r.db.Pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("query vehicle invitations: %w", err)
	}
	defer rows.Close()

	var results []*models.TeslaVehicleInvitation
	for rows.Next() {
		inv := &models.TeslaVehicleInvitation{}
		if err := rows.Scan(
			&inv.ID, &inv.VehicleID, &inv.VIN, &inv.InvitationID,
			&inv.InviteURL, &inv.Status, &inv.ExpiresAt, &inv.CreatedBy,
			&inv.RawJSON, &inv.FetchedAt, &inv.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan vehicle invitation: %w", err)
		}
		results = append(results, inv)
	}
	return results, rows.Err()
}

// ReplaceInvitationsForVehicle replaces all invitations for a vehicle with the given set.
func (r *TeslaVehicleDriverRepo) ReplaceInvitationsForVehicle(ctx context.Context, vehicleID int64, invitations []*models.TeslaVehicleInvitation) error {
	tx, err := r.db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	now := time.Now().UTC()

	if _, err := tx.Exec(ctx, `DELETE FROM tesla_vehicle_invitations WHERE vehicle_id = $1`, vehicleID); err != nil {
		return fmt.Errorf("delete old invitations: %w", err)
	}

	for _, inv := range invitations {
		rawJSON := inv.RawJSON
		if rawJSON == "" {
			rawJSON = "{}"
		}
		_, err := tx.Exec(ctx, `INSERT INTO tesla_vehicle_invitations
			(vehicle_id, vin, invitation_id, invite_url, status, expires_at, created_by, raw_json, fetched_at, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			inv.VehicleID, inv.VIN, inv.InvitationID, inv.InviteURL,
			inv.Status, inv.ExpiresAt, inv.CreatedBy, rawJSON, now, now,
		)
		if err != nil {
			return fmt.Errorf("insert invitation: %w", err)
		}
	}

	return tx.Commit(ctx)
}

// InsertInvitation inserts a single invitation record.
func (r *TeslaVehicleDriverRepo) InsertInvitation(ctx context.Context, inv *models.TeslaVehicleInvitation) error {
	now := time.Now().UTC()
	rawJSON := inv.RawJSON
	if rawJSON == "" {
		rawJSON = "{}"
	}
	err := r.db.Pool.QueryRow(ctx, `INSERT INTO tesla_vehicle_invitations
		(vehicle_id, vin, invitation_id, invite_url, status, expires_at, created_by, raw_json, fetched_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (vehicle_id, invitation_id) DO UPDATE SET
			invite_url = EXCLUDED.invite_url,
			status = EXCLUDED.status,
			expires_at = EXCLUDED.expires_at,
			raw_json = EXCLUDED.raw_json,
			fetched_at = EXCLUDED.fetched_at
		RETURNING id`,
		inv.VehicleID, inv.VIN, inv.InvitationID, inv.InviteURL,
		inv.Status, inv.ExpiresAt, inv.CreatedBy, rawJSON, now, now,
	).Scan(&inv.ID)
	if err != nil {
		return fmt.Errorf("insert invitation: %w", err)
	}
	inv.FetchedAt = now
	inv.CreatedAt = now
	return nil
}
