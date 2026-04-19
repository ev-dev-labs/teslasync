package condition

import (
	"encoding/json"
	"fmt"
	"time"
)

// SeasonalConfig represents the parsed condition config for seasonal conditions.
type SeasonalConfig struct {
	Type       string `json:"type"`        // must be "seasonal"
	StartMonth int    `json:"start_month"` // 1=January … 12=December
	EndMonth   int    `json:"end_month"`   // 1=January … 12=December
}

// seasonalSnapshot provides detailed diagnostics for conditions_snapshot logging.
type seasonalSnapshot struct {
	CurrentMonth string `json:"current_month"` // e.g. "April"
	MonthNumber  int    `json:"month_number"`  // 1–12
	StartMonth   string `json:"start_month"`   // e.g. "November"
	EndMonth     string `json:"end_month"`     // e.g. "March"
	RangeKind    string `json:"range_kind"`    // "same_year" or "year_wrap"
	Met          bool   `json:"met"`
	Reason       string `json:"reason"`
}

// EvaluateSeasonal checks whether the current month falls within the configured
// seasonal range. The range is inclusive on both ends.
//
// Same-year ranges (e.g., 4→9 = Apr–Sep): month must be in [start, end].
// Year-wrap ranges (e.g., 11→3 = Nov–Mar): month must be in [start, 12] or [1, end].
func EvaluateSeasonal(cfg *SeasonalConfig, now time.Time) (Result, json.RawMessage, error) {
	month := int(now.Month()) // January=1 … December=12

	var met bool
	var rangeKind string

	if cfg.StartMonth <= cfg.EndMonth {
		// Same-year range: [start, end]
		rangeKind = "same_year"
		met = month >= cfg.StartMonth && month <= cfg.EndMonth
	} else {
		// Year-wrap range: [start, 12] ∪ [1, end]
		rangeKind = "year_wrap"
		met = month >= cfg.StartMonth || month <= cfg.EndMonth
	}

	monthName := now.Month().String()
	startName := time.Month(cfg.StartMonth).String()
	endName := time.Month(cfg.EndMonth).String()

	var reason string
	if met {
		reason = fmt.Sprintf("%s is within %s–%s season", monthName, startName, endName)
	} else {
		reason = fmt.Sprintf("%s is outside %s–%s season", monthName, startName, endName)
	}

	snapshot, _ := json.Marshal(seasonalSnapshot{
		CurrentMonth: monthName,
		MonthNumber:  month,
		StartMonth:   startName,
		EndMonth:     endName,
		RangeKind:    rangeKind,
		Met:          met,
		Reason:       reason,
	})

	return Result{Met: met, Reason: reason}, snapshot, nil
}

// ParseSeasonalConfig unmarshals and validates a seasonal condition config.
func ParseSeasonalConfig(raw json.RawMessage) (*SeasonalConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("condition config is empty")
	}

	var cfg SeasonalConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal condition config: %w", err)
	}

	if cfg.Type != "" && cfg.Type != "seasonal" {
		return nil, fmt.Errorf("expected type \"seasonal\", got %q", cfg.Type)
	}

	if cfg.StartMonth < 1 || cfg.StartMonth > 12 {
		return nil, fmt.Errorf("start_month must be 1–12, got %d", cfg.StartMonth)
	}
	if cfg.EndMonth < 1 || cfg.EndMonth > 12 {
		return nil, fmt.Errorf("end_month must be 1–12, got %d", cfg.EndMonth)
	}
	if cfg.StartMonth == cfg.EndMonth {
		return nil, fmt.Errorf("start_month and end_month must differ (got %d for both)", cfg.StartMonth)
	}

	return &cfg, nil
}
