package tesla

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"
)

// TeslaVehicleDriverRepo provides data access for vehicle drivers and share invitations.
type TeslaVehicleDriverRepo struct {
	pool teslaPool
}

// NewTeslaVehicleDriverRepo creates a new repository.
func NewTeslaVehicleDriverRepo(db *database.DB) *TeslaVehicleDriverRepo {
	return &TeslaVehicleDriverRepo{pool: db.Pool}
}

// GetDriversByVehicleID returns all drivers for a given vehicle.
func (r *TeslaVehicleDriverRepo) GetDriversByVehicleID(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleDriver, error) {
	query := `SELECT id, vehicle_id, vin, share_user_id, driver_email, driver_name, role, fetched_at
		FROM tesla_vehicle_drivers WHERE vehicle_id = $1 ORDER BY id ASC`

	rows, err := r.pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("query vehicle drivers: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaVehicleDriver
	for rows.Next() {
		d := &teslamodel.TeslaVehicleDriver{}
		if err := rows.Scan(
			&d.ID, &d.VehicleID, &d.VIN, &d.ShareUserID,
			&d.DriverEmail, &d.DriverName, &d.Role, &d.FetchedAt,
		); err != nil {
			return nil, fmt.Errorf("scan vehicle driver: %w", err)
		}
		results = append(results, d)
	}
	return results, rows.Err()
}

// ReplaceDriversForVehicle replaces all drivers for a vehicle with the given set.
func (r *TeslaVehicleDriverRepo) ReplaceDriversForVehicle(ctx context.Context, vehicleID int64, drivers []*teslamodel.TeslaVehicleDriver) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	now := time.Now().UTC()

	if _, err := tx.Exec(ctx, `DELETE FROM tesla_vehicle_drivers WHERE vehicle_id = $1`, vehicleID); err != nil {
		return fmt.Errorf("delete old drivers: %w", err)
	}

	for i, d := range drivers {
		if d == nil {
			return fmt.Errorf("insert driver: nil driver at index %d", i)
		}
		_, err := tx.Exec(ctx, `INSERT INTO tesla_vehicle_drivers
			(vehicle_id, vin, share_user_id, driver_email, driver_name, role, fetched_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			d.VehicleID, d.VIN, d.ShareUserID, d.DriverEmail, d.DriverName, d.Role, now,
		)
		if err != nil {
			return fmt.Errorf("insert driver: %w", err)
		}
	}

	return tx.Commit(ctx)
}

// GetInvitationsByVehicleID returns all invitations for a given vehicle.
func (r *TeslaVehicleDriverRepo) GetInvitationsByVehicleID(ctx context.Context, vehicleID int64) ([]*teslamodel.TeslaVehicleInvitation, error) {
	query := `SELECT id, vehicle_id, vin, invitation_id, invite_url, status, expires_at, created_by, fetched_at, created_at
		FROM tesla_vehicle_invitations WHERE vehicle_id = $1 ORDER BY created_at DESC`

	rows, err := r.pool.Query(ctx, query, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("query vehicle invitations: %w", err)
	}
	defer rows.Close()

	var results []*teslamodel.TeslaVehicleInvitation
	for rows.Next() {
		inv := &teslamodel.TeslaVehicleInvitation{}
		if err := rows.Scan(
			&inv.ID, &inv.VehicleID, &inv.VIN, &inv.InvitationID,
			&inv.InviteURL, &inv.Status, &inv.ExpiresAt, &inv.CreatedBy,
			&inv.FetchedAt, &inv.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan vehicle invitation: %w", err)
		}
		results = append(results, inv)
	}
	return results, rows.Err()
}

// ReplaceInvitationsForVehicle replaces all invitations for a vehicle with the given set.
func (r *TeslaVehicleDriverRepo) ReplaceInvitationsForVehicle(ctx context.Context, vehicleID int64, invitations []*teslamodel.TeslaVehicleInvitation) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	now := time.Now().UTC()

	if _, err := tx.Exec(ctx, `DELETE FROM tesla_vehicle_invitations WHERE vehicle_id = $1`, vehicleID); err != nil {
		return fmt.Errorf("delete old invitations: %w", err)
	}

	for i, inv := range invitations {
		if inv == nil {
			return fmt.Errorf("insert invitation: nil invitation at index %d", i)
		}
		_, err := tx.Exec(ctx, `INSERT INTO tesla_vehicle_invitations
			(vehicle_id, vin, invitation_id, invite_url, status, expires_at, created_by, fetched_at, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			inv.VehicleID, inv.VIN, inv.InvitationID, inv.InviteURL,
			inv.Status, inv.ExpiresAt, inv.CreatedBy, now, now,
		)
		if err != nil {
			return fmt.Errorf("insert invitation: %w", err)
		}
	}

	return tx.Commit(ctx)
}

// InsertInvitation inserts a single invitation record.
func (r *TeslaVehicleDriverRepo) InsertInvitation(ctx context.Context, inv *teslamodel.TeslaVehicleInvitation) error {
	now := time.Now().UTC()
	err := r.pool.QueryRow(ctx, `INSERT INTO tesla_vehicle_invitations
		(vehicle_id, vin, invitation_id, invite_url, status, expires_at, created_by, fetched_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (vehicle_id, invitation_id) DO UPDATE SET
			invite_url = EXCLUDED.invite_url,
			status = EXCLUDED.status,
			expires_at = EXCLUDED.expires_at,
			fetched_at = EXCLUDED.fetched_at
		RETURNING id`,
		inv.VehicleID, inv.VIN, inv.InvitationID, inv.InviteURL,
		inv.Status, inv.ExpiresAt, inv.CreatedBy, now, now,
	).Scan(&inv.ID)
	if err != nil {
		return fmt.Errorf("insert invitation: %w", err)
	}
	inv.FetchedAt = now
	inv.CreatedAt = now
	return nil
}
