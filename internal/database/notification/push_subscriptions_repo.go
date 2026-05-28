package notification

import (
	"context"
	"errors"
	"fmt"

	"github.com/ev-dev-labs/teslasync/internal/database"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// PushSubscriptionsRepo is the data-access layer for the
// `push_subscriptions` table introduced by migration 000165
// (Phase 40 / Prompt 52).
//
// Like saved_views and pinned_items, the repo accepts a `*int64` user
// scope (NULL meaning the install-wide bucket) rather than enforcing a
// non-zero user id, because the install is single-user today.
type PushSubscriptionsRepo struct {
	db *database.DB
}

func NewPushSubscriptionsRepo(db *database.DB) *PushSubscriptionsRepo {
	return &PushSubscriptionsRepo{db: db}
}

// Upsert inserts a subscription, or refreshes p256dh / auth / user_agent /
// last_used_at when the (user, endpoint) tuple already exists. The browser
// occasionally rotates p256dh / auth on a previously-saved endpoint so the
// upsert path must keep the new keys, otherwise the next push fails to
// decrypt and the subscription is wrongly pruned.
//
// The id, created_at, and last_used_at fields on `s` are populated on
// success.
func (r *PushSubscriptionsRepo) Upsert(ctx context.Context, s *models.PushSubscription) error {
	const query = `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at)
		VALUES ($1, $2, $3, $4, $5, NULL)
		ON CONFLICT (COALESCE(user_id, 0), endpoint)
		DO UPDATE SET
		    p256dh     = EXCLUDED.p256dh,
		    auth       = EXCLUDED.auth,
		    user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent)
		RETURNING id, created_at, last_used_at`
	if err := r.db.Pool.QueryRow(ctx, query,
		s.UserID, s.Endpoint, s.P256DH, s.Auth, s.UserAgent,
	).Scan(&s.ID, &s.CreatedAt, &s.LastUsedAt); err != nil {
		return fmt.Errorf("push_subscriptions upsert: %w", err)
	}
	return nil
}

// ListAll returns every subscription in the table, oldest first. Used by
// the notification worker's webpush fan-out in single-user mode where
// every notification reaches every registered device.
func (r *PushSubscriptionsRepo) ListAll(ctx context.Context) ([]*models.PushSubscription, error) {
	const query = `
		SELECT id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_used_at
		FROM push_subscriptions
		ORDER BY id ASC`
	return r.queryRows(ctx, query)
}

// ListForUser returns every subscription belonging to one user (NULL ==
// the install-wide bucket today). Reserved for the multi-tenant future;
// the handler already calls it with userID==nil so the wiring is in
// place.
func (r *PushSubscriptionsRepo) ListForUser(ctx context.Context, userID *int64) ([]*models.PushSubscription, error) {
	const query = `
		SELECT id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_used_at
		FROM push_subscriptions
		WHERE COALESCE(user_id, 0) = COALESCE($1, 0)
		ORDER BY id ASC`
	return r.queryRows(ctx, query, userID)
}

// DeleteByEndpoint removes a subscription by its endpoint (the unique
// stable identifier returned by PushManager.subscribe()). Returns
// pgx.ErrNoRows when no subscription matched so callers can return 404.
//
// Called both from the unsubscribe HTTP path and from the webpush sender
// when the upstream push service returns 404 / 410 (the subscription is
// dead and must not be retried).
func (r *PushSubscriptionsRepo) DeleteByEndpoint(ctx context.Context, userID *int64, endpoint string) error {
	const query = `
		DELETE FROM push_subscriptions
		WHERE COALESCE(user_id, 0) = COALESCE($1, 0)
		  AND endpoint = $2`
	tag, err := r.db.Pool.Exec(ctx, query, userID, endpoint)
	if err != nil {
		return fmt.Errorf("push_subscriptions delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// DeleteByEndpointAny removes a subscription matching the endpoint
// regardless of user. Used by the webpush sender on 404/410 responses
// where it does not necessarily know the owning user (and where the
// endpoint is globally unique anyway — the push service URL embeds
// per-subscription tokens).
func (r *PushSubscriptionsRepo) DeleteByEndpointAny(ctx context.Context, endpoint string) error {
	const query = `DELETE FROM push_subscriptions WHERE endpoint = $1`
	_, err := r.db.Pool.Exec(ctx, query, endpoint)
	if err != nil {
		return fmt.Errorf("push_subscriptions delete-any: %w", err)
	}
	return nil
}

// Touch updates last_used_at to now() for the given endpoint. Best-effort:
// failures are logged by the caller but never break the push path.
func (r *PushSubscriptionsRepo) Touch(ctx context.Context, endpoint string) error {
	const query = `UPDATE push_subscriptions SET last_used_at = now() WHERE endpoint = $1`
	_, err := r.db.Pool.Exec(ctx, query, endpoint)
	if err != nil {
		return fmt.Errorf("push_subscriptions touch: %w", err)
	}
	return nil
}

// CountAll returns the total number of subscriptions across all users.
// Used by the public-key endpoint and admin diagnostics.
func (r *PushSubscriptionsRepo) CountAll(ctx context.Context) (int64, error) {
	var n int64
	if err := r.db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM push_subscriptions`).Scan(&n); err != nil {
		return 0, fmt.Errorf("push_subscriptions count: %w", err)
	}
	return n, nil
}

func (r *PushSubscriptionsRepo) queryRows(ctx context.Context, query string, args ...any) ([]*models.PushSubscription, error) {
	rows, err := r.db.Pool.Query(ctx, query, args...)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("push_subscriptions query: %w", err)
	}
	defer rows.Close()
	var out []*models.PushSubscription
	for rows.Next() {
		s := &models.PushSubscription{}
		if scanErr := rows.Scan(
			&s.ID, &s.UserID, &s.Endpoint, &s.P256DH, &s.Auth,
			&s.UserAgent, &s.CreatedAt, &s.LastUsedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("push_subscriptions scan: %w", scanErr)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("push_subscriptions iter: %w", err)
	}
	return out, nil
}
