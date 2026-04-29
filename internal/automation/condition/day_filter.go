package condition

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// DayFilterConfig represents the parsed condition config for day_filter conditions.
type DayFilterConfig struct {
	Type     string `json:"type"`     // must be "day_filter"
	Days     []int  `json:"days"`     // 0=Sunday, 1=Monday, ..., 6=Saturday
	Timezone string `json:"timezone"` // IANA timezone; empty = UTC
}

// dayFilterSnapshot provides detailed diagnostics for conditions_snapshot logging.
type dayFilterSnapshot struct {
	CurrentDay  string `json:"current_day"`  // e.g. "Tuesday"
	DayNumber   int    `json:"day_number"`   // 0–6
	AllowedDays string `json:"allowed_days"` // e.g. "Mon-Fri"
	Timezone    string `json:"timezone"`
	Met         bool   `json:"met"`
	Reason      string `json:"reason"`
}

// EvaluateDayFilter checks whether the current day of the week (in the configured
// timezone) is in the allowed days list.
func EvaluateDayFilter(cfg *DayFilterConfig, now time.Time) (Result, json.RawMessage, error) {
	loc, err := loadTimezone(cfg.Timezone)
	if err != nil {
		return Result{}, nil, fmt.Errorf("load timezone %q: %w", cfg.Timezone, err)
	}

	localNow := now.In(loc)
	weekday := int(localNow.Weekday()) // Sunday=0 … Saturday=6

	met := false
	for _, d := range cfg.Days {
		if d == weekday {
			met = true
			break
		}
	}

	tz := cfg.Timezone
	if tz == "" {
		tz = "UTC"
	}

	dayName := localNow.Weekday().String()
	allowedStr := formatDayList(cfg.Days)

	var reason string
	if met {
		reason = fmt.Sprintf("%s is in allowed days %s (%s)", dayName, allowedStr, tz)
	} else {
		reason = fmt.Sprintf("%s is not in allowed days %s (%s)", dayName, allowedStr, tz)
	}

	snapshot, _ := json.Marshal(dayFilterSnapshot{
		CurrentDay:  dayName,
		DayNumber:   weekday,
		AllowedDays: allowedStr,
		Timezone:    tz,
		Met:         met,
		Reason:      reason,
	})

	return Result{Met: met, Reason: reason}, snapshot, nil
}

// DecodeDayFilterSpec unmarshals and validates a day_filter condition config.
func DecodeDayFilterSpec(raw json.RawMessage) (*DayFilterConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("condition config is empty")
	}

	var cfg DayFilterConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal condition config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "day_filter" {
		return nil, fmt.Errorf("expected type \"day_filter\", got %q", cfg.Type)
	}

	if len(cfg.Days) == 0 {
		return nil, fmt.Errorf("days is required and must not be empty")
	}

	seen := make(map[int]bool, len(cfg.Days))
	for _, d := range cfg.Days {
		if d < 0 || d > 6 {
			return nil, fmt.Errorf("invalid day %d: must be 0 (Sunday) through 6 (Saturday)", d)
		}
		if seen[d] {
			return nil, fmt.Errorf("duplicate day %d", d)
		}
		seen[d] = true
	}

	if cfg.Timezone != "" {
		if _, err := time.LoadLocation(cfg.Timezone); err != nil {
			return nil, fmt.Errorf("invalid timezone %q: %w", cfg.Timezone, err)
		}
	}

	return &cfg, nil
}

var ParseDayFilterConfig = DecodeDayFilterSpec

// dayShortNames maps day numbers (0–6) to abbreviated names.
var dayShortNames = [7]string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

// formatDayList returns a human-readable representation of the allowed days.
// Consecutive runs are collapsed: [1,2,3,4,5] → "[Mon-Fri]".
// Non-consecutive days are listed: [0,2,4] → "[Sun, Tue, Thu]".
// Mixed: [0,1,2,5,6] → "[Sun-Tue, Fri-Sat]".
func formatDayList(days []int) string {
	if len(days) == 0 {
		return "[]"
	}

	// Sort days for run detection.
	sorted := make([]int, len(days))
	copy(sorted, days)
	sortDays(sorted)

	var parts []string
	i := 0
	for i < len(sorted) {
		start := sorted[i]
		end := start
		for i+1 < len(sorted) && sorted[i+1] == end+1 {
			i++
			end = sorted[i]
		}
		if start == end {
			parts = append(parts, dayShortNames[start])
		} else {
			parts = append(parts, dayShortNames[start]+"-"+dayShortNames[end])
		}
		i++
	}

	return "[" + strings.Join(parts, ", ") + "]"
}

// sortDays performs a simple insertion sort on a small (≤7 element) day slice.
func sortDays(days []int) {
	for i := 1; i < len(days); i++ {
		key := days[i]
		j := i - 1
		for j >= 0 && days[j] > key {
			days[j+1] = days[j]
			j--
		}
		days[j+1] = key
	}
}
