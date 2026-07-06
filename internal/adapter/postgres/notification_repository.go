package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ev-dev-labs/teslasync/internal/adapter/postgres/queries"
	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

type notificationRepository struct {
	pool pgxPool
}

func NewNotificationRepository(pool *pgxpool.Pool) repository.NotificationRepository {
	return &notificationRepository{pool: pool}
}

func (r *notificationRepository) GetByID(ctx context.Context, id string) (*notification.Notification, error) {
	var n notification.Notification
	err := r.pool.QueryRow(ctx, queries.GetNotificationByID, id).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.FSMState, &n.Channel,
		&n.FailedReason, &n.RetryCount, &n.CreatedAt, &n.SentAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("notification %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning notification %s: %w", id, err)
	}
	return &n, nil
}

func (r *notificationRepository) GetByUserID(ctx context.Context, userID string) ([]notification.Notification, error) {
	rows, err := r.pool.Query(ctx, queries.GetNotificationsByUserID, userID)
	if err != nil {
		return nil, fmt.Errorf("querying notifications for user %s: %w", userID, err)
	}
	notifications, err := pgx.CollectRows(rows, pgx.RowToStructByName[notification.Notification])
	if err != nil {
		return nil, fmt.Errorf("collecting notifications for user %s: %w", userID, err)
	}
	return notifications, nil
}

func (r *notificationRepository) GetPending(ctx context.Context, limit int) ([]notification.Notification, error) {
	rows, err := r.pool.Query(ctx, queries.GetPendingNotifications, limit)
	if err != nil {
		return nil, fmt.Errorf("querying pending notifications: %w", err)
	}
	notifications, err := pgx.CollectRows(rows, pgx.RowToStructByName[notification.Notification])
	if err != nil {
		return nil, fmt.Errorf("collecting pending notifications: %w", err)
	}
	return notifications, nil
}

func (r *notificationRepository) GetByIDForUpdate(ctx context.Context, id string) (*notification.Notification, error) {
	var n notification.Notification
	err := r.pool.QueryRow(ctx, queries.GetNotificationByIDForUpdate, id).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Body, &n.FSMState, &n.Channel,
		&n.FailedReason, &n.RetryCount, &n.CreatedAt, &n.SentAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("notification %s: %w", id, domain.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning notification %s: %w", id, err)
	}
	return &n, nil
}

func (r *notificationRepository) Save(ctx context.Context, n *notification.Notification) error {
	_, err := r.pool.Exec(ctx, queries.UpsertNotification,
		n.ID, n.UserID, n.Type, n.Title, n.Body, n.FSMState, n.Channel,
		n.FailedReason, n.RetryCount, n.CreatedAt, n.SentAt,
	)
	if err != nil {
		return fmt.Errorf("saving notification %s: %w", n.ID, err)
	}
	return nil
}
