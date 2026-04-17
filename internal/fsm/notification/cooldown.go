// Package notification implements Alert Cooldown and Notification Delivery FSMs.
package notification

import (
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// CooldownState represents the alert cooldown lifecycle.
type CooldownState string

const (
	Armed      CooldownState = "armed"
	Fired      CooldownState = "fired"
	Suppressed CooldownState = "suppressed"
)

// CooldownConfig controls how often an alert can fire.
type CooldownConfig struct {
	CooldownDuration time.Duration // don't re-fire within this period
	MaxFiresPerHour  int           // hard cap (0 = no limit)
}

// DefaultCooldownConfig returns sensible defaults.
func DefaultCooldownConfig() CooldownConfig {
	return CooldownConfig{
		CooldownDuration: 15 * time.Minute,
		MaxFiresPerHour:  4,
	}
}

// CooldownFSM manages alert suppression for a single (alert_rule, vehicle) pair.
type CooldownFSM struct {
	mu              sync.Mutex
	state           CooldownState
	lastFiredAt     time.Time
	fireCountHour   int
	hourWindowStart time.Time
	suppressedCount int
	config          CooldownConfig
	logger          zerolog.Logger
}

// NewCooldownFSM creates a cooldown FSM in Armed state.
func NewCooldownFSM(ruleID int64, vehicleID int64, cfg CooldownConfig) *CooldownFSM {
	return &CooldownFSM{
		state:           Armed,
		config:          cfg,
		hourWindowStart: time.Now().UTC(),
		logger: log.With().Str("component", "cooldown_fsm").
			Int64("rule_id", ruleID).Int64("vehicle_id", vehicleID).Logger(),
	}
}

// ShouldFire evaluates whether the alert should fire. Returns true if the alert
// should create a notification, false if suppressed.
func (c *CooldownFSM) ShouldFire() bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now().UTC()

	// Reset hourly counter if window expired
	if now.Sub(c.hourWindowStart) > time.Hour {
		c.fireCountHour = 0
		c.hourWindowStart = now
	}

	// Check cooldown period (regardless of current state — use lastFiredAt timestamp)
	if !c.lastFiredAt.IsZero() && now.Sub(c.lastFiredAt) < c.config.CooldownDuration {
		c.state = Suppressed
		c.suppressedCount++
		c.logger.Debug().
			Str("state", "suppressed").
			Dur("cooldown_remaining", c.config.CooldownDuration-now.Sub(c.lastFiredAt)).
			Int("suppressed_total", c.suppressedCount).
			Msg("alert suppressed — within cooldown")
		return false
	}

	// Check hourly rate limit
	if c.config.MaxFiresPerHour > 0 && c.fireCountHour >= c.config.MaxFiresPerHour {
		c.state = Suppressed
		c.suppressedCount++
		c.logger.Debug().
			Int("fire_count_hour", c.fireCountHour).
			Int("max", c.config.MaxFiresPerHour).
			Msg("alert suppressed — hourly limit reached")
		return false
	}

	// Fire!
	c.state = Fired
	c.lastFiredAt = now
	c.fireCountHour++
	c.logger.Info().
		Int("fire_count_hour", c.fireCountHour).
		Msg("alert fired")
	return true
}

// Reset clears the cooldown state when the alert condition resolves.
// This ensures the next occurrence is treated as a new event.
func (c *CooldownFSM) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state == Fired || c.state == Suppressed {
		c.logger.Info().
			Str("prev_state", string(c.state)).
			Msg("cooldown reset — condition resolved")
		c.state = Armed
		c.lastFiredAt = time.Time{} // zero value = no cooldown
		// Note: do NOT reset fireCountHour — hourly rate limit is still valid
	}
}

// State returns the current cooldown state.
func (c *CooldownFSM) State() CooldownState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// Stats returns cooldown statistics.
func (c *CooldownFSM) Stats() (fireCount, suppressedCount int, lastFired time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.fireCountHour, c.suppressedCount, c.lastFiredAt
}
