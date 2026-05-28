package trigger

import (
	"context"
	"fmt"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// WebhookRepo is the subset of dbauto.AutomationRepo needed by WebhookTrigger.
type WebhookRepo interface {
	GetByWebhookToken(ctx context.Context, token string) (*models.AutomationFull, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// WebhookTrigger keeps the public receiver route stable. Phase 36 has no typed
// webhook CTI kind, so requests cannot create or execute automations.
type WebhookTrigger struct {
	repo   WebhookRepo
	engine AutomationEngine
	logger zerolog.Logger
}

// NewWebhookTrigger creates a new webhook trigger processor.
func NewWebhookTrigger(repo WebhookRepo, engine AutomationEngine) *WebhookTrigger {
	return &WebhookTrigger{
		repo:   repo,
		engine: engine,
		logger: log.With().
			Str("component", "webhook_trigger").
			Logger(),
	}
}

// HandleWebhook processes an incoming webhook request.
// Called by the API handler when POST /automations/webhook/{token} is hit.
func (t *WebhookTrigger) HandleWebhook(ctx context.Context, token string, payload []byte, signature string, remoteIP string) error {
	if token == "" {
		return fmt.Errorf("webhook token is required")
	}

	// Look up automation by webhook_token.
	automation, err := t.repo.GetByWebhookToken(ctx, token)
	if err != nil {
		return fmt.Errorf("lookup automation by webhook token: %w", err)
	}
	if automation == nil {
		return ErrWebhookNotFound
	}

	t.logger.Warn().
		Int64("automation_id", automation.ID).
		Str("automation", automation.Name).
		Str("remote_ip", remoteIP).
		Msg("webhook trigger kind is unavailable in typed automation runtime")
	return ErrWebhookNotFound
}

// Sentinel errors for webhook processing.
var (
	ErrWebhookNotFound         = fmt.Errorf("webhook automation not found")
	ErrWebhookSignatureInvalid = fmt.Errorf("webhook signature validation failed")
)
