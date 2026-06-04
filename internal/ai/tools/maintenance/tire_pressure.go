// Tire-pressure trend reasoning tool.
//
// This file defines one read-only tool:
// `query_tire_pressure_trend`. The tool is the single surface
// the tire-pressure-trend-reasoning strategy is allowed to call
// (see
// internal/ai/strategies/tire-pressure-trend-reasoning/strategy.go's
// allowedTools whitelist).
//
// Design constraints:
//
//   - "thin Tool wrapper over an existing handler". The
//     production adapter (*api.AITirePressureTrendSource) calls
//     the SHARED signal.StateReader.Timeline projection over the
//     same TpmsPressure* (front-left, front-right, rear-left,
//     rear-right) signals + the OutsideTemp signal that the
//     existing GET /api/v1/tire-pressure handler already exposes
//     — never a parallel re-implementation. The four pressure
//     bands (soft-low, normal-min, normal-max, soft-high) are the
//     SAME constants the SPA's TirePressurePage already uses for
//     gauge banding (mirrored from
//     web/src/features/vehicle-systems/pages/TirePressurePage.tsx
//     L67-L71).
//
//   - The tool is a READ — Mutates() returns false. The
//     dispatcher's deny-all confirm gate refuses anything
//     mutating; this feature ships zero mutating tools.
//
//   - One tool, one strategy: the tool is registered on the
//     process-wide tools.Registry alongside the builtins so a
//     future strategy that wants the same envelope can declare
//     it too. The dispatcher's per-strategy whitelist still gates
//     which strategies can call it.
//
// The tool's output is a deterministic typed envelope (all
// numeric metrics + string labels — no free-form prose)
// constructed by the production adapter:
//
//	{
//	  "vehicle_id":              int64,
//	  "window_days":             int,
//	  "min_required_readings":   int,
//	  "sample_size":             int,
//	  "has_enough_data":         bool,
//	  "method":                  string,
//	  "assumptions":             []string,
//	  "thresholds": {
//	    "soft_low_pa":     float64,
//	    "normal_min_pa":   float64,
//	    "normal_max_pa":   float64,
//	    "soft_high_pa":    float64
//	  },
//	  "tires": [
//	    {"position":"fl","label":"Front Left","status":"normal|low|high|critical",
//	     "reading_count":int,"latest_pa":float64,"average_pa":float64,
//	     "min_pa":float64,"max_pa":float64,"rate_pa_per_day":float64,
//	     "days_until_soft_low_estimate":int|null}
//	  ],
//	  "outside_temp_summary": {
//	    "reading_count":int,"avg_temp_c":float64,
//	    "min_temp_c":float64,"max_temp_c":float64
//	  } | null,
//	  "likely_causes":  []string,   // deterministic heuristic hints
//	  "insights":       []string
//	}
//
// All fields are aggregate, vehicle-scoped, and grounded in the
// SAME signal_log change feed that the canonical
// /tire-pressure handler already exposes. The per-feature
// redaction policy (PolicyTirePressureTrendReasoning) explicitly
// leaves the vehicle name visible to the narrator so the LLM can
// quote it; every other PII class — VIN, lat/long, addresses —
// remains tagged via round-trip markers.

package maintenance

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Typed envelope returned by query_tire_pressure_trend.
// ---------------------------------------------------------------------------

// TirePressureThresholds mirrors the four deterministic
// pressure-band edges the SPA's TirePressurePage already uses for
// gauge banding. Pa (SI) is the canonical unit; the SPA converts
// to the user's display unit (bar/psi/kPa) at the render
// boundary.
type TirePressureThresholds struct {
	SoftLowPa   float64 `json:"soft_low_pa"`
	NormalMinPa float64 `json:"normal_min_pa"`
	NormalMaxPa float64 `json:"normal_max_pa"`
	SoftHighPa  float64 `json:"soft_high_pa"`
}

// TirePressureCorner mirrors the per-tire trend summary for one
// of the four corner positions (fl, fr, rl, rr). All values are
// in Pa (SI). DaysUntilSoftLowEstimate is a pure derivation from
// LatestPa + RatePaPerDay — when RatePaPerDay >= 0 (no leak) it
// is nil and the narrator must NOT invent a deflation timeline.
type TirePressureCorner struct {
	Position                 string  `json:"position"`
	Label                    string  `json:"label"`
	Status                   string  `json:"status"`
	ReadingCount             int     `json:"reading_count"`
	LatestPa                 float64 `json:"latest_pa"`
	AveragePa                float64 `json:"average_pa"`
	MinPa                    float64 `json:"min_pa"`
	MaxPa                    float64 `json:"max_pa"`
	RatePaPerDay             float64 `json:"rate_pa_per_day"`
	DaysUntilSoftLowEstimate *int    `json:"days_until_soft_low_estimate"`
}

// TireOutsideTempSummary mirrors the rolling outside ambient
// temperature summary across the same window. avg_temp_c paired
// with the per-tire RatePaPerDay enables the deterministic
// cold-weather correlation hint. Nullable: when the OutsideTemp
// signal has no readings in the window the field is nil and the
// narrator must not invent a correlation.
type TireOutsideTempSummary struct {
	ReadingCount int     `json:"reading_count"`
	AvgTempC     float64 `json:"avg_temp_c"`
	MinTempC     float64 `json:"min_temp_c"`
	MaxTempC     float64 `json:"max_temp_c"`
}

// TirePressureTrend is the typed envelope query_tire_pressure_trend
// returns. Every field is grounded in the SAME deterministic
// signal_log change feed the canonical /tire-pressure handler
// already exposes — the adapter does not recompute or re-band
// anything the canonical handler doesn't already compute.
//
// The honest-method fields (method, assumptions, sample_size,
// has_enough_data, min_required_readings) are present so the
// narrator can disclose the analytical limits without guessing.
// Tires are nullable per-corner: when reading_count for a corner
// is 0 the corner is omitted; when has_enough_data is false the
// production adapter clears the per-tire status / rate / insights
// so the narrator must say so plainly.
type TirePressureTrend struct {
	VehicleID           int64                   `json:"vehicle_id"`
	WindowDays          int                     `json:"window_days"`
	MinRequiredReadings int                     `json:"min_required_readings"`
	SampleSize          int                     `json:"sample_size"`
	HasEnoughData       bool                    `json:"has_enough_data"`
	Method              string                  `json:"method"`
	Assumptions         []string                `json:"assumptions"`
	Thresholds          TirePressureThresholds  `json:"thresholds"`
	Tires               []TirePressureCorner    `json:"tires"`
	OutsideTempSummary  *TireOutsideTempSummary `json:"outside_temp_summary,omitempty"`
	LikelyCauses        []string                `json:"likely_causes"`
	Insights            []string                `json:"insights"`
}

// ---------------------------------------------------------------------------
// Narrow port to the canonical aggregator.
// ---------------------------------------------------------------------------

// TirePressureTrendSource is the narrow port the
// query_tire_pressure_trend tool delegates to. In production it
// is satisfied by *api.AITirePressureTrendSource (which composes
// the same signal.StateReader.Timeline projection the canonical
// TirePressureHandler.List uses); in tests we substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that the read-only contract mandates.
type TirePressureTrendSource interface {
	// QueryTirePressureTrend runs the canonical deterministic
	// tire-pressure trend aggregator for vehicleID and returns
	// the typed envelope. Any data-fetch / SQL error
	// propagates back to the caller; a non-nil error is
	// rendered to the LLM as a tool failure rather than
	// crashing the dispatcher.
	QueryTirePressureTrend(ctx context.Context, vehicleID int64) (*TirePressureTrend, error)
}

// ---------------------------------------------------------------------------
// Tool: query_tire_pressure_trend.
// ---------------------------------------------------------------------------

// queryTirePressureTrendInput is the typed input shape for the
// tool. The dispatcher decodes the LLM's tool-call arguments JSON
// into this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
type queryTirePressureTrendInput struct {
	// VehicleID identifies the vehicle whose tire-pressure
	// trend we narrate. Required + positive — the AI handler
	// ALWAYS scopes to the caller's own vehicle, so a missing
	// or nonsense ID is a programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
}

// queryTirePressureTrend is the read-only tool that returns the
// deterministic tire-pressure trend envelope.
//
// The dispatcher is allowed to invoke this tool because the
// tire-pressure-trend-reasoning strategy declares it in its
// Tools() whitelist. Other strategies that want the same envelope
// must add the name to their own Tools() list.
type queryTirePressureTrend struct {
	source TirePressureTrendSource
}

// Name implements [Tool].
func (t *queryTirePressureTrend) Name() string { return "query_tire_pressure_trend" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *queryTirePressureTrend) Description() string {
	return "Return the deterministic tire-pressure trend envelope for a vehicle: per-corner " +
		"(front-left, front-right, rear-left, rear-right) latest / average / min / max / " +
		"rate-of-change-per-day in Pa, the soft-low / normal-min / normal-max / soft-high " +
		"threshold band edges, the rolling outside ambient temperature summary across the " +
		"same window, deterministic likely-cause hints (cold-weather correlation, " +
		"slow-leak signature, all-tires-trending suggesting weather rather than puncture), " +
		"sample-size + has_enough_data flags, and explicit method / assumptions metadata. " +
		"Use this for tire-pressure trend narration; do not iterate by calling this " +
		"multiple times for the same vehicle."
}

// InputSchema implements [Tool].
func (t *queryTirePressureTrend) InputSchema() json.RawMessage {
	return tools.CachedSchema(queryTirePressureTrendInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryTirePressureTrend) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryTirePressureTrend) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryTirePressureTrend) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryTirePressureTrend) Validate(raw json.RawMessage) (any, error) {
	return tools.ValidateStruct[queryTirePressureTrendInput](raw)
}

// Execute implements [Tool]. Delegates to the
// TirePressureTrendSource port. The port handles all IO; this
// method's job is to enforce nil-port wiring and surface errors.
func (t *queryTirePressureTrend) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryTirePressureTrendInput)
	if t.source == nil {
		return nil, errors.New("query_tire_pressure_trend: no TirePressureTrendSource wired")
	}
	out, err := t.source.QueryTirePressureTrend(ctx, input.VehicleID)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("query_tire_pressure_trend: source returned nil envelope")
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TirePressureTrendReasoningSources bundles the narrow source
// interface RegisterTirePressureTrendReasoningTools needs.
// Mirrors [CabinTemperatureImpactNarrativeSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AITirePressureTrendSource); tests substitute
// deterministic fakes.
type TirePressureTrendReasoningSources struct {
	Source TirePressureTrendSource
}

// RegisterTirePressureTrendReasoningTools installs the
// tire-pressure-trend-reasoning tools on r. Called from
// router.go AFTER the cabin-temperature-impact-narrative tool
// registration so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or
// any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterTirePressureTrendReasoningTools(r *tools.Registry, s TirePressureTrendReasoningSources) {
	r.Register(&queryTirePressureTrend{source: s.Source})
}
