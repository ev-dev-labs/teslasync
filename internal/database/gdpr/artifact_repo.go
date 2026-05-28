package gdpr

// Phase-45 / Prompt 8 — GDPR data-subject export artifacts.
//
// ArtifactRepo is the manifest store for external-storage exports.
// NEVER stores bytes — only a path/checksum/size. The export-worker
// streams JSONL/gzip directly to disk or S3 and inserts a row here
// when done.

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// StorageKind enumerates the supported backends. Used as a DB CHECK.
type StorageKind string

const (
	StorageKindLocalFS StorageKind = "local_fs"
	StorageKindS3      StorageKind = "s3"
)

// Artifact is the persisted manifest for a single export bundle.
type Artifact struct {
	ID            string      `json:"id"`
	ExportJobID   string      `json:"export_job_id"`
	VehicleID     int64       `json:"vehicle_id"`
	StorageKind   StorageKind `json:"storage_kind"`
	StoragePath   string      `json:"storage_path"`
	SHA256        string      `json:"sha256"`
	ByteCount     int64       `json:"byte_count"`
	CreatedAt     time.Time   `json:"created_at"`
	ExpiresAt     time.Time   `json:"expires_at"`
	DownloadedAt  *time.Time  `json:"downloaded_at,omitempty"`
	DownloadCount int         `json:"download_count"`
}

// ArtifactRepo is the manifest CRUD.
type ArtifactRepo struct {
	db *database.DB
}

// NewArtifactRepo constructs the repo.
func NewArtifactRepo(db *database.DB) *ArtifactRepo {
	if db == nil || db.Pool == nil {
		return nil
	}
	return &ArtifactRepo{db: db}
}

// Insert persists a new manifest row. Returns ErrConflict if the id
// already exists.
func (r *ArtifactRepo) Insert(ctx context.Context, a Artifact) error {
	if r == nil {
		return nil
	}
	const sql = `
INSERT INTO gdpr_export_artifact
  (id, export_job_id, vehicle_id, storage_kind, storage_path,
   sha256, byte_count, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
	_, err := r.db.Pool.Exec(ctx, sql,
		a.ID, a.ExportJobID, a.VehicleID, string(a.StorageKind), a.StoragePath,
		a.SHA256, a.ByteCount, a.CreatedAt.UTC(), a.ExpiresAt.UTC())
	if err != nil {
		return fmt.Errorf("gdpr_artifact: insert: %w", err)
	}
	return nil
}

// GetByID returns the manifest for `id` or (nil, nil) when not found.
func (r *ArtifactRepo) GetByID(ctx context.Context, id string) (*Artifact, error) {
	if r == nil {
		return nil, nil
	}
	const sql = `
SELECT id, export_job_id, vehicle_id, storage_kind, storage_path,
       sha256, byte_count, created_at, expires_at,
       downloaded_at, download_count
  FROM gdpr_export_artifact
 WHERE id = $1`
	var a Artifact
	var kind string
	err := r.db.Pool.QueryRow(ctx, sql, id).Scan(
		&a.ID, &a.ExportJobID, &a.VehicleID, &kind, &a.StoragePath,
		&a.SHA256, &a.ByteCount, &a.CreatedAt, &a.ExpiresAt,
		&a.DownloadedAt, &a.DownloadCount)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("gdpr_artifact: get: %w", err)
	}
	a.StorageKind = StorageKind(kind)
	return &a, nil
}

// ListByVehicle returns recent artifacts for a vehicle, newest first.
func (r *ArtifactRepo) ListByVehicle(ctx context.Context, vehicleID int64, limit int) ([]Artifact, error) {
	if r == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const sql = `
SELECT id, export_job_id, vehicle_id, storage_kind, storage_path,
       sha256, byte_count, created_at, expires_at,
       downloaded_at, download_count
  FROM gdpr_export_artifact
 WHERE vehicle_id = $1
 ORDER BY created_at DESC
 LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, sql, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("gdpr_artifact: list: %w", err)
	}
	defer rows.Close()
	var out []Artifact
	for rows.Next() {
		var a Artifact
		var kind string
		if err := rows.Scan(&a.ID, &a.ExportJobID, &a.VehicleID, &kind, &a.StoragePath,
			&a.SHA256, &a.ByteCount, &a.CreatedAt, &a.ExpiresAt,
			&a.DownloadedAt, &a.DownloadCount); err != nil {
			return nil, fmt.Errorf("gdpr_artifact: scan: %w", err)
		}
		a.StorageKind = StorageKind(kind)
		out = append(out, a)
	}
	if out == nil {
		out = []Artifact{}
	}
	return out, rows.Err()
}

// RecordDownload increments the download counter and stamps
// downloaded_at. Safe to call concurrently — the UPDATE is atomic.
func (r *ArtifactRepo) RecordDownload(ctx context.Context, id string) error {
	if r == nil {
		return nil
	}
	const sql = `
UPDATE gdpr_export_artifact
   SET download_count = download_count + 1,
       downloaded_at  = now()
 WHERE id = $1`
	_, err := r.db.Pool.Exec(ctx, sql, id)
	if err != nil {
		return fmt.Errorf("gdpr_artifact: record download: %w", err)
	}
	return nil
}

// Expired returns artifacts whose expires_at < now(). The retention
// worker deletes the underlying files + the row.
func (r *ArtifactRepo) Expired(ctx context.Context, limit int) ([]Artifact, error) {
	if r == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	const sql = `
SELECT id, export_job_id, vehicle_id, storage_kind, storage_path,
       sha256, byte_count, created_at, expires_at,
       downloaded_at, download_count
  FROM gdpr_export_artifact
 WHERE expires_at < now()
 ORDER BY expires_at ASC
 LIMIT $1`
	rows, err := r.db.Pool.Query(ctx, sql, limit)
	if err != nil {
		return nil, fmt.Errorf("gdpr_artifact: expired: %w", err)
	}
	defer rows.Close()
	var out []Artifact
	for rows.Next() {
		var a Artifact
		var kind string
		if err := rows.Scan(&a.ID, &a.ExportJobID, &a.VehicleID, &kind, &a.StoragePath,
			&a.SHA256, &a.ByteCount, &a.CreatedAt, &a.ExpiresAt,
			&a.DownloadedAt, &a.DownloadCount); err != nil {
			return nil, fmt.Errorf("gdpr_artifact: scan: %w", err)
		}
		a.StorageKind = StorageKind(kind)
		out = append(out, a)
	}
	if out == nil {
		out = []Artifact{}
	}
	return out, rows.Err()
}

// Delete removes a manifest row. The underlying file removal is the
// caller's responsibility.
func (r *ArtifactRepo) Delete(ctx context.Context, id string) error {
	if r == nil {
		return nil
	}
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM gdpr_export_artifact WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("gdpr_artifact: delete: %w", err)
	}
	return nil
}
