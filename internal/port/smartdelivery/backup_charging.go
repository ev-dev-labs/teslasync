package smartdelivery

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
)

type BackupRef struct {
	Subject     string
	WatchID     int64
	VehicleID   int64
	DeviceID    int64
	ConsentedAt time.Time
	OutageStart time.Time
	ObservedAt  time.Time
	ExpiresAt   time.Time
}

type BackupLease interface {
	Ciphertext() string
	Reserve(ctx context.Context, hash []byte, now, expiresAt time.Time) (bool, error)
	Finish(ctx context.Context, hash []byte, status domain.DeliveryStatus) error
	Close(ctx context.Context) error
}

type BackupRepository interface {
	LockBackupDelivery(context.Context, BackupRef, time.Time) (BackupLease, error)
	FindBackupDelivery(context.Context, string, []byte, time.Time) (*BackupRef, error)
	ConsumeBackupDelivery(ctx context.Context, ref BackupRef, hash []byte, deadline time.Time, clock func() time.Time) (*domain.Notification, error)
	PruneBackupDeliveries(context.Context, time.Time) error
}
