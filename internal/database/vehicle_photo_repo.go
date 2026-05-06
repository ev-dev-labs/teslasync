// Phase-46 / Prompt 54 — Vehicle photo repo.
//
// Owns the `vehicle_photos` table (migration 000177). One row per
// vehicle keyed by vehicle_id PK; each row records the disk-relative
// paths to the three rendered sizes plus the upload timestamp the
// SPA uses as a cache buster.
//
// The repo is intentionally narrow: Get / Upsert / Delete. The
// handler owns disk IO, multipart parsing, and image processing —
// this layer only persists the paths so a future move to S3-backed
// storage can swap the handler without touching the DB schema.
package database

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrVehiclePhotoNotFound is returned by Get and Delete when no row
// exists for the supplied vehicleID. The handler maps this to 404
// (Get) or 204 (Delete — idempotent) so the SPA never has to
// pre-flight an existence check.
var ErrVehiclePhotoNotFound = errors.New("vehicle_photos: not found")

// VehiclePhotoRow is the in-memory projection of one row in the
// vehicle_photos table. All three Path fields are disk-relative (no
// leading slash) so the handler can join them onto the configured
// photo root without worrying about absolute-path takeover.
type VehiclePhotoRow struct {
	VehicleID  int64
	ThumbPath  string
	MediumPath string
	FullPath   string
	UploadedAt time.Time
}

// VehiclePhotoRepo is the data-access layer for vehicle_photos.
// Stateless; safe to call concurrently — every method takes a
// context and forwards to the shared pgx pool.
type VehiclePhotoRepo struct {
	db *DB
}

// NewVehiclePhotoRepo wires the repo to a database pool. No
// background work is started; the repo is purely a thin SQL facade.
func NewVehiclePhotoRepo(db *DB) *VehiclePhotoRepo {
	return &VehiclePhotoRepo{db: db}
}

// Get returns the row for vehicleID or ErrVehiclePhotoNotFound when
// no row is present. Other errors are wrapped with a "vehicle_photos:
// get:" prefix.
func (r *VehiclePhotoRepo) Get(ctx context.Context, vehicleID int64) (*VehiclePhotoRow, error) {
	const q = `
		SELECT vehicle_id, thumb_path, medium_path, full_path, uploaded_at
		FROM vehicle_photos
		WHERE vehicle_id = $1`
	var row VehiclePhotoRow
	err := r.db.Pool.QueryRow(ctx, q, vehicleID).Scan(
		&row.VehicleID, &row.ThumbPath, &row.MediumPath, &row.FullPath, &row.UploadedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVehiclePhotoNotFound
		}
		return nil, fmt.Errorf("vehicle_photos: get: %w", err)
	}
	return &row, nil
}

// Upsert inserts a fresh row or replaces the existing one for
// vehicleID. The handler calls this AFTER the on-disk bytes have
// been persisted and fsynced; the resulting uploaded_at timestamp
// is the cache buster the SPA renders into <img src ?v=>.
//
// Returns the persisted row so the handler can echo uploaded_at
// back to the SPA without a second SELECT.
func (r *VehiclePhotoRepo) Upsert(
	ctx context.Context,
	vehicleID int64,
	thumb, medium, full string,
) (*VehiclePhotoRow, error) {
	const q = `
		INSERT INTO vehicle_photos (vehicle_id, thumb_path, medium_path, full_path, uploaded_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (vehicle_id) DO UPDATE SET
			thumb_path  = EXCLUDED.thumb_path,
			medium_path = EXCLUDED.medium_path,
			full_path   = EXCLUDED.full_path,
			uploaded_at = EXCLUDED.uploaded_at
		RETURNING vehicle_id, thumb_path, medium_path, full_path, uploaded_at`
	var row VehiclePhotoRow
	if err := r.db.Pool.QueryRow(ctx, q, vehicleID, thumb, medium, full).Scan(
		&row.VehicleID, &row.ThumbPath, &row.MediumPath, &row.FullPath, &row.UploadedAt,
	); err != nil {
		return nil, fmt.Errorf("vehicle_photos: upsert: %w", err)
	}
	return &row, nil
}

// Delete removes the row for vehicleID. Returns the deleted row so
// the handler can unlink the on-disk bytes after the DB row is gone
// (preserving the invariant "DB row only points at files on disk
// that exist"). Returns ErrVehiclePhotoNotFound when no row matched
// — the handler maps that to 204 (idempotent reset).
func (r *VehiclePhotoRepo) Delete(ctx context.Context, vehicleID int64) (*VehiclePhotoRow, error) {
	const q = `
		DELETE FROM vehicle_photos
		WHERE vehicle_id = $1
		RETURNING vehicle_id, thumb_path, medium_path, full_path, uploaded_at`
	var row VehiclePhotoRow
	if err := r.db.Pool.QueryRow(ctx, q, vehicleID).Scan(
		&row.VehicleID, &row.ThumbPath, &row.MediumPath, &row.FullPath, &row.UploadedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVehiclePhotoNotFound
		}
		return nil, fmt.Errorf("vehicle_photos: delete: %w", err)
	}
	return &row, nil
}
