// Package safety implements pre-execution safety checks for automations.
package safety

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// DefaultDisableThreshold is the number of consecutive failures after which
// an automation is auto-disabled. The threshold represents complete execution
// runs that ended in failure (gave_up), not individual retry attempts.
const DefaultDisableThreshold = 5

// ─── Notifier Interface ────────────────────────────────

// Notifier delivers notifications when an automation is auto-disabled.
// Implementations should be non-blocking or have their own timeout;
// failures are logged but do not prevent the disable operation.
type Notifier interface {
	NotifyAutoDisabled(ctx context.Context, automationID int64, automationName string, reason string) error
}

// ─── Auto-Disable Result ───────────────────────────────

// AutoDisableResult contains the outcome of an auto-disable evaluation.
type AutoDisableResult struct {
	Disabled            bool   `json:"disabled"`
	ConsecutiveFailures int    `json:"consecutive_failures"`
	Threshold           int    `json:"threshold"`
	Reason              string `json:"reason"`
	NotificationSent    bool   `json:"notification_sent"`
}

// ─── Auto-Disable Checker ──────────────────────────────

// AutoDisableChecker evaluates whether an automation should be auto-disabled
// after repeated consecutive failures. It bridges execution outcomes with the
// persistent disable state and optional notification delivery.
//
// Design:
//   - Pure logic: Check() evaluates the threshold without side effects.
//   - Orchestrator: RecordOutcome() evaluates + disables + notifies in one call.
//   - Composable: the caller provides an AutoDisabler (DB repo) and optional Notifier.
//
// The consecutive failure count is maintained externally (typically by
// AutomationRepo.IncrementExecution). This checker reads that count and
// decides whether it has crossed the threshold.
type AutoDisableChecker struct {
	threshold int
	disabler  AutoDisabler
	notifier  Notifier // nil means no notifications
	nowFunc   func() time.Time
	logger    zerolog.Logger
}

// AutoDisableOption configures an AutoDisableChecker.
type AutoDisableOption func(*AutoDisableChecker)

// WithThreshold sets the consecutive failure threshold (default 5).
// A threshold of 0 or negative disables auto-disable entirely.
func WithThreshold(n int) AutoDisableOption {
	return func(c *AutoDisableChecker) { c.threshold = n }
}

// WithNotifier sets the notification callback for auto-disable events.
func WithNotifier(n Notifier) AutoDisableOption {
	return func(c *AutoDisableChecker) { c.notifier = n }
}

// NewAutoDisableChecker creates a checker backed by the given AutoDisabler.
// The disabler is required (typically AutomationRepo); the notifier is optional.
func NewAutoDisableChecker(disabler AutoDisabler, opts ...AutoDisableOption) *AutoDisableChecker {
	c := &AutoDisableChecker{
		threshold: DefaultDisableThreshold,
		disabler:  disabler,
		nowFunc:   func() time.Time { return time.Now().UTC() },
		logger: log.With().
			Str("component", "auto_disable_checker").
			Logger(),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Threshold returns the current consecutive failure threshold.
func (c *AutoDisableChecker) Threshold() int {
	return c.threshold
}

// ─── Pure Check ────────────────────────────────────────

// Check evaluates whether the given consecutive failure count meets the
// auto-disable threshold. This is a pure check with no side effects —
// it does not persist state or send notifications.
//
// Parameters:
//   - consecutiveFailures: the count AFTER the latest failure was recorded
//
// A threshold of 0 or negative means auto-disable is off (never triggers).
func (c *AutoDisableChecker) Check(consecutiveFailures int) AutoDisableResult {
	if c.threshold <= 0 {
		return AutoDisableResult{
			Disabled:            false,
			ConsecutiveFailures: consecutiveFailures,
			Threshold:           c.threshold,
			Reason:              "auto-disable disabled (threshold <= 0)",
		}
	}

	if consecutiveFailures >= c.threshold {
		return AutoDisableResult{
			Disabled:            true,
			ConsecutiveFailures: consecutiveFailures,
			Threshold:           c.threshold,
			Reason: fmt.Sprintf(
				"auto-disabled after %d consecutive failures (threshold: %d)",
				consecutiveFailures, c.threshold,
			),
		}
	}

	return AutoDisableResult{
		Disabled:            false,
		ConsecutiveFailures: consecutiveFailures,
		Threshold:           c.threshold,
		Reason: fmt.Sprintf(
			"within threshold: %d/%d consecutive failures",
			consecutiveFailures, c.threshold,
		),
	}
}

// ─── Orchestrated Outcome Recording ────────────────────

// RecordOutcome processes the result of an automation execution.
//
// On success: returns a clean result. The caller should have already reset
// consecutive_failures via IncrementExecution(success=true) in the repo.
//
// On failure: evaluates the updated consecutive failure count against the
// threshold. If the threshold is met:
//  1. Calls AutoDisabler.SetAutoDisabled to persist the disabled state.
//  2. Sends a notification via Notifier (if configured). Notification failure
//     is logged but does not cause RecordOutcome to return an error.
//  3. Returns a result indicating the automation was disabled.
//
// The consecutiveFailures parameter should reflect the count AFTER the
// current failure has been recorded (i.e., already incremented by the repo).
func (c *AutoDisableChecker) RecordOutcome(
	ctx context.Context,
	automationID int64,
	automationName string,
	success bool,
	consecutiveFailures int,
) (AutoDisableResult, error) {
	if success {
		c.logger.Debug().
			Int64("automation_id", automationID).
			Msg("execution succeeded, consecutive failures reset")

		return AutoDisableResult{
			Disabled:            false,
			ConsecutiveFailures: 0,
			Threshold:           c.threshold,
			Reason:              "execution succeeded",
		}, nil
	}

	result := c.Check(consecutiveFailures)

	if !result.Disabled {
		c.logger.Info().
			Int64("automation_id", automationID).
			Str("automation_name", automationName).
			Int("consecutive_failures", consecutiveFailures).
			Int("threshold", c.threshold).
			Msg("execution failed, within auto-disable threshold")
		return result, nil
	}

	// ── Threshold exceeded: auto-disable ──────────────

	c.logger.Warn().
		Int64("automation_id", automationID).
		Str("automation_name", automationName).
		Int("consecutive_failures", consecutiveFailures).
		Int("threshold", c.threshold).
		Msg("auto-disabling automation after repeated failures")

	// 1. Persist the disabled state.
	if err := c.disabler.SetAutoDisabled(ctx, automationID, result.Reason); err != nil {
		c.logger.Error().Err(err).
			Int64("automation_id", automationID).
			Msg("failed to persist auto-disable state")
		return result, fmt.Errorf("auto-disable automation %d: %w", automationID, err)
	}

	// 2. Send notification (best-effort).
	if c.notifier != nil {
		if err := c.notifier.NotifyAutoDisabled(ctx, automationID, automationName, result.Reason); err != nil {
			c.logger.Error().Err(err).
				Int64("automation_id", automationID).
				Msg("failed to send auto-disable notification")
		} else {
			result.NotificationSent = true
		}
	}

	return result, nil
}
