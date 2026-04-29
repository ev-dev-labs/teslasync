package action

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
)

// validNotifyChannels lists the channel values accepted by notify actions.
var validNotifyChannels = map[string]bool{
	"all":      true,
	"discord":  true,
	"slack":    true,
	"telegram": true,
	"email":    true,
	"webhook":  true,
	"ntfy":     true,
	"pushover": true,
}

// ChannelRepo is the subset of database.NotificationRepo needed by NotifyExecutor.
type ChannelRepo interface {
	GetAllChannels(ctx context.Context) ([]*models.NotificationChannel, error)
}

// NotifySender abstracts notification delivery for testability.
type NotifySender func(req *notification.Request) error

// NotifyConfig represents the parsed action config for notify actions.
type NotifyConfig struct {
	Type    string            `json:"type"`    // "notify"
	Channel string            `json:"channel"` // "all", "discord", "slack", etc.
	Message string            `json:"message"` // template with {{var}} placeholders
	Title   string            `json:"title"`   // optional title template
	Vars    map[string]string `json:"vars"`    // caller-supplied template variables
}

// NotifyDetail captures the outcome for a single notification channel.
type NotifyDetail struct {
	ChannelID   int64  `json:"channel_id"`
	ChannelName string `json:"channel_name"`
	ChannelType string `json:"channel_type"`
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
}

// NotifyResult captures the outcome of a notification action.
type NotifyResult struct {
	ChannelsSent   int            `json:"channels_sent"`
	ChannelsFailed int            `json:"channels_failed"`
	Details        []NotifyDetail `json:"details"`
}

// NotifyExecutor sends notifications via configured channels as an automation action.
type NotifyExecutor struct {
	channelRepo ChannelRepo
	vehicleRepo VehicleRepo
	sender      NotifySender
	logger      zerolog.Logger
}

// NewNotifyExecutor creates a notify action executor.
// If sender is nil, notification.Send is used as the default.
func NewNotifyExecutor(channelRepo ChannelRepo, vehicleRepo VehicleRepo, sender NotifySender) *NotifyExecutor {
	if sender == nil {
		sender = func(req *notification.Request) error {
			return notification.Send(req)
		}
	}
	return &NotifyExecutor{
		channelRepo: channelRepo,
		vehicleRepo: vehicleRepo,
		sender:      sender,
		logger: log.With().
			Str("component", "notify_action").
			Logger(),
	}
}

// DecodeNotifySpec unmarshals and validates a notify action config.
func DecodeNotifySpec(raw json.RawMessage) (*NotifyConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("action config is empty")
	}

	var cfg NotifyConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal notify action config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "notify" {
		return nil, fmt.Errorf("expected type \"notify\", got %q", cfg.Type)
	}

	if cfg.Channel == "" {
		return nil, fmt.Errorf("channel is required")
	}

	if !validNotifyChannels[cfg.Channel] {
		return nil, fmt.Errorf("unsupported channel %q", cfg.Channel)
	}

	if cfg.Message == "" {
		return nil, fmt.Errorf("message is required")
	}

	return &cfg, nil
}

var ParseNotifyConfig = DecodeNotifySpec

// Execute runs the notify action: resolves templates, loads matching channels,
// and dispatches notifications. Returns a JSON NotifyResult and a summary error
// if any channels failed.
func (e *NotifyExecutor) Execute(ctx context.Context, vehicleID *int64, raw json.RawMessage) (json.RawMessage, error) {
	cfg, err := DecodeNotifySpec(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid notify action config: %w", err)
	}
	return e.executeNotifyConfig(ctx, vehicleID, cfg)
}

// ExecuteTyped runs an action_notify CTI child without decoding legacy action
// wrappers. The typed row references one configured notification channel.
func (e *NotifyExecutor) ExecuteTyped(ctx context.Context, vehicleID *int64, payload any) (json.RawMessage, error) {
	action, ok := payload.(*models.AutomationStepActionNotify)
	if !ok {
		return nil, fmt.Errorf("notify action payload type %T is not *models.AutomationStepActionNotify", payload)
	}
	cfg := &NotifyConfig{
		Type:    "notify",
		Channel: fmt.Sprintf("id:%d", action.ChannelID),
		Message: action.Template,
	}
	if action.ChannelID <= 0 {
		return nil, fmt.Errorf("channel_id is required")
	}
	if action.Template == "" {
		return nil, fmt.Errorf("template is required")
	}
	return e.executeNotifyConfig(ctx, vehicleID, cfg)
}

func (e *NotifyExecutor) executeNotifyConfig(ctx context.Context, vehicleID *int64, cfg *NotifyConfig) (json.RawMessage, error) {
	// Build template variables from context.
	vars := e.buildVars(ctx, vehicleID, cfg.Vars)

	title := resolveTemplate(cfg.Title, vars)
	message := resolveTemplate(cfg.Message, vars)

	// Load enabled notification channels matching the requested type.
	channels, err := e.channelRepo.GetAllChannels(ctx)
	if err != nil {
		return nil, fmt.Errorf("load notification channels: %w", err)
	}

	matched := filterChannels(channels, cfg.Channel)
	if len(matched) == 0 {
		result := NotifyResult{Details: []NotifyDetail{}}
		resultJSON, _ := json.Marshal(result)
		return resultJSON, fmt.Errorf("no enabled notification channels match %q", cfg.Channel)
	}

	// Dispatch to each matched channel.
	result := NotifyResult{Details: make([]NotifyDetail, 0, len(matched))}

	for _, ch := range matched {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("context cancelled during notification dispatch: %w", ctx.Err())
		}

		detail := NotifyDetail{
			ChannelID:   ch.ID,
			ChannelName: ch.Name,
			ChannelType: ch.Type,
		}

		req := &notification.Request{
			ChannelType: ch.Type,
			Config:      ch.Config,
			Title:       title,
			Message:     message,
			ChannelID:   ch.ID,
		}

		if sendErr := e.sender(req); sendErr != nil {
			detail.Error = sendErr.Error()
			result.ChannelsFailed++

			e.logger.Warn().Err(sendErr).
				Int64("channel_id", ch.ID).
				Str("channel_name", ch.Name).
				Str("channel_type", ch.Type).
				Msg("notify action delivery failed")
		} else {
			detail.Success = true
			result.ChannelsSent++

			e.logger.Info().
				Int64("channel_id", ch.ID).
				Str("channel_name", ch.Name).
				Str("channel_type", ch.Type).
				Msg("notify action delivered")
		}

		result.Details = append(result.Details, detail)
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("marshal notify result: %w", err)
	}

	if result.ChannelsFailed > 0 {
		return resultJSON, fmt.Errorf("%d of %d notification channels failed",
			result.ChannelsFailed, result.ChannelsSent+result.ChannelsFailed)
	}

	return resultJSON, nil
}

// buildVars constructs the template variable map from the execution context
// and any caller-supplied overrides.
func (e *NotifyExecutor) buildVars(ctx context.Context, vehicleID *int64, extra map[string]string) map[string]string {
	vars := make(map[string]string)

	// Resolve vehicle name if a vehicle ID is available.
	if vehicleID != nil {
		if v, err := e.vehicleRepo.GetByID(ctx, *vehicleID); err == nil && v != nil {
			vars["vehicle"] = v.DisplayName
		}
	}

	vars["timestamp"] = time.Now().UTC().Format(time.RFC3339)

	// Caller-supplied variables (e.g., name, status, trigger, error, battery_level)
	// override auto-resolved ones.
	for k, v := range extra {
		vars[k] = v
	}

	return vars
}

// resolveTemplate replaces {{key}} placeholders with values from vars.
// Unresolved placeholders are left as-is.
func resolveTemplate(tmpl string, vars map[string]string) string {
	for k, v := range vars {
		tmpl = strings.ReplaceAll(tmpl, "{{"+k+"}}", v)
	}
	return tmpl
}

// filterChannels returns enabled channels matching the requested channel filter.
// "all" matches every enabled channel; a specific type matches only that type.
func filterChannels(channels []*models.NotificationChannel, filter string) []*models.NotificationChannel {
	var matched []*models.NotificationChannel
	if strings.HasPrefix(filter, "id:") {
		id, err := strconv.ParseInt(strings.TrimPrefix(filter, "id:"), 10, 64)
		if err != nil {
			return matched
		}
		for _, ch := range channels {
			if ch.Enabled && ch.ID == id {
				matched = append(matched, ch)
			}
		}
		return matched
	}
	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}
		if filter == "all" || ch.Type == filter {
			matched = append(matched, ch)
		}
	}
	return matched
}
