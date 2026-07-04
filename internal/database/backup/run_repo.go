package backup

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"

	backupmodel "github.com/ev-dev-labs/teslasync/internal/models/backup"

	"github.com/jackc/pgx/v5"
)

// BackupRunRepo tracks per-execution backup/restore rows (status,
// timings, artifact metadata) consumed by the export-worker scheduler
// and the backup-verify job.
//
// Like BackupConfigRepo it holds a database.DBTX querier so unit tests
// can inject a fake; pool-touching methods guard on ready() and return
// ErrRepoNotConfigured when no pool was wired.
type BackupRunRepo struct {
	q database.DBTX
}

// NewBackupRunRepo wires the repo to db's connection pool. A nil db, or
// a db with a nil Pool, yields a repo whose methods return
// ErrRepoNotConfigured rather than panicking.
func NewBackupRunRepo(db *database.DB) *BackupRunRepo {
	var q database.DBTX
	if db != nil && db.Pool != nil {
		q = db.Pool
	}
	return &BackupRunRepo{q: q}
}

// ready reports whether the repo has a usable querier.
func (r *BackupRunRepo) ready() error {
	if r == nil || r.q == nil {
		return ErrRepoNotConfigured
	}
	return nil
}

func (r *BackupRunRepo) Create(ctx context.Context, run *backupmodel.BackupRun) error {
	if run == nil {
		return ErrNilRun
	}
	if err := r.ready(); err != nil {
		return err
	}
	const query = `INSERT INTO backup_runs (config_id, run_type, backup_type, status, provider, metadata)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`
	if err := r.q.QueryRow(ctx, query,
		run.ConfigID, run.RunType, run.BackupType, run.Status, run.Provider, run.Metadata,
	).Scan(&run.ID, &run.CreatedAt); err != nil {
		return fmt.Errorf("backup run create: %w", err)
	}
	return nil
}

func (r *BackupRunRepo) UpdateStatus(ctx context.Context, id int64, status string) error {
	if err := r.ready(); err != nil {
		return err
	}
	now := time.Now().UTC()
	if status == "running" {
		if _, err := r.q.Exec(ctx, `UPDATE backup_runs SET status=$2, started_at=$3 WHERE id=$1`, id, status, now); err != nil {
			return fmt.Errorf("backup run %d set running: %w", id, err)
		}
		return nil
	}
	if _, err := r.q.Exec(ctx, `UPDATE backup_runs SET status=$2 WHERE id=$1`, id, status); err != nil {
		return fmt.Errorf("backup run %d update status %q: %w", id, status, err)
	}
	return nil
}

func (r *BackupRunRepo) Complete(ctx context.Context, id int64, status string, fileName, filePath string, fileSize int64, recordCount, tableCount int, checksum string, durationMs int64) error {
	if err := r.ready(); err != nil {
		return err
	}
	now := time.Now().UTC()
	const query = `UPDATE backup_runs SET status=$2, file_name=$3, file_path=$4, file_size=$5, record_count=$6, table_count=$7, checksum=$8, duration_ms=$9, completed_at=$10 WHERE id=$1`
	if _, err := r.q.Exec(ctx, query, id, status, fileName, filePath, fileSize, recordCount, tableCount, checksum, durationMs, now); err != nil {
		return fmt.Errorf("backup run %d complete: %w", id, err)
	}
	return nil
}

func (r *BackupRunRepo) Fail(ctx context.Context, id int64, errMsg string, durationMs int64) error {
	if err := r.ready(); err != nil {
		return err
	}
	now := time.Now().UTC()
	if _, err := r.q.Exec(ctx, `UPDATE backup_runs SET status='failed', error_message=$2, duration_ms=$3, completed_at=$4 WHERE id=$1`, id, errMsg, durationMs, now); err != nil {
		return fmt.Errorf("backup run %d fail: %w", id, err)
	}
	return nil
}

// rowScanner is the common Scan surface of pgx.Row (from QueryRow) and a
// single iteration of pgx.Rows (from Query), letting scanBackupRun serve
// both the single-row and multi-row read paths.
type rowScanner interface {
	Scan(dest ...any) error
}

// scanBackupRun materialises one backup_runs row in the canonical column
// order shared by GetByID, List, ListByConfig and LatestSuccessful. It is
// the single source of truth for the projection so a schema change touches
// exactly one Scan site.
func scanBackupRun(s rowScanner) (*backupmodel.BackupRun, error) {
	run := &backupmodel.BackupRun{}
	if err := s.Scan(
		&run.ID, &run.ConfigID, &run.RunType, &run.BackupType, &run.Status, &run.Provider,
		&run.FileName, &run.FilePath, &run.FileSize, &run.RecordCount, &run.TableCount,
		&run.Checksum, &run.DurationMs, &run.ErrorMessage, &run.Metadata,
		&run.StartedAt, &run.CompletedAt, &run.CreatedAt,
	); err != nil {
		return nil, err
	}
	return run, nil
}

// collectBackupRuns drains rows into a slice, surfacing both per-row Scan
// failures and the deferred rows.Err() (e.g. a mid-stream connection drop)
// so a truncated result never masquerades as a complete one.
func collectBackupRuns(rows pgx.Rows) ([]*backupmodel.BackupRun, error) {
	var runs []*backupmodel.BackupRun
	for rows.Next() {
		run, err := scanBackupRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows: %w", err)
	}
	return runs, nil
}

func (r *BackupRunRepo) GetByID(ctx context.Context, id int64) (*backupmodel.BackupRun, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `SELECT id, config_id, run_type, backup_type, status, provider, file_name, file_path, file_size, record_count, table_count, checksum, duration_ms, error_message, metadata, started_at, completed_at, created_at
		FROM backup_runs WHERE id = $1`
	run, err := scanBackupRun(r.q.QueryRow(ctx, query, id))
	if err != nil {
		return nil, fmt.Errorf("backup run get %d: %w", id, err)
	}
	return run, nil
}

func (r *BackupRunRepo) List(ctx context.Context, limit, offset int) ([]*backupmodel.BackupRun, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `SELECT id, config_id, run_type, backup_type, status, provider, file_name, file_path, file_size, record_count, table_count, checksum, duration_ms, error_message, metadata, started_at, completed_at, created_at
		FROM backup_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.q.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("backup run list: %w", err)
	}
	defer rows.Close()
	runs, err := collectBackupRuns(rows)
	if err != nil {
		return nil, fmt.Errorf("backup run list: %w", err)
	}
	return runs, nil
}

func (r *BackupRunRepo) ListByConfig(ctx context.Context, configID int64, limit int) ([]*backupmodel.BackupRun, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `SELECT id, config_id, run_type, backup_type, status, provider, file_name, file_path, file_size, record_count, table_count, checksum, duration_ms, error_message, metadata, started_at, completed_at, created_at
		FROM backup_runs WHERE config_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.q.Query(ctx, query, configID, limit)
	if err != nil {
		return nil, fmt.Errorf("backup run list config %d: %w", configID, err)
	}
	defer rows.Close()
	runs, err := collectBackupRuns(rows)
	if err != nil {
		return nil, fmt.Errorf("backup run list config %d: %w", configID, err)
	}
	return runs, nil
}

// LatestSuccessful returns the most recent successful backup run.
// Returns (nil, nil) when no successful backup exists yet — callers
// MUST treat this as a verification failure rather than a transient
// error. Phase-49 / p49-backup-verify.
//
// A successful backup is recorded with status='completed' (see migration
// 000023's documented status set and the processor's terminal-status
// switch, which writes 'completed'/'partial'/'failed'). This previously
// filtered on a literal 'success' that no code path ever writes, so it
// always returned (nil, nil) and backup-verify reported "no successful
// backup found" even when good artifacts existed.
func (r *BackupRunRepo) LatestSuccessful(ctx context.Context) (*backupmodel.BackupRun, error) {
	if err := r.ready(); err != nil {
		return nil, err
	}
	const query = `SELECT id, config_id, run_type, backup_type, status, provider, file_name, file_path, file_size, record_count, table_count, checksum, duration_ms, error_message, metadata, started_at, completed_at, created_at
		FROM backup_runs WHERE status = 'completed' AND file_path IS NOT NULL ORDER BY created_at DESC LIMIT 1`
	run, err := scanBackupRun(r.q.QueryRow(ctx, query))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("backup run latest successful: %w", err)
	}
	return run, nil
}

func (r *BackupRunRepo) CleanupOld(ctx context.Context, configID int64, keepN int) (int64, error) {
	if err := r.ready(); err != nil {
		return 0, err
	}
	if keepN <= 0 {
		return 0, ErrInvalidRetention
	}
	const query = `DELETE FROM backup_runs WHERE config_id = $1 AND id NOT IN (
		SELECT id FROM backup_runs WHERE config_id = $1 ORDER BY created_at DESC LIMIT $2
	)`
	tag, err := r.q.Exec(ctx, query, configID, keepN)
	if err != nil {
		return 0, fmt.Errorf("backup run cleanup config %d: %w", configID, err)
	}
	return tag.RowsAffected(), nil
}
