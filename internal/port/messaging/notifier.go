package messaging

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
)

// Notifier defines the interface for sending notifications to users.
type Notifier interface {
	SendPush(ctx context.Context, userID string, n *notification.Notification) error
	SendEmail(ctx context.Context, userID string, n *notification.Notification) error
}
