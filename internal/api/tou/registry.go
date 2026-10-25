// Package tou provides the canonical time-of-use plans and charge-window
// calculations shared by charge planner and charge autopilot.
package tou

import (
	"sort"
	"time"
)

// RateBlock describes one contiguous hourly tariff block.
type RateBlock struct {
	Rate  float64
	Start int
	End   int
}

// Season describes a month range and its hourly tariff tiers.
type Season struct {
	FromMonth int
	ToMonth   int
	Tiers     map[string][]RateBlock
}

// Plan describes a named utility tariff plan.
type Plan struct {
	ID      string
	Name    string
	Utility string
	Seasons map[string]Season
}

// HourlyRate is the 24-hour canonical rate shape returned by both charge callers.
type HourlyRate struct {
	Hour      int     `json:"hour"`
	RateCents float64 `json:"rate_cents"`
	Tier      string  `json:"tier"`
}

var plans = map[string]Plan{
	"pge-ev2a": {
		ID: "pge-ev2a", Name: "PG&E EV2-A", Utility: "Pacific Gas & Electric",
		Seasons: map[string]Season{
			"Summer": {FromMonth: 6, ToMonth: 9, Tiers: map[string][]RateBlock{
				"ON_PEAK":  {{Rate: 0.49, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.35, Start: 0, End: 16}, {Rate: 0.35, Start: 21, End: 24}},
			}},
			"Winter": {FromMonth: 10, ToMonth: 5, Tiers: map[string][]RateBlock{
				"ON_PEAK":  {{Rate: 0.42, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.36, Start: 0, End: 16}, {Rate: 0.36, Start: 21, End: 24}},
			}},
		},
	},
	"sce-tou-d": {
		ID: "sce-tou-d", Name: "SCE TOU-D", Utility: "Southern California Edison",
		Seasons: map[string]Season{
			"Summer": {FromMonth: 6, ToMonth: 9, Tiers: map[string][]RateBlock{
				"ON_PEAK":  {{Rate: 0.54, Start: 16, End: 21}},
				"MID_PEAK": {{Rate: 0.41, Start: 8, End: 16}, {Rate: 0.41, Start: 21, End: 23}},
				"OFF_PEAK": {{Rate: 0.28, Start: 0, End: 8}, {Rate: 0.28, Start: 23, End: 24}},
			}},
			"Winter": {FromMonth: 10, ToMonth: 5, Tiers: map[string][]RateBlock{
				"MID_PEAK":       {{Rate: 0.43, Start: 8, End: 21}},
				"SUPER_OFF_PEAK": {{Rate: 0.28, Start: 0, End: 8}, {Rate: 0.28, Start: 21, End: 24}},
			}},
		},
	},
	"sdge-tou-dr1": {
		ID: "sdge-tou-dr1", Name: "SDG&E TOU-DR1", Utility: "San Diego Gas & Electric",
		Seasons: map[string]Season{
			"Summer": {FromMonth: 6, ToMonth: 9, Tiers: map[string][]RateBlock{
				"ON_PEAK":  {{Rate: 0.71, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.45, Start: 0, End: 16}, {Rate: 0.45, Start: 21, End: 24}},
			}},
			"Winter": {FromMonth: 10, ToMonth: 5, Tiers: map[string][]RateBlock{
				"ON_PEAK":  {{Rate: 0.57, Start: 16, End: 21}},
				"OFF_PEAK": {{Rate: 0.45, Start: 0, End: 16}, {Rate: 0.45, Start: 21, End: 24}},
			}},
		},
	},
}

// KnownPlan reports whether id names a supported TOU plan.
func KnownPlan(id string) bool {
	_, ok := plans[id]
	return ok
}

// KnownRatePlan is retained as a descriptive alias for existing callers.
func KnownRatePlan(id string) bool {
	return KnownPlan(id)
}

// GetPlan returns a detached copy of a supported plan.
func GetPlan(id string) (Plan, bool) {
	p, ok := plans[id]
	if !ok {
		return Plan{}, false
	}
	return clonePlan(p), true
}

func clonePlan(p Plan) Plan {
	out := Plan{ID: p.ID, Name: p.Name, Utility: p.Utility, Seasons: make(map[string]Season, len(p.Seasons))}
	for name, s := range p.Seasons {
		tiers := make(map[string][]RateBlock, len(s.Tiers))
		for tier, blocks := range s.Tiers {
			tiers[tier] = append([]RateBlock(nil), blocks...)
		}
		out.Seasons[name] = Season{FromMonth: s.FromMonth, ToMonth: s.ToMonth, Tiers: tiers}
	}
	return out
}

// ListPlans returns a stable, ID-sorted registry view.
func ListPlans() []Plan {
	out := make([]Plan, 0, len(plans))
	for _, p := range plans {
		out = append(out, clonePlan(p))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// SeasonForDate returns the matching season name deterministically.
func SeasonForDate(plan Plan, t time.Time) string {
	month := int(t.Month())
	names := make([]string, 0, len(plan.Seasons))
	for name := range plan.Seasons {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		s := plan.Seasons[name]
		if s.FromMonth <= s.ToMonth {
			if month >= s.FromMonth && month <= s.ToMonth {
				return name
			}
		} else if month >= s.FromMonth || month <= s.ToMonth {
			return name
		}
	}
	if len(names) > 0 {
		return names[0]
	}
	return ""
}
