// Package safety implements pre-execution safety checks for automations.
package safety

import (
	"context"
	"fmt"
	"strings"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/notification"
)

// ChannelLoader loads enabled notification channels.
// Implementations should return only enabled channels.
type ChannelLoader interface {
	GetAllChannels(ctx context.Context) ([]*notificationmodel.NotificationChannel, error)
}

// NotifySender dispatches a single notification request.
// The default implementation is notification.Send.
type NotifySender func(req *notification.Request) error

// FailureEvent captures the full context of an automation execution failure.
// All fields are optional except AutomationID and AutomationName; the alerter
// formats only the fields that are populated.
type FailureEvent struct {
	AutomationID       int64     `json:"automation_id"`
	AutomationName     string    `json:"automation_name"`
	TriggerType        string    `json:"trigger_type,omitempty"`
	FailedActionIndex  int       `json:"failed_action_index"`
	FailedActionType   string    `json:"failed_action_type,omitempty"`
	Error              string    `json:"error,omitempty"`
	RetryCount         int       `json:"retry_count"`
	AutoDisabled       bool      `json:"auto_disabled"`
	AutoDisabledReason string    `json:"auto_disabled_reason,omitempty"`
	Timestamp          time.Time `json:"timestamp"`
}

// FailureAlerter sends failure notifications to all enabled notification
// channels. It is separate from the notify_on_run setting — failure alerts
// are always dispatched when the caller decides to send them (typically when
// automation.NotifyOnFailure is true).
//
// Error semantics:
//   - Returns nil if at least one channel received the alert successfully.
//   - Returns an error if channels cannot be loaded, no channels are enabled,
//     or every channel delivery fails. This lets callers (e.g. AutoDisableChecker)
//     accurately track whether any notification was actually delivered.
type FailureAlerter struct {
	channels ChannelLoader
	sender   NotifySender
	logger   zerolog.Logger
}

// FailureAlerterOption configures a FailureAlerter.
type FailureAlerterOption func(*FailureAlerter)

// NewFailureAlerter creates a FailureAlerter that loads channels from the
// given ChannelLoader and dispatches via the sender. If sender is nil,
// notification.Send is used as the default.
func NewFailureAlerter(channels ChannelLoader, sender NotifySender, opts ...FailureAlerterOption) *FailureAlerter {
	if sender == nil {
		sender = func(req *notification.Request) error {
			return notification.Send(req)
		}
	}
	fa := &FailureAlerter{
		channels: channels,
		sender:   sender,
		logger: log.With().
			Str("component", "failure_alerter").
			Logger(),
	}
	for _, opt := range opts {
		opt(fa)
	}
	return fa
}

// Send dispatches a failure alert to all enabled notification channels.
//
// Returns nil if at least one channel succeeds. Returns an error if:
//   - loading channels fails
//   - no enabled channels exist
//   - all channel deliveries fail
//   - context is cancelled before any dispatch
func (fa *FailureAlerter) Send(ctx context.Context, event FailureEvent) error {
	if ctx.Err() != nil {
		return fmt.Errorf("failure alert for automation %d: %w", event.AutomationID, ctx.Err())
	}

	allChannels, err := fa.channels.GetAllChannels(ctx)
	if err != nil {
		return fmt.Errorf("load notification channels for failure alert: %w", err)
	}

	// Filter to only enabled channels.
	var enabled []*notificationmodel.NotificationChannel
	for _, ch := range allChannels {
		if ch.Enabled {
			enabled = append(enabled, ch)
		}
	}

	if len(enabled) == 0 {
		return fmt.Errorf("no enabled notification channels for failure alert (automation %d)", event.AutomationID)
	}

	title := fa.formatTitle(event)
	message := fa.formatMessage(event)

	var (
		successes int
		lastErr   error
	)

	for _, ch := range enabled {
		if ctx.Err() != nil {
			fa.logger.Warn().
				Int64("automation_id", event.AutomationID).
				Msg("context cancelled during failure alert dispatch")
			break
		}

		req := &notification.Request{
			ChannelType: ch.Type,
			Config:      ch.Config,
			Title:       title,
			Message:     message,
			ChannelID:   ch.ID,
		}

		if sendErr := fa.sender(req); sendErr != nil {
			lastErr = sendErr
			fa.logger.Warn().Err(sendErr).
				Int64("automation_id", event.AutomationID).
				Str("automation_name", event.AutomationName).
				Int64("channel_id", ch.ID).
				Str("channel_type", ch.Type).
				Msg("failure alert delivery failed on channel")
		} else {
			successes++
			fa.logger.Info().
				Int64("automation_id", event.AutomationID).
				Str("automation_name", event.AutomationName).
				Int64("channel_id", ch.ID).
				Str("channel_type", ch.Type).
				Msg("failure alert delivered")
		}
	}

	if successes > 0 {
		return nil
	}

	if lastErr != nil {
		return fmt.Errorf("all %d notification channels failed for failure alert (automation %d): %w",
			len(enabled), event.AutomationID, lastErr)
	}

	// Context was cancelled before any sends completed.
	return fmt.Errorf("failure alert for automation %d: %w", event.AutomationID, ctx.Err())
}

func (fa *FailureAlerter) formatTitle(event FailureEvent) string {
	if event.AutoDisabled {
		return fmt.Sprintf("🛑 Automation Disabled: %s", event.AutomationName)
	}
	return fmt.Sprintf("⚠️ Automation Failed: %s", event.AutomationName)
}

func (fa *FailureAlerter) formatMessage(event FailureEvent) string {
	var b strings.Builder

	b.WriteString(fmt.Sprintf("Automation: %s (ID: %d)\n", event.AutomationName, event.AutomationID))

	if event.TriggerType != "" {
		b.WriteString(fmt.Sprintf("Trigger: %s\n", event.TriggerType))
	}

	if event.FailedActionType != "" {
		b.WriteString(fmt.Sprintf("Failed Action: %s (step %d)\n", event.FailedActionType, event.FailedActionIndex+1))
	}

	if event.Error != "" {
		b.WriteString(fmt.Sprintf("Error: %s\n", event.Error))
	}

	if event.RetryCount > 0 {
		b.WriteString(fmt.Sprintf("Retries: %d\n", event.RetryCount))
	}

	if event.AutoDisabled {
		b.WriteString("Status: AUTO-DISABLED\n")
		if event.AutoDisabledReason != "" {
			b.WriteString(fmt.Sprintf("Reason: %s\n", event.AutoDisabledReason))
		}
	}

	if !event.Timestamp.IsZero() {
		b.WriteString(fmt.Sprintf("Time: %s\n", event.Timestamp.Format(time.RFC3339)))
	}

	return b.String()
}

// failureAlerterNotifier adapts FailureAlerter to the Notifier interface
// used by AutoDisableChecker. Since NotifyAutoDisabled has limited context
// (only ID, name, reason), the adapter constructs a minimal FailureEvent
// with AutoDisabled=true.
type failureAlerterNotifier struct {
	alerter *FailureAlerter
}

// AsNotifier returns a Notifier adapter backed by this FailureAlerter.
// Use this to wire the alerter into AutoDisableChecker:
//
//	checker := NewAutoDisableChecker(disabler, WithNotifier(alerter.AsNotifier()))
func (fa *FailureAlerter) AsNotifier() Notifier {
	return &failureAlerterNotifier{alerter: fa}
}

func (n *failureAlerterNotifier) NotifyAutoDisabled(ctx context.Context, automationID int64, automationName, reason string) error {
	return n.alerter.Send(ctx, FailureEvent{
		AutomationID:       automationID,
		AutomationName:     automationName,
		AutoDisabled:       true,
		AutoDisabledReason: reason,
		Timestamp:          time.Now().UTC(),
	})
}
