package smartreadiness

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

type BackupChargingRepository interface {
	FindBackupConnectionID(context.Context, string) (int64, error)
	ListQualifiedBackupWatchVehicles(context.Context, string, *int64, time.Time, int) ([]int64, error)
	CreateBackupChargingWatch(context.Context, domain.BackupChargingWatch) error
	DeleteBackupChargingWatch(context.Context, string, int64, int64) error
	FindBackupChargingWatch(context.Context, string, int64) (*domain.BackupChargingWatch, error)
	FindActiveBackupChargingWatch(context.Context, string, int64, time.Time) (*domain.BackupChargingWatch, error)
	ClaimBackupChargingWatches(context.Context, time.Time, time.Time, int) ([]domain.BackupChargingWatch, error)
	RecordBackupChargingCheck(context.Context, domain.BackupChargingWatch, domain.BackupSiteReading, *domain.BackupChargingSample, time.Time) (bool, error)
}
