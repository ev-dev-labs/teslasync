package repository

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/export"
)

// ExportJobRepository defines the persistence interface for export jobs.
type ExportJobRepository interface {
	GetByID(ctx context.Context, id string) (*export.ExportJob, error)
	GetByUserID(ctx context.Context, userID string) ([]export.ExportJob, error)
	Save(ctx context.Context, job *export.ExportJob) error
	GetByIDForUpdate(ctx context.Context, id string) (*export.ExportJob, error)
}
