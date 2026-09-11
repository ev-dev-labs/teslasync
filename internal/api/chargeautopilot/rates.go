package chargeautopilot

// ── TOU Rate Presets ─────────────────────────────────────────
// Deliberate mirror of the chargeplanner presets (server-side source of
// truth lives there). Autopilot previews must price the same windows the
// planner would apply, so any rate change there must be ported here.
// Kept local so this package stays dependency-free and unit-testable
// without a database or signal reader.

type touRateBlock struct {
	Rate  float64
	Start int
	End   int
}

type touSeason struct {
	FromMonth int
	ToMonth   int
	Tiers     map[string][]touRateBlock
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

// KnownRatePlan reports whether id names a supported TOU plan.
func KnownRatePlan(id string) bool {
	_, ok := ratePlans[id]
	return ok
}
