package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type exportRepository struct {
	pool pgxPool
}

func NewExportJobRepository(pool *pgxpool.Pool) repository.ExportJobRepository {
	return &exportRepository{pool: pool}
}

func (r *exportRepository) GetByID(ctx context.Context, id string) (*export.ExportJob, error) {
	var j export.ExportJob
	err := r.pool.QueryRow(ctx, queries.GetExportJobByID, id).Scan(
		&j.ID, &j.UserID, &j.Format, &j.VehicleID, &j.DateFrom, &j.DateTo,
		&j.FSMState, &j.FilePath, &j.FileSize, &j.FailedReason, &j.CreatedAt, &j.CompletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("export job %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning export job %s: %w", id, err)
	}
	return &j, nil
}

func (r *exportRepository) GetByUserID(ctx context.Context, userID string) ([]export.ExportJob, error) {
	rows, err := r.pool.Query(ctx, queries.GetExportJobsByUserID, userID)
	if err != nil {
		return nil, fmt.Errorf("querying export jobs for user %s: %w", userID, err)
	}
	jobs, err := pgx.CollectRows(rows, pgx.RowToStructByName[export.ExportJob])
	if err != nil {
		return nil, fmt.Errorf("collecting export jobs for user %s: %w", userID, err)
	}
	return jobs, nil
}

func (r *exportRepository) GetByIDForUpdate(ctx context.Context, id string) (*export.ExportJob, error) {
	var j export.ExportJob
	err := r.pool.QueryRow(ctx, queries.GetExportJobByIDForUpdate, id).Scan(
		&j.ID, &j.UserID, &j.Format, &j.VehicleID, &j.DateFrom, &j.DateTo,
		&j.FSMState, &j.FilePath, &j.FileSize, &j.FailedReason, &j.CreatedAt, &j.CompletedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("export job %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning export job %s: %w", id, err)
	}
	return &j, nil
}

func (r *exportRepository) Save(ctx context.Context, j *export.ExportJob) error {
	_, err := r.pool.Exec(ctx, queries.UpsertExportJob,
		j.ID, j.UserID, j.Format, j.VehicleID, j.DateFrom, j.DateTo,
		j.FSMState, j.FilePath, j.FileSize, j.FailedReason, j.CreatedAt, j.CompletedAt,
	)
	if err != nil {
		return fmt.Errorf("saving export job %s: %w", j.ID, err)
	}
	return nil
}
