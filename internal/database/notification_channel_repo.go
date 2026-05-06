package database

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// NotificationChannelRepo is a focused, kind-specific repository for the
// per-CTI notification channel child tables.
//
// It complements (does NOT replace) [NotificationRepo], which still owns
// the cross-kind generic CRUD path. The Phase-46 / Prompt 37 webhook UI
// needs a typed read on the webhook-specific subset of fields without
// the round-trip through the [NotificationRepo.GetChannel] generic
// `Config map[string]string` shape, so this repo stays narrow:
// "give me the webhook config for this id, or tell me it's not a
// webhook channel".
type NotificationChannelRepo struct {
	db *DB
}

// NewNotificationChannelRepo constructs the focused per-kind channel
// repo around an existing *DB pool.
func NewNotificationChannelRepo(db *DB) *NotificationChannelRepo {
	return &NotificationChannelRepo{db: db}
}

// WebhookConfig is the typed view of a webhook-kind notification channel
// joined with its CTI child row in `notification_channel_webhook`.
//
// `Secret` is sourced from `notification_channel_webhook.bearer_token`.
// Phase-46 / Prompt 37 repurposes that column as the HMAC SHA-256 signing
// secret in the new webhook delivery path; the legacy
// [internal/api/notification_handler.sendWebhook] path doesn't read the
// column at all, so the semantic claim is non-breaking. A future
// migration could rename the column to `signing_secret` for clarity.
type WebhookConfig struct {
	ChannelID  int64
	Name       string
	Enabled    bool
	URL        string
	HTTPMethod string
	Secret     string
}

// ErrChannelNotFound is returned by [NotificationChannelRepo.GetWebhookConfig]
// when no row exists for the requested id, OR when a row exists but
// its `kind` is not "webhook". The handler maps both cases to HTTP
// 404 so an attacker can't probe channel existence by kind.
var ErrChannelNotFound = errors.New("notification_channel: not found")

// GetWebhookConfig reads the typed webhook configuration for the given
// channel id. Returns [ErrChannelNotFound] when the row is missing or
// not of kind=webhook. All other errors propagate as wrapped pgx
// errors.
//
// The query joins `notification_channels` with
// `notification_channel_webhook` so we get name+enabled together with
// url+http_method+bearer_token in a single round trip. A LEFT JOIN
// would let us distinguish "kind=webhook with no child row" from
// "wrong kind", but the schema enforces a 1:1 between parent and
// child via [internal/database.NotificationRepo.upsertChannelConfig],
// so an INNER JOIN that filters on kind='webhook' is sufficient.
func (r *NotificationChannelRepo) GetWebhookConfig(ctx context.Context, channelID int64) (*WebhookConfig, error) {
	var (
		cfg         WebhookConfig
		bearerToken *string
	)
	err := r.db.Pool.QueryRow(ctx, `
		SELECT c.id, c.name, c.enabled, w.url, w.http_method, w.bearer_token
		FROM notification_channels c
		JOIN notification_channel_webhook w ON w.channel_id = c.id
		WHERE c.id = $1 AND c.kind = $2
	`, channelID, string(models.ChannelWebhook)).Scan(
		&cfg.ChannelID, &cfg.Name, &cfg.Enabled, &cfg.URL, &cfg.HTTPMethod, &bearerToken,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrChannelNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("query webhook config: %w", err)
	}
	if bearerToken != nil {
		cfg.Secret = *bearerToken
	}
	return &cfg, nil
}
