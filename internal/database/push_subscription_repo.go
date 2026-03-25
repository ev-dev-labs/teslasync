package database

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// PushSubscriptionRepo provides push subscription data access.
type PushSubscriptionRepo struct {
	db *DB
}

// NewPushSubscriptionRepo creates a new PushSubscriptionRepo.
func NewPushSubscriptionRepo(db *DB) *PushSubscriptionRepo {
	return &PushSubscriptionRepo{db: db}
}

// Upsert inserts or updates a push subscription by endpoint.
func (r *PushSubscriptionRepo) Upsert(ctx context.Context, sub *models.PushSubscription) error {
	now := time.Now().UTC()
	return r.db.Pool.QueryRow(ctx,
		`INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $4)
		 ON CONFLICT (endpoint) DO UPDATE SET p256dh=$2, auth=$3, updated_at=$4
		 RETURNING id`,
		sub.Endpoint, sub.P256dh, sub.Auth, now,
	).Scan(&sub.ID)
}

// DeleteByEndpoint removes a push subscription by its endpoint URL.
func (r *PushSubscriptionRepo) DeleteByEndpoint(ctx context.Context, endpoint string) error {
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint=$1`, endpoint)
	return err
}

// GetAll returns all push subscriptions.
func (r *PushSubscriptionRepo) GetAll(ctx context.Context) ([]*models.PushSubscription, error) {
	rows, err := r.db.Pool.Query(ctx,
		`SELECT id, endpoint, p256dh, auth, created_at, updated_at FROM push_subscriptions ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []*models.PushSubscription
	for rows.Next() {
		s := &models.PushSubscription{}
		if err := rows.Scan(&s.ID, &s.Endpoint, &s.P256dh, &s.Auth, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		subs = append(subs, s)
	}
	return subs, rows.Err()
}
