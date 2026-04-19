package trigger

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// WebhookRepo is the subset of database.AutomationRepo needed by WebhookTrigger.
type WebhookRepo interface {
	GetByWebhookToken(ctx context.Context, token string) (*models.Automation, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// WebhookConfig represents the parsed trigger_config for webhook automations.
type WebhookConfig struct {
	WebhookToken  string  `json:"webhook_token"`
	Secret        *string `json:"secret"`         // optional HMAC-SHA256 secret
	PayloadFilter *string `json:"payload_filter"` // reserved for future use
}

// webhookSnapshot is the JSON payload passed to engine.Evaluate when a webhook fires.
type webhookSnapshot struct {
	WebhookToken string          `json:"webhook_token"`
	Payload      json.RawMessage `json:"payload"`
	RemoteIP     string          `json:"remote_ip"`
}

// WebhookTrigger processes incoming webhook requests and fires matching automations.
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

	// Check automation is enabled.
	if !automation.Enabled || automation.AutoDisabled {
		t.logger.Warn().
			Int64("automation_id", automation.ID).
			Str("automation", automation.Name).
			Bool("enabled", automation.Enabled).
			Bool("auto_disabled", automation.AutoDisabled).
			Msg("webhook received for disabled automation")
		return ErrWebhookNotFound
	}

	// Parse trigger config for secret validation.
	cfg, err := parseWebhookConfig(automation.TriggerConfig)
	if err != nil {
		t.logger.Warn().Err(err).
			Int64("automation_id", automation.ID).
			Str("automation", automation.Name).
			Msg("invalid webhook trigger config, auto-disabling")
		if disableErr := t.repo.SetAutoDisabled(ctx, automation.ID, fmt.Sprintf("invalid webhook config: %v", err)); disableErr != nil {
			t.logger.Error().Err(disableErr).
				Int64("automation_id", automation.ID).
				Msg("failed to auto-disable invalid automation")
		}
		return fmt.Errorf("invalid webhook config: %w", err)
	}

	// Validate HMAC signature if secret is configured.
	if cfg.Secret != nil && *cfg.Secret != "" {
		if !validateHMAC(payload, signature, *cfg.Secret) {
			t.logger.Warn().
				Int64("automation_id", automation.ID).
				Str("automation", automation.Name).
				Msg("webhook HMAC signature validation failed")
			return ErrWebhookSignatureInvalid
		}
	}

	// Validate payload is valid JSON (if non-empty).
	var rawPayload json.RawMessage
	if len(payload) > 0 {
		if !json.Valid(payload) {
			return fmt.Errorf("webhook payload is not valid JSON")
		}
		rawPayload = payload
	} else {
		rawPayload = json.RawMessage(`{}`)
	}

	// Build trigger snapshot.
	snapshot, err := json.Marshal(webhookSnapshot{
		WebhookToken: token,
		Payload:      rawPayload,
		RemoteIP:     remoteIP,
	})
	if err != nil {
		t.logger.Error().Err(err).
			Int64("automation_id", automation.ID).
			Msg("failed to marshal webhook trigger snapshot")
		return fmt.Errorf("marshal webhook snapshot: %w", err)
	}

	t.logger.Info().
		Int64("automation_id", automation.ID).
		Str("automation", automation.Name).
		Str("remote_ip", remoteIP).
		Msg("webhook trigger fired")

	if evalErr := t.engine.Evaluate(ctx, automation.ID, snapshot); evalErr != nil {
		t.logger.Error().Err(evalErr).
			Int64("automation_id", automation.ID).
			Str("automation", automation.Name).
			Msg("automation evaluation failed")
		return fmt.Errorf("evaluate automation %d: %w", automation.ID, evalErr)
	}

	return nil
}

// Sentinel errors for webhook processing.
var (
	ErrWebhookNotFound        = fmt.Errorf("webhook automation not found")
	ErrWebhookSignatureInvalid = fmt.Errorf("webhook signature validation failed")
)

// validateHMAC checks the HMAC-SHA256 signature of the payload.
// The expected signature format is a hex-encoded HMAC-SHA256 hash.
func validateHMAC(payload []byte, signature, secret string) bool {
	if signature == "" {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	expected := hex.EncodeToString(mac.Sum(nil))

	return hmac.Equal([]byte(expected), []byte(signature))
}

// parseWebhookConfig unmarshals and validates the trigger_config JSON.
func parseWebhookConfig(raw json.RawMessage) (*WebhookConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg WebhookConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}
	if cfg.WebhookToken == "" {
		return nil, fmt.Errorf("webhook_token is required")
	}
	return &cfg, nil
}
