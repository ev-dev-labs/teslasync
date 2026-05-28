// Phase-50 / 0032 — T2 Cabin temperature impact narrative.
//
// temperature_impact.go ships ONE new read-only tool:
// `query_temperature_impact`. The tool is the single F4 surface
// the cabin-temperature-impact-narrative strategy is allowed to
// call (see
// internal/ai/strategies/cabin-temperature-impact-narrative/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt):
//
//   - "thin Tool wrapper over an existing handler". The
//     production adapter (*api.AITemperatureImpactSource) calls
//     the SHARED api.ComputeTemperatureImpact helper that returns
//     the SAME deterministic temperature-impact aggregates the
//     existing GET /api/v1/analytics/temperature-impact handler
//     already exposes (bucketed efficiency, monthly seasonal
//     trend, summary statistics) — never a parallel
//     re-implementation.
//
//   - The tool is a READ — Mutates() returns false. The
//     dispatcher's deny-all confirm gate refuses anything
//     mutating; this slice ships zero mutating tools.
//
//   - One tool, one strategy: the tool is registered on the
//     process-wide tools.Registry alongside the builtins so a
//     future strategy that wants the same envelope can declare it
//     too. The dispatcher's per-strategy whitelist still gates
//     which strategies can call it.
//
// The tool's output is a deterministic typed envelope (all
// numeric metrics + string labels — no free-form prose)
// constructed by the production adapter:
//
//	{
//	  "vehicle_id":              int64,
//	  "sample_size":             int,             // total drives in the bucket aggregate
//	  "min_required_drives":     int,
//	  "has_enough_data":         bool,
//	  "method":                  string,          // "Bucket aggregate of recent drives by ambient cabin temperature"
//	  "assumptions":             []string,
//	  "buckets": [
//	    {"label":"...","drive_count":int,"avg_distance_km":float64,
//	     "avg_duration_s":float64,
//	     "avg_battery_pct_per_100km":float64,"avg_temp_c":float64}
//	  ],
//	  "best_bucket":  {label,drive_count,avg_battery_pct_per_100km,avg_temp_c},
//	  "worst_bucket": {label,drive_count,avg_battery_pct_per_100km,avg_temp_c},
//	  "monthly_trend": [
//	    {"month":"YYYY-MM","avg_temp_c":float64,"avg_efficiency":float64,"drive_count":int,"total_distance_km":float64}
//	  ],
//	  "insights": []string
//	}
//
// All fields are aggregate, vehicle-scoped, and identical in
// shape to the values the chart on /temperature-impact already
// renders. The per-feature redaction policy
// (PolicyCabinTemperatureImpactNarrative) explicitly leaves the
// vehicle name visible to the narrator so the LLM can quote it;
// every other PII class — VIN, lat/long, addresses — remains
// tagged via round-trip markers.

package tools

import (
	"context"
	"encoding/json"
	"errors"
)

// ---------------------------------------------------------------------------
// Typed envelope returned by query_temperature_impact.
// ---------------------------------------------------------------------------

// TemperatureImpactBucket mirrors a single row of the buckets[]
// array on the existing GET /api/v1/analytics/temperature-impact
// response shape. Re-declared in this package so the tool
// envelope is self-contained — the internal/api package is a
// long-running consumer of these types and re-importing them
// would create a layering inversion (the tools package is below
// internal/api in the dependency graph).
type TemperatureImpactBucket struct {
	Label              string  `json:"label"`
	DriveCount         int     `json:"drive_count"`
	AvgDistanceKm      float64 `json:"avg_distance_km"`
	AvgDurationS       float64 `json:"avg_duration_s"`
	AvgBatteryPer100Km float64 `json:"avg_battery_pct_per_100km"`
	AvgTempC           float64 `json:"avg_temp_c"`
}

// TemperatureImpactMonth mirrors a single row of the
// monthly_trend[] array. avg_temp_c paired with avg_efficiency
// describe the rolling 12-month seasonal pattern; the narrator's
// system prompt explicitly bans calling this a forecast or
// regression model.
type TemperatureImpactMonth struct {
	Month           string  `json:"month"`
	AvgTempC        float64 `json:"avg_temp_c"`
	AvgEfficiency   float64 `json:"avg_efficiency"`
	DriveCount      int     `json:"drive_count"`
	TotalDistanceKm float64 `json:"total_distance_km"`
}

// TemperatureImpact is the typed envelope query_temperature_impact
// returns. Every field is grounded in the SAME deterministic
// aggregation the chart on /temperature-impact renders — the
// adapter does not recompute anything the canonical handler
// doesn't already compute.
//
// The honest-method fields (method, assumptions, sample_size,
// has_enough_data, min_required_drives) are present so the
// narrator can disclose the analytical limits without guessing.
// best_bucket / worst_bucket are nullable: when has_enough_data
// is false the production adapter leaves them nil and the
// narrator must say so plainly.
type TemperatureImpact struct {
	VehicleID         int64                     `json:"vehicle_id"`
	SampleSize        int                       `json:"sample_size"`
	MinRequiredDrives int                       `json:"min_required_drives"`
	HasEnoughData     bool                      `json:"has_enough_data"`
	Method            string                    `json:"method"`
	Assumptions       []string                  `json:"assumptions"`
	Buckets           []TemperatureImpactBucket `json:"buckets"`
	BestBucket        *TemperatureImpactBucket  `json:"best_bucket,omitempty"`
	WorstBucket       *TemperatureImpactBucket  `json:"worst_bucket,omitempty"`
	MonthlyTrend      []TemperatureImpactMonth  `json:"monthly_trend"`
	Insights          []string                  `json:"insights"`
}

// ---------------------------------------------------------------------------
// Narrow port to the canonical aggregator.
// ---------------------------------------------------------------------------

// TemperatureImpactSource is the narrow port the
// query_temperature_impact tool delegates to. In production it is
// satisfied by *api.AITemperatureImpactSource (which calls
// api.ComputeTemperatureImpact); in tests we substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that ADR-015
// §I3 + the slice prompt mandate.
type TemperatureImpactSource interface {
	// QueryTemperatureImpact runs the canonical deterministic
	// temperature-impact aggregator for vehicleID and returns
	// the typed envelope. Any data-fetch / SQL error
	// propagates back to the caller; a non-nil error is
	// rendered to the LLM as a tool failure rather than
	// crashing the dispatcher.
	QueryTemperatureImpact(ctx context.Context, vehicleID int64) (*TemperatureImpact, error)
}

// ---------------------------------------------------------------------------
// Tool: query_temperature_impact.
// ---------------------------------------------------------------------------

// queryTemperatureImpactInput is the typed input shape for the
// tool. The dispatcher decodes the LLM's tool-call arguments JSON
// into this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
type queryTemperatureImpactInput struct {
	// VehicleID identifies the vehicle whose temperature
	// impact we narrate. Required + positive — the AI handler
	// ALWAYS scopes to the caller's own vehicle, so a missing
	// or nonsense ID is a programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
}

// queryTemperatureImpact is the read-only tool that returns the
// deterministic temperature-impact envelope.
//
// The dispatcher is allowed to invoke this tool because the
// cabin-temperature-impact-narrative strategy declares it in its
// Tools() whitelist. Other strategies that want the same envelope
// must add the name to their own Tools() list.
type queryTemperatureImpact struct {
	source TemperatureImpactSource
}

// Name implements [Tool].
func (t *queryTemperatureImpact) Name() string { return "query_temperature_impact" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage
// tutorial.
func (t *queryTemperatureImpact) Description() string {
	return "Return the deterministic cabin temperature impact envelope for a vehicle: " +
		"bucketed efficiency by ambient cabin temperature range, the best and worst bucket, " +
		"the rolling 12-month seasonal trend (avg_temp_c paired with avg_efficiency), " +
		"deterministic insights, sample-size + has_enough_data flags, and explicit " +
		"method / assumptions metadata. Use this for temperature-impact narration; do not " +
		"iterate by calling this multiple times for the same vehicle."
}

// InputSchema implements [Tool].
func (t *queryTemperatureImpact) InputSchema() json.RawMessage {
	return CachedSchema(queryTemperatureImpactInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryTemperatureImpact) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryTemperatureImpact) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryTemperatureImpact) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryTemperatureImpact) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryTemperatureImpactInput](raw)
}

// Execute implements [Tool]. Delegates to the
// TemperatureImpactSource port. The port handles all IO; this
// method's job is to enforce nil-port wiring and surface errors.
func (t *queryTemperatureImpact) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryTemperatureImpactInput)
	if t.source == nil {
		return nil, errors.New("query_temperature_impact: no TemperatureImpactSource wired")
	}
	out, err := t.source.QueryTemperatureImpact(ctx, input.VehicleID)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("query_temperature_impact: source returned nil envelope")
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// CabinTemperatureImpactNarrativeSources bundles the narrow source
// interface RegisterCabinTemperatureImpactNarrativeTools needs.
// Mirrors [CostForecastNarrationSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AITemperatureImpactSource); tests substitute
// deterministic fakes.
type CabinTemperatureImpactNarrativeSources struct {
	Source TemperatureImpactSource
}

// RegisterCabinTemperatureImpactNarrativeTools installs the
// cabin-temperature-impact-narrative slice's tools on r. Called
// from router.go AFTER the preheat-precool-recommender tool
// registration so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or
// any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterCabinTemperatureImpactNarrativeTools(r *Registry, s CabinTemperatureImpactNarrativeSources) {
	r.Register(&queryTemperatureImpact{source: s.Source})
}
