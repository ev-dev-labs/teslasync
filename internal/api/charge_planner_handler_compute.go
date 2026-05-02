package api

import (
	"time"
)

// ── TOU Rate Presets (server-side source of truth) ───────────

type touRateBlock struct {
	Rate  float64
	Start int // hour 0-23
	End   int // hour 0-24
}

type touSeason struct {
	FromMonth int
	ToMonth   int
	Tiers     map[string][]touRateBlock // "ON_PEAK", "OFF_PEAK", "MID_PEAK", etc.
}

type touPlan struct {
	ID      string
	Name    string
	Utility string
	Seasons map[string]touSeason
}

var ratePlans = map[string]touPlan{
	"pge-ev2a": {
		ID: "pge-ev2a", Name: "PG&E EV2-A", Utility: "Pacific Gas & Electric",
		Seasons: map[string]touSeason{
			"Summer": {FromMonth: 6, ToMonth: 9, Tiers: map[string][]touRateBlock{
				"ON_PEAK":  {{Rate: 0.49, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.35, Start: 0, End: 16}, {Rate: 0.35, Start: 21, End: 24}},
			}},
			"Winter": {FromMonth: 10, ToMonth: 5, Tiers: map[string][]touRateBlock{
				"ON_PEAK":  {{Rate: 0.42, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.36, Start: 0, End: 16}, {Rate: 0.36, Start: 21, End: 24}},
			}},
		},
	},
	"sce-tou-d": {
		ID: "sce-tou-d", Name: "SCE TOU-D", Utility: "Southern California Edison",
		Seasons: map[string]touSeason{
			"Summer": {FromMonth: 6, ToMonth: 9, Tiers: map[string][]touRateBlock{
				"ON_PEAK":  {{Rate: 0.54, Start: 16, End: 21}},
				"MID_PEAK": {{Rate: 0.41, Start: 8, End: 16}, {Rate: 0.41, Start: 21, End: 23}},
				"OFF_PEAK": {{Rate: 0.28, Start: 0, End: 8}, {Rate: 0.28, Start: 23, End: 24}},
			}},
			"Winter": {FromMonth: 10, ToMonth: 5, Tiers: map[string][]touRateBlock{
				"MID_PEAK":       {{Rate: 0.43, Start: 8, End: 21}},
				"SUPER_OFF_PEAK": {{Rate: 0.28, Start: 0, End: 8}, {Rate: 0.28, Start: 21, End: 24}},
			}},
		},
	},
	"sdge-tou-dr1": {
		ID: "sdge-tou-dr1", Name: "SDG&E TOU-DR1", Utility: "San Diego Gas & Electric",
		Seasons: map[string]touSeason{
			"Summer": {FromMonth: 6, ToMonth: 9, Tiers: map[string][]touRateBlock{
				"ON_PEAK":  {{Rate: 0.71, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.45, Start: 0, End: 16}, {Rate: 0.45, Start: 21, End: 24}},
			}},
			"Winter": {FromMonth: 10, ToMonth: 5, Tiers: map[string][]touRateBlock{
				"ON_PEAK":  {{Rate: 0.57, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.45, Start: 0, End: 16}, {Rate: 0.45, Start: 21, End: 24}},
			}},
		},
	},
}

// ── Helpers ──────────────────────────────────────────────────

// seasonForDate returns the season name for a given date.
func seasonForDate(plan touPlan, t time.Time) string {
	m := int(t.Month())
	for name, s := range plan.Seasons {
		if s.FromMonth <= s.ToMonth {
			if m >= s.FromMonth && m <= s.ToMonth {
				return name
			}
		} else {
			// Wraps around year (e.g., Oct-May)
			if m >= s.FromMonth || m <= s.ToMonth {
				return name
			}
		}
	}
	// Fallback: return first season
	for name := range plan.Seasons {
		return name
	}
	return ""
}

// buildHourlyRates returns the rate and tier for each hour 0-23 for the given season.
func buildHourlyRates(season touSeason) []hourlyRate {
	rates := make([]hourlyRate, 24)
	for i := range rates {
		rates[i] = hourlyRate{Hour: i, RateCents: 0, Tier: "unknown"}
	}
	for tierName, blocks := range season.Tiers {
		for _, b := range blocks {
			for h := b.Start; h < b.End && h < 24; h++ {
				rates[h] = hourlyRate{
					Hour:      h,
					RateCents: b.Rate * 100, // dollars -> cents
					Tier:      tierName,
				}
			}
		}
	}
	return rates
}

// tierLabel returns a human-friendly tier name.
func tierLabel(tier string) string {
	switch tier {
	case "ON_PEAK":
		return "on-peak"
	case "MID_PEAK":
		return "mid-peak"
	case "OFF_PEAK", "SUPER_OFF_PEAK":
		return "off-peak"
	default:
		return "unknown"
	}
}

// costForWindow calculates the cost of charging across a window of hours using per-hour rates.
func costForWindow(rates []hourlyRate, startHour, durationHours int, kwhNeeded float64) (float64, float64) {
	if durationHours <= 0 {
		return 0, 0
	}
	totalRateCents := 0.0
	for i := 0; i < durationHours; i++ {
		h := (startHour + i) % 24
		totalRateCents += rates[h].RateCents
	}
	avgRateCents := totalRateCents / float64(durationHours)
	cost := avgRateCents / 100.0 * kwhNeeded // cents→dollars * kWh
	return cost, avgRateCents
}
