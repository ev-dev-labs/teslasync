package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type BackupRunRepo struct {
	db *DB
}

func NewBackupRunRepo(db *DB) *BackupRunRepo {
	return &BackupRunRepo{db: db}
}

func (r *BackupRunRepo) Create(ctx context.Context, run *models.BackupRun) error {
	query := `INSERT INTO backup_runs (config_id, run_type, backup_type, status, provider, metadata)
		VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`
	return r.db.Pool.QueryRow(ctx, query,
		run.ConfigID, run.RunType, run.BackupType, run.Status, run.Provider, run.Metadata,
	).Scan(&run.ID, &run.CreatedAt)
}

func (r *BackupRunRepo) UpdateStatus(ctx context.Context, id int64, status string) error {
	now := time.Now().UTC()
	if status == "running" {
		_, err := r.db.Pool.Exec(ctx, `UPDATE backup_runs SET status=$2, started_at=$3 WHERE id=$1`, id, status, now)
		return err
	}
	_, err := r.db.Pool.Exec(ctx, `UPDATE backup_runs SET status=$2 WHERE id=$1`, id, status)
	return err
}

func (r *BackupRunRepo) Complete(ctx context.Context, id int64, fileName, filePath string, fileSize int64, recordCount, tableCount int, checksum string, durationMs int64) error {
	now := time.Now().UTC()
	query := `UPDATE backup_runs SET status='completed', file_name=$2, file_path=$3, file_size=$4, record_count=$5, table_count=$6, checksum=$7, duration_ms=$8, completed_at=$9 WHERE id=$1`
	_, err := r.db.Pool.Exec(ctx, query, id, fileName, filePath, fileSize, recordCount, tableCount, checksum, durationMs, now)
	return err
}

func (r *BackupRunRepo) Fail(ctx context.Context, id int64, errMsg string, durationMs int64) error {
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx, `UPDATE backup_runs SET status='failed', error_message=$2, duration_ms=$3, completed_at=$4 WHERE id=$1`, id, errMsg, durationMs, now)
	return err
}

func (r *BackupRunRepo) GetByID(ctx context.Context, id int64) (*models.BackupRun, error) {
	query := `SELECT id, config_id, run_type, backup_type, status, provider, file_name, file_path, file_size, record_count, table_count, checksum, duration_ms, error_message, metadata, started_at, completed_at, created_at
		FROM backup_runs WHERE id = $1`
	run := &models.BackupRun{}
	err := r.db.Pool.QueryRow(ctx, query, id).Scan(
		&run.ID, &run.ConfigID, &run.RunType, &run.BackupType, &run.Status, &run.Provider,
		&run.FileName, &run.FilePath, &run.FileSize, &run.RecordCount, &run.TableCount,
		&run.Checksum, &run.DurationMs, &run.ErrorMessage, &run.Metadata,
		&run.StartedAt, &run.CompletedAt, &run.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return run, nil
}

func (r *BackupRunRepo) List(ctx context.Context, limit, offset int) ([]*models.BackupRun, error) {
	query := `SELECT id, config_id, run_type, backup_type, status, provider, file_name, file_path, file_size, record_count, table_count, checksum, duration_ms, error_message, metadata, started_at, completed_at, created_at
		FROM backup_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2`
	rows, err := r.db.Pool.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []*models.BackupRun
	for rows.Next() {
		run := &models.BackupRun{}
		if err := rows.Scan(
			&run.ID, &run.ConfigID, &run.RunType, &run.BackupType, &run.Status, &run.Provider,
			&run.FileName, &run.FilePath, &run.FileSize, &run.RecordCount, &run.TableCount,
			&run.Checksum, &run.DurationMs, &run.ErrorMessage, &run.Metadata,
			&run.StartedAt, &run.CompletedAt, &run.CreatedAt,
		); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (r *BackupRunRepo) ListByConfig(ctx context.Context, configID int64, limit int) ([]*models.BackupRun, error) {
	query := `SELECT id, config_id, run_type, backup_type, status, provider, file_name, file_path, file_size, record_count, table_count, checksum, duration_ms, error_message, metadata, started_at, completed_at, created_at
		FROM backup_runs WHERE config_id = $1 ORDER BY created_at DESC LIMIT $2`
	rows, err := r.db.Pool.Query(ctx, query, configID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var runs []*models.BackupRun
	for rows.Next() {
		run := &models.BackupRun{}
		if err := rows.Scan(
			&run.ID, &run.ConfigID, &run.RunType, &run.BackupType, &run.Status, &run.Provider,
			&run.FileName, &run.FilePath, &run.FileSize, &run.RecordCount, &run.TableCount,
			&run.Checksum, &run.DurationMs, &run.ErrorMessage, &run.Metadata,
			&run.StartedAt, &run.CompletedAt, &run.CreatedAt,
		); err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (r *BackupRunRepo) CleanupOld(ctx context.Context, configID int64, keepN int) (int64, error) {
	query := `DELETE FROM backup_runs WHERE config_id = $1 AND id NOT IN (
		SELECT id FROM backup_runs WHERE config_id = $1 ORDER BY created_at DESC LIMIT $2
	)`
	tag, err := r.db.Pool.Exec(ctx, query, configID, keepN)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
