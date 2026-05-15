// Phase-50 / 0040 — X1 Period compare narration.
//
// period_compare.go ships ONE new read-only tool:
// `query_period_compare`. The tool is the single F4 surface the
// period-compare-narration strategy is allowed to call (see
// internal/ai/strategies/period-compare-narration/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt):
//
//   - "thin Tool wrapper over an existing handler. **No new SQL
//     written.**" The production adapter
//     (*api.AIPeriodCompareSource) calls the SHARED
//     api.ComputePeriodStats helper that the existing GET
//     /api/v1/analytics/period-stats handler now also calls —
//     never a parallel re-implementation. Refactoring the
//     canonical handler to expose the helper was a deliberate
//     choice over duplicating the SQL/math in this slice.
//
//   - The tool is a READ — Mutates() returns false. The
//     dispatcher's deny-all confirm gate refuses anything mutating;
//     this slice ships zero mutating tools.
//
//   - One tool, one strategy: the tool is registered on the
//     process-wide tools.Registry alongside the prior builtins so
//     a future strategy that wants the same envelope can declare
//     it too. The dispatcher's per-strategy whitelist still gates
//     which strategies can call it.
//
// The tool's output is a deterministic typed envelope (all numeric
// metrics + minimal labels — no free-form prose) constructed by
// the production adapter:
//
//	{
//	  "vehicle_id":   int64,
//	  "period_a": {
//	    "days":                      int,
//	    "total_distance_km":         float64,
//	    "total_drives":              int,
//	    "energy_used_kwh":           float64,
//	    "avg_efficiency_wh_per_km":  float64,
//	    "total_cost":                float64,
//	    "co2_saved_kg":              float64
//	  },
//	  "period_b": { ... same shape ... },
//	  "deltas": [
//	    {"metric":"total_distance_km","delta":float64,"percent_change":*float64,"direction":string},
//	    ...
//	  ]
//	}
//
// All distance / drives / energy / efficiency / cost / CO2 numbers
// are aggregate user-visible values the chart on /period-compare
// already renders; the per-feature redaction policy
// (PolicyPeriodCompareNarration) explicitly leaves them visible
// to the narrator so the LLM can quote them. Phase-48 SI canonical
// distance + energy fields are converted to km / kWh at the
// underlying ComputePeriodStats boundary for parity with the
// chart shape. percent_change is nullable (*float64) when the
// baseline period has a zero value — the system prompt forbids
// inventing a percent change for a zero baseline.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"math"
)

// ---------------------------------------------------------------------------
// Typed envelope returned by query_period_compare.
// ---------------------------------------------------------------------------

// PeriodComparePeriod mirrors a single period's aggregate envelope.
// Re-declared in this package so the tool envelope is
// self-contained — the internal/api package is a long-running
// consumer of these types and re-importing them would create a
// layering inversion (the tools package is below internal/api in
// the dependency graph).
//
// Field units (kept in lockstep with the canonical
// /api/v1/analytics/period-stats response shape that the
// PeriodComparePage chart consumes):
//
//   - total_distance_km:         display-unit km
//   - total_drives:              count
//   - energy_used_kwh:           display-unit kWh
//   - avg_efficiency_wh_per_km:  display-unit Wh/km
//   - total_cost:                best-effort monetary; may mix
//                                currencies (the system prompt
//                                discloses this caveat)
//   - co2_saved_kg:              display-unit kg
type PeriodComparePeriod struct {
	Days                 int     `json:"days"`
	TotalDistanceKm      float64 `json:"total_distance_km"`
	TotalDrives          int     `json:"total_drives"`
	EnergyUsedKWh        float64 `json:"energy_used_kwh"`
	AvgEfficiencyWhPerKm float64 `json:"avg_efficiency_wh_per_km"`
	TotalCost            float64 `json:"total_cost"`
	CO2SavedKg           float64 `json:"co2_saved_kg"`
}

// PeriodCompareDelta is a single per-metric delta row. PercentChange
// is nullable to honestly disclose "no baseline" — the production
// adapter sets it to nil when the period_b value for the metric is
// zero, so the LLM cannot confabulate an infinite-percent change.
//
// Direction is one of "up" / "down" / "flat" computed from the
// delta sign (with a small tolerance for "flat" so a 0.001-km
// jitter does not surface as "up"). The narrator's system prompt
// keys directional phrasing on the percent_change SIGN; direction
// here is a defensive default for the percent_change=nil case.
type PeriodCompareDelta struct {
	Metric        string   `json:"metric"`
	Delta         float64  `json:"delta"`
	PercentChange *float64 `json:"percent_change"`
	Direction     string   `json:"direction"`
}

// PeriodCompare is the typed envelope query_period_compare returns.
// Every field is grounded in the SAME deterministic period-stats
// helper the chart on /period-compare (and its alias
// /analytics/compare) renders — the adapter does not recompute
// anything the canonical handler doesn't already compute (the
// shared api.ComputePeriodStats helper is invoked by both, once
// per period window).
type PeriodCompare struct {
	VehicleID int64                `json:"vehicle_id"`
	PeriodA   PeriodComparePeriod  `json:"period_a"`
	PeriodB   PeriodComparePeriod  `json:"period_b"`
	Deltas    []PeriodCompareDelta `json:"deltas"`
}

// ---------------------------------------------------------------------------
// Narrow port to the canonical period-stats helper.
// ---------------------------------------------------------------------------

// PeriodComparator is the narrow port the query_period_compare
// tool delegates to. In production it is satisfied by
// *api.AIPeriodCompareSource (which calls api.ComputePeriodStats
// twice, once per period window, and assembles the deltas); in
// tests we substitute deterministic fakes so the tool unit tests
// stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that ADR-015
// §I3 + the slice prompt mandate.
type PeriodComparator interface {
	// ComparePeriods runs the canonical deterministic
	// period-stats helper for vehicleID twice (once per
	// trailing-day window) and returns the typed envelope
	// with both periods plus per-metric deltas. days <= 0
	// means "all time" (no date filter), mirroring the
	// canonical /api/v1/analytics/period-stats?days=0
	// contract the SPA already uses. Any data-fetch / SQL
	// error propagates back to the caller; a non-nil error
	// is rendered to the LLM as a tool failure rather than
	// crashing the dispatcher.
	ComparePeriods(ctx context.Context, vehicleID int64, daysA, daysB int) (*PeriodCompare, error)
}

// ---------------------------------------------------------------------------
// Tool: query_period_compare.
// ---------------------------------------------------------------------------

// queryPeriodCompareInput is the typed input shape for the tool.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
//
// days_a / days_b default to 30 / 90 (matching the SPA's default
// period A / B selectors on PeriodComparePage). The 0..3650 bounds
// match the SPA selector values (7, 30, 90, 365, 0=all time;
// 3650 ≈ 10 years is a generous ceiling against an LLM-supplied
// nonsense value).
type queryPeriodCompareInput struct {
	// VehicleID identifies the vehicle whose period
	// comparison we narrate. Required + positive — the AI
	// handler ALWAYS scopes to the caller's own vehicle, so a
	// missing or nonsense ID is a programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// DaysA is the trailing-day window for Period A. Optional;
	// the production adapter defaults to 30 when zero is
	// supplied (matches the SPA default). Bounds 0..3650:
	// 0 means "all time" (mirrors the canonical /period-stats
	// ?days=0 contract); 3650 ≈ 10 years caps an LLM nonsense
	// value before any SQL runs.
	DaysA int `json:"days_a,omitempty" validate:"omitempty,gte=0,lte=3650" desc:"Trailing-day window for Period A (0-3650, default 30; 0 means all time)."`

	// DaysB is the trailing-day window for Period B. Optional;
	// the production adapter defaults to 90 when zero is
	// supplied (matches the SPA default).
	DaysB int `json:"days_b,omitempty" validate:"omitempty,gte=0,lte=3650" desc:"Trailing-day window for Period B (0-3650, default 90; 0 means all time)."`
}

// queryPeriodCompare is the read-only tool that returns the
// deterministic period-compare envelope.
//
// The dispatcher is allowed to invoke this tool because the
// period-compare-narration strategy declares it in its Tools()
// whitelist. Other strategies that want the same envelope must
// add the name to their own Tools() list.
type queryPeriodCompare struct {
	comparator PeriodComparator
}

// Name implements [Tool].
func (t *queryPeriodCompare) Name() string { return "query_period_compare" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *queryPeriodCompare) Description() string {
	return "Return the deterministic period-over-period analytics envelope for a vehicle: per-period totals " +
		"(distance_km, drives, energy_kwh, avg efficiency Wh/km, total_cost, CO2 saved kg) for two trailing-day " +
		"windows (Period A vs Period B), plus a per-metric delta array with the absolute delta and percent_change " +
		"(percent_change is nullable when the baseline period has zero — do NOT invent a percent change for a " +
		"zero baseline). Use this for narration; do not iterate by calling this multiple times for the same vehicle."
}

// InputSchema implements [Tool].
func (t *queryPeriodCompare) InputSchema() json.RawMessage {
	return cachedSchema(queryPeriodCompareInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryPeriodCompare) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryPeriodCompare) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryPeriodCompare) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryPeriodCompare) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryPeriodCompareInput](raw)
}

// Execute implements [Tool]. Delegates to the PeriodComparator
// port. The port handles all IO; this method's job is to enforce
// nil-port wiring, default the days_a / days_b parameters, and
// surface errors.
func (t *queryPeriodCompare) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryPeriodCompareInput)
	if t.comparator == nil {
		return nil, errors.New("query_period_compare: no PeriodComparator wired")
	}
	daysA := input.DaysA
	if daysA == 0 {
		// Default mirrors the SPA default for Period A.
		daysA = 30
	}
	daysB := input.DaysB
	if daysB == 0 {
		// Default mirrors the SPA default for Period B.
		daysB = 90
	}
	out, err := t.comparator.ComparePeriods(ctx, input.VehicleID, daysA, daysB)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("query_period_compare: comparator returned nil envelope")
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Helper: ComputePeriodCompareDeltas — used by the production
// adapter to build the per-metric delta array. Lives in the tools
// package so the production adapter and the unit tests both
// exercise the SAME deterministic delta-building code (no parallel
// re-implementation).
// ---------------------------------------------------------------------------

// ComputePeriodCompareDeltas returns the per-metric delta array
// (Period A minus Period B, with percent_change keyed off the
// Period B baseline).
//
// percent_change is nullable: when the Period B value for a metric
// is zero (or numerically indistinguishable from zero), the
// adapter returns nil rather than +Inf so the LLM cannot
// confabulate a percent change against a zero baseline. The
// system prompt requires the narrator to disclose the zero-
// baseline case plainly instead.
//
// Direction is computed from the delta sign with a small
// tolerance for "flat" so a sub-one-unit jitter does not surface
// as "up" / "down" — the rounding tolerance matches the 2-decimal
// rounding in api.ComputePeriodStats.
func ComputePeriodCompareDeltas(a, b PeriodComparePeriod) []PeriodCompareDelta {
	type metricRow struct {
		name string
		a    float64
		b    float64
	}
	rows := []metricRow{
		{"total_distance_km", a.TotalDistanceKm, b.TotalDistanceKm},
		{"total_drives", float64(a.TotalDrives), float64(b.TotalDrives)},
		{"energy_used_kwh", a.EnergyUsedKWh, b.EnergyUsedKWh},
		{"avg_efficiency_wh_per_km", a.AvgEfficiencyWhPerKm, b.AvgEfficiencyWhPerKm},
		{"total_cost", a.TotalCost, b.TotalCost},
		{"co2_saved_kg", a.CO2SavedKg, b.CO2SavedKg},
	}
	out := make([]PeriodCompareDelta, 0, len(rows))
	for _, row := range rows {
		delta := roundTo2dp(row.a - row.b)
		var pct *float64
		// Treat any baseline within ±1e-9 as zero so float
		// jitter (rounded ComputePeriodStats outputs are at
		// 2-decimal precision so this is generous) does not
		// surface as a divide-by-zero NaN.
		if math.Abs(row.b) > 1e-9 {
			p := roundTo2dp(((row.a - row.b) / row.b) * 100)
			pct = &p
		}
		out = append(out, PeriodCompareDelta{
			Metric:        row.name,
			Delta:         delta,
			PercentChange: pct,
			Direction:     directionFor(row.a, row.b),
		})
	}
	return out
}

// directionFor classifies the delta as "up" / "down" / "flat".
// The "flat" tolerance is half the 2-decimal rounding step so a
// numerically-zero delta after the 2-decimal round in
// ComputePeriodStats is reported as "flat" rather than oscillating
// "up" / "down" on jitter.
func directionFor(a, b float64) string {
	d := a - b
	switch {
	case d > 0.005:
		return "up"
	case d < -0.005:
		return "down"
	default:
		return "flat"
	}
}

// roundTo2dp rounds v to 2 decimals matching the 2-decimal
// rounding in api.ComputePeriodStats so the per-metric delta
// envelope and the canonical chart numbers stay in lockstep.
// Named to avoid colliding with the package-level round2 helper
// in trip_planner_llm_agent.go.
func roundTo2dp(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*100) / 100
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// PeriodCompareNarrationSources bundles the narrow comparator
// interface RegisterPeriodCompareNarrationTools needs. Mirrors
// [CostForecastNarrationSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AIPeriodCompareSource); tests substitute
// deterministic fakes.
type PeriodCompareNarrationSources struct {
	Comparator PeriodComparator
}

// RegisterPeriodCompareNarrationTools installs the
// period-compare-narration slice's tools on r. Called from
// router.go AFTER the cost-forecast-narration tool registration
// so the registry's alphabetical Names list grows deterministically
// without disturbing earlier registrations or any builtin-names
// pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterPeriodCompareNarrationTools(r *Registry, s PeriodCompareNarrationSources) {
	r.Register(&queryPeriodCompare{comparator: s.Comparator})
}
