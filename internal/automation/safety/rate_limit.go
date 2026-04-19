// Package safety implements pre-execution safety checks for automations.
package safety

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// Recommended default rate limits per trigger type.
// These are advisory constants for the UI/API layer when creating automations;
// enforcement uses the automation's max_executions_hour field.
const (
	DefaultRateLimitCron          = 0  // unlimited — cron fires on a known schedule
	DefaultRateLimitBattery       = 10 // battery events cluster during charge/discharge
	DefaultRateLimitState         = 20 // state changes can be frequent
	DefaultRateLimitMQTT          = 30 // external MQTT can be high-frequency
	DefaultRateLimitGeofence      = 20
	DefaultRateLimitWebhook       = 30
	DefaultRateLimitSunriseSunset = 0  // fires at most twice per day
	DefaultRateLimitEnergy        = 10
	DefaultRateLimitCalendar      = 0  // fires at most a few times per day
)

// HistoryCounter queries the count of recent executions for an automation.
// Implementors should count only rows that consumed execution budget
// (running, success, partial, failed — not skipped or cancelled).
type HistoryCounter interface {
	CountSinceByAutomation(ctx context.Context, automationID int64, since time.Time) (int, error)
}

// RateLimitResult contains the outcome of a rate limit check.
type RateLimitResult struct {
	Allowed        bool   `json:"allowed"`
	Reason         string `json:"reason"`
	ExecutionsUsed int    `json:"executions_used"`
	MaxAllowed     int    `json:"max_allowed"`
}

// RateLimiter checks whether an automation has exceeded its hourly execution limit.
//
// The check is advisory: it queries the database for the current count and returns
// whether execution should proceed. For atomic enforcement under concurrent triggers,
// the caller should integrate the check within the transaction that creates the
// automation_history row (e.g., SELECT ... FOR UPDATE or advisory lock).
type RateLimiter struct {
	counter HistoryCounter
	nowFunc func() time.Time
	logger  zerolog.Logger
}

// NewRateLimiter creates a new rate limiter backed by the given history counter.
func NewRateLimiter(counter HistoryCounter) *RateLimiter {
	return &RateLimiter{
		counter: counter,
		nowFunc: func() time.Time { return time.Now().UTC() },
		logger: log.With().
			Str("component", "rate_limiter").
			Logger(),
	}
}

// Check verifies whether the automation is within its hourly rate limit.
//
// maxPerHour == 0 means unlimited (always allowed).
// maxPerHour < 0 is treated as a configuration error and returns not-allowed.
func (rl *RateLimiter) Check(ctx context.Context, automationID int64, maxPerHour int) (RateLimitResult, error) {
	if maxPerHour < 0 {
		return RateLimitResult{
			Allowed:    false,
			Reason:     fmt.Sprintf("invalid max_executions_hour: %d (must be >= 0)", maxPerHour),
			MaxAllowed: maxPerHour,
		}, nil
	}

	if maxPerHour == 0 {
		return RateLimitResult{
			Allowed:    true,
			Reason:     "rate limit disabled (unlimited)",
			MaxAllowed: 0,
		}, nil
	}

	now := rl.nowFunc()
	since := now.Add(-1 * time.Hour)

	count, err := rl.counter.CountSinceByAutomation(ctx, automationID, since)
	if err != nil {
		return RateLimitResult{}, fmt.Errorf("check rate limit for automation %d: %w", automationID, err)
	}

	if count >= maxPerHour {
		reason := fmt.Sprintf("rate limited: %d/%d executions in the last hour", count, maxPerHour)
		rl.logger.Warn().
			Int64("automation_id", automationID).
			Int("executions_used", count).
			Int("max_per_hour", maxPerHour).
			Msg("automation rate limited")

		return RateLimitResult{
			Allowed:        false,
			Reason:         reason,
			ExecutionsUsed: count,
			MaxAllowed:     maxPerHour,
		}, nil
	}

	return RateLimitResult{
		Allowed:        true,
		Reason:         fmt.Sprintf("within rate limit: %d/%d executions in the last hour", count, maxPerHour),
		ExecutionsUsed: count,
		MaxAllowed:     maxPerHour,
	}, nil
}

// DefaultLimit returns the recommended default hourly rate limit for a trigger type.
// Returns 0 (unlimited) for unknown trigger types.
func DefaultLimit(triggerType string) int {
	switch triggerType {
	case "cron":
		return DefaultRateLimitCron
	case "battery":
		return DefaultRateLimitBattery
	case "vehicle_state":
		return DefaultRateLimitState
	case "mqtt":
		return DefaultRateLimitMQTT
	case "geofence":
		return DefaultRateLimitGeofence
	case "webhook":
		return DefaultRateLimitWebhook
	case "sunrise_sunset":
		return DefaultRateLimitSunriseSunset
	case "energy":
		return DefaultRateLimitEnergy
	case "calendar":
		return DefaultRateLimitCalendar
	default:
		return 0
	}
}
