// Package costforecastnarration is the Phase-50 / 0029 C4 strategy
// for the LLM-narrated charging cost forecast.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     cost-forecast explainer: narrate WHY the projected band is
//     what it is using ONLY the values returned by the tool reply,
//     never change the forecast itself, never invent dollar
//     amounts, refuse cross-vehicle requests, and explicitly
//     surface the forecast assumptions and the approximate (not
//     strict) prediction interval;
//
//   - the single read-only tool the LLM is allowed to call —
//     `query_cost_forecast` — which composes the existing
//     api.ComputeCostForecast helper through a narrow
//     [CostForecaster] port and reuses the SAME deterministic
//     forecast model the chart on /cost-analysis (and its alias
//     /charging/costs) renders. The tool is pure-functional: it
//     does NOT mutate fleet state and adds NO new SQL — every read
//     goes through the same shared helper that already backs the
//     deterministic GET /api/v1/analytics/cost-forecast handler;
//
//   - the redaction policy (`PolicyCostForecastNarration`) which
//     allows ClassVehicleName only; VIN, lat/long, addresses, and
//     place names remain tagged via round-trip markers so a leaked
//     transcript does not reveal the user's home charger or the
//     supercharger sites they regularly use.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_cost_forecast_narration_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /cost-analysis (and /charging/costs) — CostSummaryCards,
// MonthlyCostChart, CostPerKwhChart, ChargerTypeBreakdown,
// SavingsCalculator, MonthlyCostTable, TimeOfUseAnalysis,
// CostForecastSection (linear regression + seasonal + approximate
// 95% prediction interval), LifetimeSummary, EnvironmentalImpact —
// is unchanged. The deterministic forecast model remains the
// canonical baseline; off-mode users never see the AI surface at
// all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this slice's frontend code is loaded
// under the page-bundle for /cost-analysis (and the aliased
// /charging/costs); the off-mode walker validates code chunks via
// the `withAiFeature` HOC + the AI_FEATURES map. See the slice log
// for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic CostForecastSection chart, summary cards, or
//     insights panel; it adds an opt-in narrative section
//     alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("cost-forecast-narration").
//   - I9 redaction:       PolicyCostForecastNarration restricts
//     cleartext to vehicle name only; lat/long, addresses, place
//     names, and charging-location identifiers stay tagged so a
//     leaked transcript does not reveal where the user lives,
//     works, or charges.
package costforecastnarration

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, tests) can reference the same
// constant the strategy registers itself with — typo-proof via
// compile error.
const FeatureID = "cost-forecast-narration"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every cost-forecast-narration generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/cost-forecast-narration/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_cost_forecast before narrating so the narration is
//     grounded in the canonical cost-forecast envelope.
//   - Forbids changing the forecast: this is an EXPLAINER, not a
//     forecaster. The LLM may quote currency, monthly historical
//     totals, projected costs (with cost_low / cost_high), the
//     home-vs-supercharger split, the gas comparison numbers, and
//     the deterministic insights returned by the tool; it MUST
//     NOT invent alternate slopes, alternate projected dollar
//     amounts, or alternate savings figures.
//   - REQUIRES the narration to disclose the forecast method
//     (linear regression + seasonal adjustment) and the approximate
//     nature of the prediction interval (this is NOT a strict
//     statistical 95% confidence interval; the residual standard
//     error is projected through a prediction-interval formula
//     with t≈2 / z=1.96 depending on sample size).
//   - REQUIRES the narrator to honestly disclose insufficient data
//     (has_enough_data=false) rather than inventing a slope.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (2-3 sentences narrating the
//     forecast drivers + assumptions) so the surface fits inside
//     the existing CostAnalysisPage layout without a scroll bomb.
//   - Bans quoting precise street addresses or location coordinates
//     in the narration: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync cost-forecast narrator. ` +
	`Your job is to EXPLAIN the deterministic charging-cost forecast for ONE vehicle in scope; you NEVER change the forecast or invent numbers. ` +
	`ALWAYS call query_cost_forecast FIRST with the caller-supplied vehicle_id and narrate the result. ` +
	`Do NOT recompute, override, or contradict the forecast: the narration may quote historical monthly totals, the projected cost / cost_low / cost_high band, the home-vs-supercharger split, the gas-comparison savings figures, and the deterministic insights the tool returns, but never invent alternate slopes, never fabricate a projected dollar amount the tool did not return, and never reclassify the gas-savings number. ` +
	`ALWAYS surface the forecast method and the nature of the uncertainty interval honestly: it is a linear regression with calendar-month seasonal adjustment, and the cost_low / cost_high band is an APPROXIMATE prediction interval (residual standard error projected with t≈2 or z=1.96), NOT a strict 95% confidence interval. Use phrases like "approximate range" rather than "95% confidence". ` +
	`If has_enough_data is false (fewer than the minimum required months), say so plainly rather than inventing a slope or projected dollar amount. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences explaining which trend, seasonal effect, charging-mix split, or insight drives the forecast (e.g. "Roadie's monthly cost trends slightly upward with a winter peak; supercharger sessions account for about 30% of the cost; the next three months are projected in the approximate range of $80-$120"), grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The name MUST be registered in the
// process-wide tools.Registry — `query_cost_forecast` is
// registered by RegisterCostForecastNarrationTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// The tool is READ / pure-functional: it does NOT touch the
// database write path (the underlying ComputeCostForecast helper
// only runs SELECTs against charging_sessions + drives), and the
// dispatcher's deny-all confirm gate is therefore never reached
// in practice — defence in depth in case a future edit
// accidentally adds a write tool.
var allowedTools = []string{
	"query_cost_forecast",
}

// Strategy is the concrete strategy.Strategy implementation for
// the cost-forecast-narration surface. Construct via [New]; the
// zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this
// is effectively a sentinel constructor used to make wiring
// intent readable at the call site.
func New() *Strategy {
	return &Strategy{}
}

// FeatureID implements [strategy.Strategy]. Returns the canonical
// registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy]. Returns the deterministic
// system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools implements [strategy.Strategy]. Returns a defensive copy of
// the allowed tool names so a caller cannot mutate the package-
// level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "narrate vehicle N's cost
// forecast" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "preferred forecast
// horizon" preference snippet would be injected once
// cost-forecast-narration grows that surface. Today's slice keeps
// Context empty so the dispatcher's behaviour is fully determined
// by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyCostForecastNarration wrapped through the F4↔F8 adapter
// so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees
// the concrete policy.
//
// Per the slice prompt: "Allowed classes: ClassVehicleName only;
// cost data is aggregate and user-visible. Round-trip required:
// yes". PolicyCostForecastNarration is the per-feature constructor
// with the same allow-list as PolicyDigest /
// PolicyBatteryHealthForecastNarrative — kept as a distinct
// identifier so a future per-feature change to
// cost-forecast-narration's allow-list does not bleed across the
// other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyCostForecastNarration())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/cost-forecast-narration/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
