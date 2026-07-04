package gdpr

// ArtifactRepo is the manifest store for external-storage exports. It
// never stores payload bytes, only path, checksum, and size. The
// export-worker streams JSONL/gzip directly to disk or S3 and inserts a
// row here when done.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Package-local error sentinels. The database layer is domain-free (no
// sibling repo imports internal/domain), so callers translate these to
// HTTP status at the service/handler boundary — mirroring
// admin.ErrPinnedAlreadyExists and export.ErrScheduledExport*.
var (
	// ErrConflict is returned by Insert when a manifest with the same id
	// already exists (the id column is the PRIMARY KEY). It fulfils the
	// documented Insert contract by mapping SQLSTATE 23505.
	ErrConflict = errors.New("gdpr_artifact: already exists")

	// ErrValidation is returned by Insert when the supplied manifest is
	// missing a required field or carries an out-of-range value, before
	// any database round trip is attempted.
	ErrValidation = errors.New("gdpr_artifact: invalid manifest")
)

// StorageKind enumerates the supported backends. Used as a DB CHECK.
type StorageKind string

const (
	StorageKindLocalFS StorageKind = "local_fs"
	StorageKindS3      StorageKind = "s3"
)

// valid reports whether k is one of the persisted backends. Kept in sync
// with the storage_kind CHECK constraint (mig 000212) so Insert rejects a
// bad kind before the write reaches Postgres.
func (k StorageKind) valid() bool {
	return k == StorageKindLocalFS || k == StorageKindS3
}

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

// validate checks the minimum invariants required to persist a manifest.
// It guards the NOT NULL / CHECK columns of gdpr_export_artifact so a
// malformed row fails fast with a typed error instead of surfacing as an
// opaque driver constraint violation. Each failure wraps ErrValidation.
func (a Artifact) validate() error {
	switch {
	case strings.TrimSpace(a.ID) == "":
		return fmt.Errorf("%w: id is required", ErrValidation)
	case strings.TrimSpace(a.ExportJobID) == "":
		return fmt.Errorf("%w: export_job_id is required", ErrValidation)
	case !a.StorageKind.valid():
		return fmt.Errorf("%w: storage_kind %q must be local_fs or s3", ErrValidation, a.StorageKind)
	case strings.TrimSpace(a.StoragePath) == "":
		return fmt.Errorf("%w: storage_path is required", ErrValidation)
	case strings.TrimSpace(a.SHA256) == "":
		return fmt.Errorf("%w: sha256 is required", ErrValidation)
	case a.ByteCount < 0:
		return fmt.Errorf("%w: byte_count must be >= 0", ErrValidation)
	case a.ExpiresAt.IsZero():
		return fmt.Errorf("%w: expires_at is required", ErrValidation)
	}
	return nil
}

// artifactColumns is the canonical projection shared by every read path so
// scanArtifact's destination order stays in lock-step with the SELECTs.
const artifactColumns = `id, export_job_id, vehicle_id, storage_kind, storage_path,
       sha256, byte_count, created_at, expires_at,
       downloaded_at, download_count`

const insertArtifactSQL = `
INSERT INTO gdpr_export_artifact
  (id, export_job_id, vehicle_id, storage_kind, storage_path,
   sha256, byte_count, created_at, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

const getByIDSQL = `
SELECT ` + artifactColumns + `
  FROM gdpr_export_artifact
 WHERE id = $1`

const listByVehicleSQL = `
SELECT ` + artifactColumns + `
  FROM gdpr_export_artifact
 WHERE vehicle_id = $1
 ORDER BY created_at DESC
 LIMIT $2`

const expiredSQL = `
SELECT ` + artifactColumns + `
  FROM gdpr_export_artifact
 WHERE expires_at < now()
 ORDER BY expires_at ASC
 LIMIT $1`

const recordDownloadSQL = `
UPDATE gdpr_export_artifact
   SET download_count = download_count + 1,
       downloaded_at  = now()
 WHERE id = $1`

const deleteSQL = `DELETE FROM gdpr_export_artifact WHERE id = $1`

// rowScanner is the Scan surface shared by pgx.Row and pgx.Rows, letting
// GetByID (single row) and the list paths (row stream) share scanArtifact.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanArtifact reads one manifest row using the artifactColumns projection.
// Centralising the destination list keeps the three read paths from drifting
// out of column order — a class of bug that only shows up at runtime.
func scanArtifact(s rowScanner) (Artifact, error) {
	var a Artifact
	var kind string
	if err := s.Scan(
		&a.ID, &a.ExportJobID, &a.VehicleID, &kind, &a.StoragePath,
		&a.SHA256, &a.ByteCount, &a.CreatedAt, &a.ExpiresAt,
		&a.DownloadedAt, &a.DownloadCount,
	); err != nil {
		return Artifact{}, err
	}
	a.StorageKind = StorageKind(kind)
	return a, nil
}

// ArtifactRepo is the manifest CRUD.
type ArtifactRepo struct {
	// exec is the minimal pgx surface the repo needs, wired from db.Pool at
	// construction. Declaring the seam (rather than reaching through a
	// *database.DB) lets unit tests substitute a scripted fake without a
	// live database — the codebase vendors no pgxmock/testcontainers harness
	// (see achievement.UnlockRepo and drive.txRecorder for the same seam).
	exec database.DBTX
}

// Compile-time guard that *pgxpool.Pool still satisfies the seam. If pgx
// renames Exec/Query/QueryRow this fails at build time rather than at the
// first request.
var _ database.DBTX = (*pgxpool.Pool)(nil)

// NewArtifactRepo constructs the repo. A nil db or nil pool means the GDPR
// export subsystem is not configured on this deployment; the constructor
// returns nil and every method is a safe no-op (the guarding service also
// checks for nil before delegating).
func NewArtifactRepo(db *database.DB) *ArtifactRepo {
	if db == nil || db.Pool == nil {
		return nil
	}
	return &ArtifactRepo{exec: db.Pool}
}

// Insert persists a new manifest row. It validates the manifest before the
// round trip and returns ErrConflict if the id already exists.
func (r *ArtifactRepo) Insert(ctx context.Context, a Artifact) error {
	if r == nil {
		return nil
	}
	if err := a.validate(); err != nil {
		return fmt.Errorf("gdpr_artifact: insert: %w", err)
	}
	_, err := r.exec.Exec(ctx, insertArtifactSQL,
		a.ID, a.ExportJobID, a.VehicleID, string(a.StorageKind), a.StoragePath,
		a.SHA256, a.ByteCount, a.CreatedAt.UTC(), a.ExpiresAt.UTC())
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return fmt.Errorf("gdpr_artifact: insert id %q: %w", a.ID, ErrConflict)
		}
		return fmt.Errorf("gdpr_artifact: insert: %w", err)
	}
	return nil
}

// GetByID returns the manifest for `id` or (nil, nil) when not found.
func (r *ArtifactRepo) GetByID(ctx context.Context, id string) (*Artifact, error) {
	if r == nil {
		return nil, nil
	}
	a, err := scanArtifact(r.exec.QueryRow(ctx, getByIDSQL, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("gdpr_artifact: get: %w", err)
	}
	return &a, nil
}

// ListByVehicle returns recent artifacts for a vehicle, newest first. The
// limit is clamped to (0, 200]; out-of-range values fall back to 50.
func (r *ArtifactRepo) ListByVehicle(ctx context.Context, vehicleID int64, limit int) ([]Artifact, error) {
	if r == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := r.exec.Query(ctx, listByVehicleSQL, vehicleID, limit)
	if err != nil {
		return nil, fmt.Errorf("gdpr_artifact: list: %w", err)
	}
	defer rows.Close()
	out := make([]Artifact, 0, limit)
	for rows.Next() {
		a, err := scanArtifact(rows)
		if err != nil {
			return nil, fmt.Errorf("gdpr_artifact: scan: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("gdpr_artifact: list rows: %w", err)
	}
	return out, nil
}

// RecordDownload increments the download counter and stamps
// downloaded_at. Safe to call concurrently — the UPDATE is atomic.
func (r *ArtifactRepo) RecordDownload(ctx context.Context, id string) error {
	if r == nil {
		return nil
	}
	_, err := r.exec.Exec(ctx, recordDownloadSQL, id)
	if err != nil {
		return fmt.Errorf("gdpr_artifact: record download: %w", err)
	}
	return nil
}

// Expired returns artifacts whose expires_at < now(), oldest first. The
// retention worker deletes the underlying files + the row. The limit is
// clamped to (0, 1000]; out-of-range values fall back to 100.
func (r *ArtifactRepo) Expired(ctx context.Context, limit int) ([]Artifact, error) {
	if r == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := r.exec.Query(ctx, expiredSQL, limit)
	if err != nil {
		return nil, fmt.Errorf("gdpr_artifact: expired: %w", err)
	}
	defer rows.Close()
	out := make([]Artifact, 0, limit)
	for rows.Next() {
		a, err := scanArtifact(rows)
		if err != nil {
			return nil, fmt.Errorf("gdpr_artifact: scan: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("gdpr_artifact: expired rows: %w", err)
	}
	return out, nil
}

// Delete removes a manifest row. The underlying file removal is the
// caller's responsibility. Deleting an unknown id is a no-op, not an error.
func (r *ArtifactRepo) Delete(ctx context.Context, id string) error {
	if r == nil {
		return nil
	}
	_, err := r.exec.Exec(ctx, deleteSQL, id)
	if err != nil {
		return fmt.Errorf("gdpr_artifact: delete: %w", err)
	}
	return nil
}
