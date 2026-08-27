package export

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	exportmodel "github.com/ev-dev-labs/teslasync/internal/models/export"
)

type ExportJobRepo struct {
	db *database.DB
}

func NewExportJobRepo(db *database.DB) *ExportJobRepo {
	return &ExportJobRepo{db: db}
}

func (r *ExportJobRepo) Create(ctx context.Context, job *exportmodel.ExportJob) error {
	_, err := r.db.Pool.Exec(ctx, `
		INSERT INTO export_jobs (id, type, format, status, vehicle_id, start_date, end_date, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		job.ID, job.Type, job.Format, job.Status, job.VehicleID, job.StartDate, job.EndDate, job.CreatedAt, job.UpdatedAt)
	return err
}

func (r *ExportJobRepo) GetByID(ctx context.Context, id string) (*exportmodel.ExportJob, error) {
	var job exportmodel.ExportJob
	err := r.db.Pool.QueryRow(ctx, `
		SELECT id, type, format, status, vehicle_id, start_date, end_date,
		       file_name, file_size, record_count, error_message,
		       created_at, updated_at, completed_at
		FROM export_jobs WHERE id = $1`, id).Scan(
		&job.ID, &job.Type, &job.Format, &job.Status, &job.VehicleID,
		&job.StartDate, &job.EndDate, &job.FileName, &job.FileSize,
		&job.RecordCount, &job.ErrorMessage,
		&job.CreatedAt, &job.UpdatedAt, &job.CompletedAt)
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func (r *ExportJobRepo) GetFileData(ctx context.Context, id string) ([]byte, string, error) {
	var data []byte
	var fileName string
	err := r.db.Pool.QueryRow(ctx, `
		SELECT file_data, file_name FROM export_jobs WHERE id = $1 AND status = 'ready'`, id).
		Scan(&data, &fileName)
	return data, fileName, err
}

func (r *ExportJobRepo) List(ctx context.Context, limit, offset int) ([]exportmodel.ExportJobSummary, error) {
	rows, err := r.db.Pool.Query(ctx, `
		SELECT id, type, format, status, vehicle_id, file_name, file_size, record_count,
		       error_message,
		       CASE WHEN completed_at IS NOT NULL
		            THEN EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000
		            ELSE NULL END AS duration_ms,
		       created_at, completed_at
		FROM export_jobs
		ORDER BY created_at DESC, id DESC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var jobs []exportmodel.ExportJobSummary
	for rows.Next() {
		var j exportmodel.ExportJobSummary
		if err := rows.Scan(&j.ID, &j.Type, &j.Format, &j.Status, &j.VehicleID,
			&j.FileName, &j.FileSize, &j.RecordCount, &j.ErrorMessage,
			&j.DurationMs, &j.CreatedAt, &j.CompletedAt); err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	if jobs == nil {
		jobs = []exportmodel.ExportJobSummary{}
	}
	return jobs, nil
}

// UpdateStatusAtomic atomically claims a job by updating its status only if it
// currently has the expected status. Returns true if the update was applied.
// This prevents duplicate processing when multiple workers subscribe to MQTT.
func (r *ExportJobRepo) UpdateStatusAtomic(ctx context.Context, id string, fromStatus, toStatus string) (bool, error) {
	tag, err := r.db.Pool.Exec(ctx, `
		UPDATE export_jobs SET status = $2, updated_at = $3
		WHERE id = $1 AND status = $4`,
		id, toStatus, time.Now().UTC(), fromStatus)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (r *ExportJobRepo) UpdateStatus(ctx context.Context, id string, status string) error {
	_, err := r.db.Pool.Exec(ctx, `
		UPDATE export_jobs SET status = $2, updated_at = $3 WHERE id = $1`,
		id, status, time.Now().UTC())
	return err
}

// Complete marks a job as ready with the result data.
func (r *ExportJobRepo) Complete(ctx context.Context, id string, fileName string, data []byte, recordCount int) error {
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx, `
		UPDATE export_jobs
		SET status = 'ready', file_name = $2, file_data = $3, file_size = $4,
		    record_count = $5, updated_at = $6, completed_at = $7
		WHERE id = $1`,
		id, fileName, data, int64(len(data)), recordCount, now, now)
	return err
}

// Fail marks a job as failed with an error message.
func (r *ExportJobRepo) Fail(ctx context.Context, id string, errMsg string) error {
	now := time.Now().UTC()
	_, err := r.db.Pool.Exec(ctx, `
		UPDATE export_jobs
		SET status = 'failed', error_message = $2, updated_at = $3, completed_at = $4
		WHERE id = $1`,
		id, errMsg, now, now)
	return err
}

// CleanupOld removes completed/failed jobs older than the given duration.
func (r *ExportJobRepo) CleanupOld(ctx context.Context, maxAge time.Duration) (int64, error) {
	cutoff := time.Now().UTC().Add(-maxAge)
	tag, err := r.db.Pool.Exec(ctx, `
		DELETE FROM export_jobs WHERE status IN ('ready', 'failed') AND created_at < $1`, cutoff)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
