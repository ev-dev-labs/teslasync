// Phase-50 / 0029 — C4 Cost forecast narration.
//
// cost_forecast.go ships ONE new read-only tool:
// `query_cost_forecast`. The tool is the single F4 surface the
// cost-forecast-narration strategy is allowed to call (see
// internal/ai/strategies/cost-forecast-narration/strategy.go's
// allowedTools whitelist).
//
// Design constraints (from the slice prompt + slice 0029
// rubber-duck critique):
//
//   - "thin Tool wrapper over an existing handler. **No new SQL
//     written.**" The production adapter (*api.AICostForecaster)
//     calls the SHARED api.ComputeCostForecast helper that the
//     existing GET /api/v1/analytics/cost-forecast handler now
//     also calls — never a parallel re-implementation. Refactoring
//     the canonical handler to expose the helper was a deliberate
//     choice over duplicating the SQL/math in this slice
//     (rubber-duck blocking finding #1).
//
//   - The tool is a READ — Mutates() returns false. The
//     dispatcher's deny-all confirm gate refuses anything mutating;
//     this slice ships zero mutating tools.
//
//   - One tool, one strategy: the tool is registered on the
//     process-wide tools.Registry alongside the 13 builtins so a
//     future strategy that wants the same envelope can declare it
//     too. The dispatcher's per-strategy whitelist still gates
//     which strategies can call it.
//
// The tool's output is a deterministic typed envelope (all numeric
// metrics + string labels — no free-form prose) constructed by the
// production adapter:
//
//	{
//	  "vehicle_id":              int64,
//	  "currency":                string,            // best-effort, may be ""
//	  "historical_month_count":  int,
//	  "min_required_months":     int,
//	  "has_enough_data":         bool,
//	  "data_through_month":      "YYYY-MM" or "",
//	  "forecast_months":         int,
//	  "forecast_method":         string,            // "linear regression + calendar-month seasonal adjustment"
//	  "uncertainty_method":      string,
//	  "uncertainty_level":       string,            // approximate; NOT a strict 95% CI
//	  "assumptions":             []string,          // explicit narration material
//	  "historical": [
//	    {"month":"YYYY-MM","cost":float64,"kwh":float64,"sessions":int,"cost_per_kwh":float64}
//	  ],
//	  "forecast": [
//	    {"month":"YYYY-MM","cost":float64,"cost_low":float64,"cost_high":float64,"kwh":float64}
//	  ],
//	  "breakdown": {
//	    "home":         {"pct":float64,"avg_cost_per_kwh":float64,"monthly_avg":float64},
//	    "supercharger": {"pct":float64,"avg_cost_per_kwh":float64,"monthly_avg":float64}
//	  },
//	  "gas_comparison": {
//	    "avg_km_per_month":   float64,
//	    "gas_cost_per_month": float64,
//	    "ev_cost_per_month":  float64,
//	    "monthly_savings":    float64,
//	    "annual_savings":     float64,
//	    "lifetime_savings":   float64
//	  },
//	  "insights": []string
//	}
//
// All cost numbers are aggregate monetary values the user already
// sees on the chart; the per-feature redaction policy
// (PolicyCostForecastNarration) explicitly leaves them visible to
// the narrator so the LLM can quote them. Phase-48 SI canonical
// energy fields (Wh) are converted to kWh at the SQL boundary by
// the underlying ComputeCostForecast helper for parity with the
// chart shape.

package tools

import (
	"context"
	"encoding/json"
	"errors"
)

// ---------------------------------------------------------------------------
// Typed envelope returned by query_cost_forecast.
// ---------------------------------------------------------------------------

// CostForecastHistoricalMonth mirrors a single row of the
// historical[] array on the existing GET
// /api/v1/analytics/cost-forecast response shape. Re-declared in
// this package so the tool envelope is self-contained — the
// internal/api package is a long-running consumer of these types
// and re-importing them would create a layering inversion (the
// tools package is below internal/api in the dependency graph).
type CostForecastHistoricalMonth struct {
	Month      string  `json:"month"`
	Cost       float64 `json:"cost"`
	KWh        float64 `json:"kwh"`
	Sessions   int     `json:"sessions"`
	CostPerKWh float64 `json:"cost_per_kwh"`
}

// CostForecastFutureMonth mirrors a single row of the forecast[]
// array. cost_low / cost_high describe an APPROXIMATE prediction
// interval projected from the residual standard error; the
// narrator's system prompt explicitly bans calling this a strict
// statistical 95% confidence interval.
type CostForecastFutureMonth struct {
	Month    string  `json:"month"`
	Cost     float64 `json:"cost"`
	CostLow  float64 `json:"cost_low"`
	CostHigh float64 `json:"cost_high"`
	KWh      float64 `json:"kwh"`
}

// CostForecastChargerCategory is the per-charger-category split
// (home vs supercharger) the deterministic baseline computes. The
// narrator quotes percentages + average cost per kWh.
type CostForecastChargerCategory struct {
	Pct           float64 `json:"pct"`
	AvgCostPerKWh float64 `json:"avg_cost_per_kwh"`
	MonthlyAvg    float64 `json:"monthly_avg"`
}

// CostForecastBreakdown bundles the home / supercharger split.
type CostForecastBreakdown struct {
	Home         CostForecastChargerCategory `json:"home"`
	Supercharger CostForecastChargerCategory `json:"supercharger"`
}

// CostForecastGasComparison mirrors the gas_comparison block —
// the deterministic gas-vs-EV savings projection the canonical
// handler emits. Field names match the JSON the chart consumes.
type CostForecastGasComparison struct {
	AvgKmPerMonth   float64 `json:"avg_km_per_month"`
	GasCostPerMonth float64 `json:"gas_cost_per_month"`
	EvCostPerMonth  float64 `json:"ev_cost_per_month"`
	MonthlySavings  float64 `json:"monthly_savings"`
	AnnualSavings   float64 `json:"annual_savings"`
	LifetimeSavings float64 `json:"lifetime_savings"`
}

// CostForecast is the typed envelope query_cost_forecast returns.
// Every field is grounded in the SAME deterministic forecast
// model the chart on /cost-analysis (and its alias
// /charging/costs) renders — the adapter does not recompute
// anything the canonical handler doesn't already compute (the
// shared api.ComputeCostForecast helper is invoked by both).
//
// The honest-uncertainty fields (forecast_method,
// uncertainty_method, uncertainty_level, assumptions,
// historical_month_count, has_enough_data, min_required_months)
// were added per the slice 0029 rubber-duck critique so the
// narrator can disclose the forecast's analytical limits without
// guessing.
type CostForecast struct {
	VehicleID            int64                         `json:"vehicle_id"`
	Currency             string                        `json:"currency,omitempty"`
	HistoricalMonthCount int                           `json:"historical_month_count"`
	MinRequiredMonths    int                           `json:"min_required_months"`
	HasEnoughData        bool                          `json:"has_enough_data"`
	DataThroughMonth     string                        `json:"data_through_month,omitempty"`
	ForecastMonths       int                           `json:"forecast_months"`
	ForecastMethod       string                        `json:"forecast_method"`
	UncertaintyMethod    string                        `json:"uncertainty_method"`
	UncertaintyLevel     string                        `json:"uncertainty_level"`
	Assumptions          []string                      `json:"assumptions"`
	Historical           []CostForecastHistoricalMonth `json:"historical"`
	Forecast             []CostForecastFutureMonth     `json:"forecast"`
	Breakdown            CostForecastBreakdown         `json:"breakdown"`
	GasComparison        CostForecastGasComparison     `json:"gas_comparison"`
	Insights             []string                      `json:"insights"`
}

// ---------------------------------------------------------------------------
// Narrow port to the canonical forecaster.
// ---------------------------------------------------------------------------

// CostForecaster is the narrow port the query_cost_forecast tool
// delegates to. In production it is satisfied by
// *api.AICostForecaster (which calls api.ComputeCostForecast); in
// tests we substitute deterministic fakes so the tool unit tests
// stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that ADR-015
// §I3 + the slice prompt mandate.
type CostForecaster interface {
	// ForecastCosts runs the canonical deterministic
	// cost-forecast for vehicleID across `months` projected
	// months and returns the typed envelope. The months input
	// is clamped by the underlying helper to the same 1..24
	// window the GET /api/v1/analytics/cost-forecast?months=
	// query parameter accepts. Any data-fetch / SQL error
	// propagates back to the caller; a non-nil error is
	// rendered to the LLM as a tool failure rather than
	// crashing the dispatcher.
	ForecastCosts(ctx context.Context, vehicleID int64, months int) (*CostForecast, error)
}

// ---------------------------------------------------------------------------
// Tool: query_cost_forecast.
// ---------------------------------------------------------------------------

// queryCostForecastInput is the typed input shape for the tool.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
//
// The `months` field defaults to 6 (matching the canonical GET
// /api/v1/analytics/cost-forecast handler default) and is capped
// at 24 to mirror the canonical handler's parameter bounds; the
// dispatcher's typed validator enforces the cap at validation
// time so an LLM-supplied 1000 lands as a 400-equivalent before
// any SQL runs.
type queryCostForecastInput struct {
	// VehicleID identifies the vehicle whose forecast we
	// narrate. Required + positive — the AI handler ALWAYS
	// scopes to the caller's own vehicle, so a missing or
	// nonsense ID is a programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`

	// Months is the number of forecast months to project
	// forward. Optional; the production adapter defaults to
	// 6 when zero is supplied. The 1..24 bounds mirror the
	// canonical /analytics/cost-forecast?months= window so a
	// future LLM that asks for an 18-month horizon gets the
	// same numbers the deterministic chart would produce.
	Months int `json:"months,omitempty" validate:"omitempty,gte=1,lte=24" desc:"Forecast horizon in months (1-24, default 6)."`
}

// queryCostForecast is the read-only tool that returns the
// deterministic cost-forecast envelope.
//
// The dispatcher is allowed to invoke this tool because the
// cost-forecast-narration strategy declares it in its Tools()
// whitelist. Other strategies that want the same envelope must
// add the name to their own Tools() list.
type queryCostForecast struct {
	forecaster CostForecaster
}

// Name implements [Tool].
func (t *queryCostForecast) Name() string { return "query_cost_forecast" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage tutorial.
func (t *queryCostForecast) Description() string {
	return "Return the deterministic charging-cost forecast envelope for a vehicle: historical monthly totals, " +
		"the next-N-month linear-regression projection with seasonal adjustment and an APPROXIMATE prediction " +
		"interval (cost_low / cost_high; NOT a strict 95% confidence interval), the home-vs-supercharger split, " +
		"the gas-vs-EV savings comparison, deterministic insights, and explicit forecast assumptions / " +
		"uncertainty metadata. Use this for forecast narration; do not iterate by calling this multiple times " +
		"for the same vehicle."
}

// InputSchema implements [Tool].
func (t *queryCostForecast) InputSchema() json.RawMessage {
	return cachedSchema(queryCostForecastInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryCostForecast) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryCostForecast) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryCostForecast) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryCostForecast) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryCostForecastInput](raw)
}

// Execute implements [Tool]. Delegates to the CostForecaster
// port. The port handles all IO; this method's job is to enforce
// nil-port wiring, default the months parameter, and surface
// errors.
func (t *queryCostForecast) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryCostForecastInput)
	if t.forecaster == nil {
		return nil, errors.New("query_cost_forecast: no CostForecaster wired")
	}
	months := input.Months
	if months <= 0 {
		// Default mirrors the canonical baseline:
		// /api/v1/analytics/cost-forecast defaults months=6.
		months = 6
	}
	out, err := t.forecaster.ForecastCosts(ctx, input.VehicleID, months)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("query_cost_forecast: forecaster returned nil envelope")
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// CostForecastNarrationSources bundles the narrow forecaster
// interface RegisterCostForecastNarrationTools needs. Mirrors
// [BatteryHealthForecastNarrativeSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AICostForecaster); tests substitute deterministic
// fakes.
type CostForecastNarrationSources struct {
	Forecaster CostForecaster
}

// RegisterCostForecastNarrationTools installs the
// cost-forecast-narration slice's tools on r. Called from
// router.go AFTER the charging-curve-fingerprint-clustering tool
// registration so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or
// any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterCostForecastNarrationTools(r *Registry, s CostForecastNarrationSources) {
	r.Register(&queryCostForecast{forecaster: s.Forecaster})
}
