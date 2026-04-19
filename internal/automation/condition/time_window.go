// Package condition implements automation condition evaluators.
// Conditions are checked after a trigger fires and before actions execute.
package condition

import (
	"encoding/json"
	"fmt"
	"time"
)

// Result represents the outcome of evaluating a single condition.
type Result struct {
	Met    bool   `json:"met"`
	Reason string `json:"reason"`
}

// TimeWindowConfig represents the parsed condition config for time_window conditions.
type TimeWindowConfig struct {
	Type      string `json:"type"`       // must be "time_window"
	StartTime string `json:"start_time"` // HH:MM (24-hour, zero-padded)
	EndTime   string `json:"end_time"`   // HH:MM (24-hour, zero-padded)
	Timezone  string `json:"timezone"`   // IANA timezone; empty = UTC
}

// timeWindowSnapshot provides detailed diagnostics for conditions_snapshot logging.
type timeWindowSnapshot struct {
	CurrentTime string `json:"current_time"` // HH:MM in the evaluated timezone
	StartTime   string `json:"start_time"`
	EndTime     string `json:"end_time"`
	Timezone    string `json:"timezone"`
	WindowKind  string `json:"window_kind"` // "same_day" or "overnight"
	Met         bool   `json:"met"`
	Reason      string `json:"reason"`
}

// EvaluateTimeWindow checks whether the given time falls within the configured
// time window. The window is defined by start_time and end_time in HH:MM format
// evaluated in the configured timezone (local wall-clock comparison, not duration).
//
// Same-day windows (e.g., 09:00–17:00): now must be in [start, end).
// Overnight windows (e.g., 22:00–06:00): now must be in [start, 24:00) or [00:00, end).
func EvaluateTimeWindow(cfg *TimeWindowConfig, now time.Time) (Result, json.RawMessage, error) {
	loc, err := loadTimezone(cfg.Timezone)
	if err != nil {
		return Result{}, nil, fmt.Errorf("load timezone %q: %w", cfg.Timezone, err)
	}

	startH, startM, err := parseHHMM(cfg.StartTime)
	if err != nil {
		return Result{}, nil, fmt.Errorf("parse start_time: %w", err)
	}

	endH, endM, err := parseHHMM(cfg.EndTime)
	if err != nil {
		return Result{}, nil, fmt.Errorf("parse end_time: %w", err)
	}

	localNow := now.In(loc)
	nowMinutes := localNow.Hour()*60 + localNow.Minute()
	startMinutes := startH*60 + startM
	endMinutes := endH*60 + endM

	var met bool
	var windowKind string

	if startMinutes < endMinutes {
		// Same-day window: [start, end)
		windowKind = "same_day"
		met = nowMinutes >= startMinutes && nowMinutes < endMinutes
	} else {
		// Overnight window: [start, 24:00) ∪ [00:00, end)
		windowKind = "overnight"
		met = nowMinutes >= startMinutes || nowMinutes < endMinutes
	}

	currentTimeStr := fmt.Sprintf("%02d:%02d", localNow.Hour(), localNow.Minute())
	tz := cfg.Timezone
	if tz == "" {
		tz = "UTC"
	}

	var reason string
	if met {
		reason = fmt.Sprintf("current time %s is within %s–%s (%s)", currentTimeStr, cfg.StartTime, cfg.EndTime, tz)
	} else {
		reason = fmt.Sprintf("current time %s is outside %s–%s (%s)", currentTimeStr, cfg.StartTime, cfg.EndTime, tz)
	}

	snapshot, _ := json.Marshal(timeWindowSnapshot{
		CurrentTime: currentTimeStr,
		StartTime:   cfg.StartTime,
		EndTime:     cfg.EndTime,
		Timezone:    tz,
		WindowKind:  windowKind,
		Met:         met,
		Reason:      reason,
	})

	return Result{Met: met, Reason: reason}, snapshot, nil
}

// ParseTimeWindowConfig unmarshals and validates a time_window condition config.
func ParseTimeWindowConfig(raw json.RawMessage) (*TimeWindowConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("condition config is empty")
	}

	var cfg TimeWindowConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal condition config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "time_window" {
		return nil, fmt.Errorf("expected type \"time_window\", got %q", cfg.Type)
	}

	if cfg.StartTime == "" {
		return nil, fmt.Errorf("start_time is required")
	}
	if cfg.EndTime == "" {
		return nil, fmt.Errorf("end_time is required")
	}

	startH, startM, err := parseHHMM(cfg.StartTime)
	if err != nil {
		return nil, fmt.Errorf("invalid start_time: %w", err)
	}
	endH, endM, err := parseHHMM(cfg.EndTime)
	if err != nil {
		return nil, fmt.Errorf("invalid end_time: %w", err)
	}

	if startH*60+startM == endH*60+endM {
		return nil, fmt.Errorf("start_time and end_time must differ (got %s for both)", cfg.StartTime)
	}

	if cfg.Timezone != "" {
		if _, err := time.LoadLocation(cfg.Timezone); err != nil {
			return nil, fmt.Errorf("invalid timezone %q: %w", cfg.Timezone, err)
		}
	}

	return &cfg, nil
}

// parseHHMM parses a "HH:MM" string into hour and minute components.
// Enforces zero-padded 24-hour format: 00:00–23:59.
func parseHHMM(s string) (hour, minute int, err error) {
	if len(s) != 5 || s[2] != ':' {
		return 0, 0, fmt.Errorf("expected HH:MM format, got %q", s)
	}

	hour = int(s[0]-'0')*10 + int(s[1]-'0')
	minute = int(s[3]-'0')*10 + int(s[4]-'0')

	// Validate digit characters.
	for _, i := range []int{0, 1, 3, 4} {
		if s[i] < '0' || s[i] > '9' {
			return 0, 0, fmt.Errorf("expected HH:MM format, got %q", s)
		}
	}

	if hour > 23 {
		return 0, 0, fmt.Errorf("hour must be 00-23, got %02d", hour)
	}
	if minute > 59 {
		return 0, 0, fmt.Errorf("minute must be 00-59, got %02d", minute)
	}

	return hour, minute, nil
}

// loadTimezone loads an IANA timezone. Falls back to UTC for empty strings.
func loadTimezone(tz string) (*time.Location, error) {
	if tz == "" {
		return time.UTC, nil
	}
	return time.LoadLocation(tz)
}
