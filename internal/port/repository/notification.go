package repository

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
)

// NotificationRepository defines the persistence interface for notifications.
type NotificationRepository interface {
	GetByID(ctx context.Context, id string) (*notification.Notification, error)
	GetByUserID(ctx context.Context, userID string) ([]notification.Notification, error)
	GetPending(ctx context.Context, limit int) ([]notification.Notification, error)
	Save(ctx context.Context, n *notification.Notification) error
	GetByIDForUpdate(ctx context.Context, id string) (*notification.Notification, error)
}
