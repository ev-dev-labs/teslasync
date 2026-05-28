// Phase-50 / 0050 — M2 TCO narration.
//
// tco_summary.go ships ONE new read-only tool:
// `query_tco_summary`. The tool is the single F4 surface the
// tco-narration strategy is allowed to call (see
// internal/ai/strategies/tco-narration/strategy.go's allowedTools
// whitelist).
//
// Design constraints (from the slice prompt + slice 0050
// rubber-duck critique):
//
//   - "thin Tool wrapper over an existing handler. **No new SQL
//     written.**" The production adapter (*api.AITCOSummarizer)
//     calls the SHARED api.ComputeTCOSummary helper that the
//     existing GET /api/v1/analytics/tco handler now also calls
//     — never a parallel re-implementation. Refactoring the
//     canonical handler to expose the helper was a deliberate
//     choice over duplicating the SQL/math in this slice
//     (rubber-duck blocking finding #1, mirroring the slice 0029
//     cost-forecast precedent).
//
//   - The tool is a READ — Mutates() returns false. The
//     dispatcher's deny-all confirm gate refuses anything
//     mutating; this slice ships zero mutating tools.
//
//   - One tool, one strategy: the tool is registered on the
//     process-wide tools.Registry alongside the 13 builtins so a
//     future strategy that wants the same envelope can declare it
//     too. The dispatcher's per-strategy whitelist still gates
//     which strategies can call it.
//
// The tool's output is a deterministic typed envelope (all
// numeric metrics + string labels — no free-form prose)
// constructed by the production adapter. The SHAPE mirrors the
// canonical /api/v1/analytics/tco JSON wire shape verbatim
// because the SAME api.ComputeTCOSummary helper backs both — the
// AI narrator quotes the SAME numbers the chart renders.
//
// Phase-48 SI-canonical note: the canonical /api/v1/analytics/tco
// wire shape predates the SI-canonical migration. The legacy
// snake_case keys (`total_wh`, `total_km`, `cost_per_km_ev`,
// `cost_per_km_ice`, `gas_efficiency_mpg`, `base_cost_per_kwh`)
// are mirrored here for chart-parity ONLY — this slice does NOT
// add new legacy-unit fields beyond the existing endpoint shape.
// The narration uses `useUnits()` on the React side for any
// display-unit conversion the user has configured; the typed
// envelope here keeps the snake_case keys the chart already
// consumes so the narrator and the chart cite the same numbers.

package tools

import (
	"context"
	"encoding/json"
	"errors"
)

// ---------------------------------------------------------------------------
// Typed envelope returned by query_tco_summary.
// ---------------------------------------------------------------------------

// TCOMonthlyEntry mirrors a single row of the monthly_breakdown[]
// array on the existing GET /api/v1/analytics/tco response shape.
// Re-declared in this package so the tool envelope is
// self-contained — the internal/api package is a long-running
// consumer of these types and re-importing them would create a
// layering inversion (the tools package is below internal/api in
// the dependency graph, mirroring CostForecastHistoricalMonth).
type TCOMonthlyEntry struct {
	Month        string  `json:"month"`
	EVCost       float64 `json:"ev_cost"`
	EquivGasCost float64 `json:"equiv_gas_cost"`
	Savings      float64 `json:"savings"`
	CumSavings   float64 `json:"cumulative_savings"`
	EnergyWh     float64 `json:"energy_wh"`
}

// TCOSummary is the typed envelope query_tco_summary returns.
// Every field is grounded in the SAME deterministic computation
// the chart on /tco (and its alias /analytics/tco) renders — the
// adapter does not recompute anything the canonical handler
// doesn't already compute (the shared api.ComputeTCOSummary
// helper is invoked by both).
//
// The honest-scope fields (assumptions, currency) were added per
// the slice 0050 rubber-duck critique so the narrator can
// disclose the deterministic envelope's analytical limits without
// guessing.
type TCOSummary struct {
	VehicleID                  int64             `json:"vehicle_id"`
	Currency                   string            `json:"currency,omitempty"`
	TotalChargingCost          float64           `json:"total_charging_cost"`
	TotalWh                    float64           `json:"total_wh"`
	TotalSessions              int               `json:"total_sessions"`
	TotalKm                    float64           `json:"total_km"`
	FirstDate                  string            `json:"first_date"`
	LastDate                   string            `json:"last_date"`
	MonthsOfOwnership          float64           `json:"months_of_ownership"`
	CostPerKmEV                float64           `json:"cost_per_km_ev"`
	CostPerKmICE               float64           `json:"cost_per_km_ice"`
	EquivalentGasCost          float64           `json:"equivalent_gas_cost"`
	TotalSavings               float64           `json:"total_savings"`
	MonthlySavings             float64           `json:"monthly_savings"`
	MaintenanceSavingsEstimate float64           `json:"maintenance_savings_estimate"`
	GasPrice                   float64           `json:"gas_price"`
	GasEfficiencyMPG           float64           `json:"gas_efficiency_mpg"`
	BaseCostPerKWh             float64           `json:"base_cost_per_kwh"`
	MonthlyBreakdown           []TCOMonthlyEntry `json:"monthly_breakdown"`
	// Assumptions surfaces the four limiting assumptions baked
	// into the deterministic envelope so the LLM does not have
	// to derive them from prose. The strategy's system prompt
	// also names them — defence in depth.
	Assumptions []string `json:"assumptions"`
}

// ---------------------------------------------------------------------------
// Narrow port to the canonical TCO summarizer.
// ---------------------------------------------------------------------------

// TCOSummarizer is the narrow port the query_tco_summary tool
// delegates to. In production it is satisfied by
// *api.AITCOSummarizer (which calls api.ComputeTCOSummary); in
// tests we substitute deterministic fakes so the tool unit tests
// stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that ADR-015
// §I3 + the slice prompt mandate.
type TCOSummarizer interface {
	// SummarizeTCO runs the canonical deterministic
	// total-cost-of-ownership aggregation for vehicleID and
	// returns the typed envelope. Any data-fetch / SQL error
	// propagates back to the caller; a non-nil error is
	// rendered to the LLM as a tool failure rather than
	// crashing the dispatcher.
	SummarizeTCO(ctx context.Context, vehicleID int64) (*TCOSummary, error)
}

// ---------------------------------------------------------------------------
// Tool: query_tco_summary.
// ---------------------------------------------------------------------------

// queryTCOSummaryInput is the typed input shape for the tool.
// The dispatcher decodes the LLM's tool-call arguments JSON into
// this struct via ValidateStruct so a malformed input fails
// before any repo method runs.
//
// The shape is intentionally minimal — vehicle_id is the ONLY
// scope binding. The canonical /api/v1/analytics/tco handler
// takes only ?vehicle_id=, so the narrator inherits the same
// surface area.
type queryTCOSummaryInput struct {
	// VehicleID identifies the vehicle whose ownership cost
	// we narrate. Required + positive — the AI handler
	// ALWAYS scopes to the caller's own vehicle, so a
	// missing or nonsense ID is a programming error.
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
}

// queryTCOSummary is the read-only tool that returns the
// deterministic TCO envelope.
//
// The dispatcher is allowed to invoke this tool because the
// tco-narration strategy declares it in its Tools() whitelist.
// Other strategies that want the same envelope must add the
// name to their own Tools() list.
type queryTCOSummary struct {
	summarizer TCOSummarizer
}

// Name implements [Tool].
func (t *queryTCOSummary) Name() string { return "query_tco_summary" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused, NOT a usage
// tutorial. Disclose the four limiting assumptions explicitly
// so the LLM treats the envelope as operating-cost-only and
// does not promote it to "full TCO".
func (t *queryTCOSummary) Description() string {
	return "Return the deterministic operating-cost envelope for one vehicle: total_charging_cost, equivalent_gas_cost, " +
		"total_savings, monthly_savings, cost_per_km_ev, cost_per_km_ice, total_sessions, months_of_ownership, gas_price, " +
		"gas_efficiency_mpg, base_cost_per_kwh, maintenance_savings_estimate, and the per-month monthly_breakdown rows. " +
		"This is OPERATING COST only — purchase price, depreciation, insurance, registration, taxes, and resale value are " +
		"NOT included; maintenance_savings_estimate is a flat $50-per-month heuristic; per-month equivalent_gas_cost is " +
		"ESTIMATED from charging energy not actual per-month distance; gas_price / gas_efficiency_mpg / base_cost_per_kwh " +
		"come from user-editable settings. Use this for ownership-cost narration; do not iterate by calling this multiple " +
		"times for the same vehicle."
}

// InputSchema implements [Tool].
func (t *queryTCOSummary) InputSchema() json.RawMessage {
	return CachedSchema(queryTCOSummaryInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object;
// the dispatcher serialises whatever Execute returns.
func (t *queryTCOSummary) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. Read-only — never returns true.
func (t *queryTCOSummary) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — readable by any
// authenticated user (the AI guard already gates on ai_mode +
// per-feature toggle upstream).
func (t *queryTCOSummary) RequiredScope() string { return "" }

// Validate implements [Tool]. Delegates to the shared validator.
func (t *queryTCOSummary) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[queryTCOSummaryInput](raw)
}

// Execute implements [Tool]. Delegates to the TCOSummarizer
// port. The port handles all IO; this method's job is to enforce
// nil-port wiring and surface errors.
func (t *queryTCOSummary) Execute(ctx context.Context, in any) (any, error) {
	input := in.(queryTCOSummaryInput)
	if t.summarizer == nil {
		return nil, errors.New("query_tco_summary: no TCOSummarizer wired")
	}
	out, err := t.summarizer.SummarizeTCO(ctx, input.VehicleID)
	if err != nil {
		return nil, err
	}
	if out == nil {
		return nil, errors.New("query_tco_summary: summarizer returned nil envelope")
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// TCONarrationSources bundles the narrow summarizer interface
// RegisterTCONarrationTools needs. Mirrors
// [CostForecastNarrationSources].
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AITCOSummarizer); tests substitute deterministic
// fakes.
type TCONarrationSources struct {
	Summarizer TCOSummarizer
}

// RegisterTCONarrationTools installs the tco-narration slice's
// tools on r. Called from router.go AFTER the prior tool
// registrations so the registry's alphabetical Names list grows
// deterministically without disturbing earlier registrations or
// any builtin-names pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterTCONarrationTools(r *Registry, s TCONarrationSources) {
	r.Register(&queryTCOSummary{summarizer: s.Summarizer})
}
