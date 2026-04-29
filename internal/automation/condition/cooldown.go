package condition

import (
	"encoding/json"
	"fmt"
	"time"
)

// CooldownConfig represents the parsed condition config for cooldown conditions.
// It prevents an automation from firing again within N minutes of its last execution.
type CooldownConfig struct {
	Type    string `json:"type"`    // must be "cooldown"
	Minutes int    `json:"minutes"` // minimum minutes between executions
}

// cooldownSnapshot provides detailed diagnostics for conditions_snapshot logging.
type cooldownSnapshot struct {
	LastTriggeredAt *time.Time `json:"last_triggered_at"`
	CooldownMinutes int        `json:"cooldown_minutes"`
	ElapsedMinutes  float64    `json:"elapsed_minutes"` // -1 when never triggered
	Met             bool       `json:"met"`
	Reason          string     `json:"reason"`
}

// DecodeCooldownSpec unmarshals and validates a cooldown condition config.
func DecodeCooldownSpec(raw json.RawMessage) (*CooldownConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("condition config is empty")
	}

	var cfg CooldownConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal condition config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "cooldown" {
		return nil, fmt.Errorf("expected type \"cooldown\", got %q", cfg.Type)
	}

	if cfg.Minutes <= 0 {
		return nil, fmt.Errorf("minutes must be a positive integer, got %d", cfg.Minutes)
	}

	return &cfg, nil
}

var ParseCooldownConfig = DecodeCooldownSpec

// EvaluateCooldown checks whether enough time has elapsed since the automation's
// last execution. If lastTriggeredAt is nil (never triggered), the condition is met.
func EvaluateCooldown(cfg *CooldownConfig, lastTriggeredAt *time.Time, now time.Time) (Result, json.RawMessage, error) {
	cooldownDuration := time.Duration(cfg.Minutes) * time.Minute

	var met bool
	var reason string
	var elapsedMinutes float64

	if lastTriggeredAt == nil {
		met = true
		elapsedMinutes = -1
		reason = fmt.Sprintf("never triggered, cooldown is %dm", cfg.Minutes)
	} else {
		elapsed := now.Sub(*lastTriggeredAt)
		elapsedMinutes = elapsed.Minutes()

		if elapsed >= cooldownDuration {
			met = true
			reason = fmt.Sprintf("last triggered %dm ago, cooldown is %dm",
				int(elapsedMinutes), cfg.Minutes)
		} else {
			met = false
			remaining := cooldownDuration - elapsed
			reason = fmt.Sprintf("last triggered %dm ago, cooldown is %dm (%dm remaining)",
				int(elapsedMinutes), cfg.Minutes, int(remaining.Minutes()))
		}
	}

	snapshot, _ := json.Marshal(cooldownSnapshot{
		LastTriggeredAt: lastTriggeredAt,
		CooldownMinutes: cfg.Minutes,
		ElapsedMinutes:  elapsedMinutes,
		Met:             met,
		Reason:          reason,
	})

	return Result{Met: met, Reason: reason}, snapshot, nil
}
