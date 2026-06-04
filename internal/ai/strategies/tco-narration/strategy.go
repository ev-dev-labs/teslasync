// Package tconarration is the strategy for the
// LLM-narrated Total Cost of Ownership surface.
//
// The strategy declares:
//
// - the system prompt that frames the surface as a deterministic
// ownership-cost EXPLAINER: narrate WHY the EV-vs-equivalent-gas
// savings are what they are using ONLY the values returned by
// the tool reply, never change the deterministic numbers, never
// invent dollar amounts, refuse cross-vehicle requests, and
// explicitly disclose the FOUR limiting assumptions baked into
// the deterministic computation (operating-cost only — NOT full
// TCO; flat $50/month maintenance heuristic; per-month gas
// equivalent estimated from charging energy rather than per-month
// distance; legacy display-unit fields preserved for chart
// parity);
//
// - the single read-only tool the LLM is allowed to call —
// `query_tco_summary` — which composes the existing
// api.ComputeTCOSummary helper through a narrow
// [TCOSummarizer] port and reuses the SAME deterministic
// envelope the chart on /tco (and its alias /analytics/tco)
// renders. The tool is pure-functional: it does NOT mutate
// fleet state and adds NO new SQL — every read goes through
// the same shared helper that backs the deterministic
// GET /api/v1/analytics/tco handler;
//
// - the redaction policy (`redact.PolicyDigest`) which allows
// ClassVehicleName only; VIN, lat/long, addresses, place
// names, charger network labels, IPs, emails, phone numbers
// and MAC addresses remain tagged via round-trip markers so a
// leaked transcript does not reveal the user's home charger
// or the supercharger sites they regularly use.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_tco_narration_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /tco (and its alias /analytics/tco) — TCOHero, TCOSummaryCards,
// CostOverTimeChart, MonthlyBreakdownTable, AssumptionsPanel — is
// unchanged. The deterministic ComputeTCOSummary helper remains
// the canonical baseline; off-mode users never see the AI surface
// at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this feature's frontend code is loaded
// under the page-bundle for /tco (and the aliased /analytics/tco);
// the off-mode walker validates code chunks via the
// `withAiFeature` HOC + the AI_FEATURES map.
//
// ADR-015 alignment:
//
// - I1 default-off: feature toggle defaults false in features.Registry.
// - I3 baseline intact: this strategy never replaces the
// deterministic TrueCostPage chart, summary cards, or
// monthly breakdown table; it adds an opt-in narrative
// section alongside.
// - I7 per-feature: the AI route is gated by
// guard.Wrap("tco-narration").
// - I9 redaction: PolicyDigest restricts cleartext
// to vehicle name only; lat/long, addresses, place names, and
// charging-location identifiers stay tagged so a leaked
// transcript does not reveal where the user lives, works, or
// charges.
package tconarration

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
const FeatureID = "tco-narration"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every tco-narration generation. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/tco-narration/goldens.yaml) and the
// runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
// - Forces tool-first behaviour: the LLM MUST call
// query_tco_summary before narrating so the narration is
// grounded in the canonical TCO envelope the chart renders.
// - Forbids changing the numbers: this is an EXPLAINER, not a
// calculator. The LLM may quote total_charging_cost,
// equivalent_gas_cost, total_savings, monthly_savings,
// cost_per_km_ev, cost_per_km_ice, total_sessions,
// months_of_ownership, and the monthly_breakdown rows; it
// MUST NOT invent alternate dollar amounts, alternate savings
// figures, or claim a per-month value the tool did not
// return.
// - REQUIRES the narration to disclose the FOUR LIMITING
// ASSUMPTIONS that materially affect interpretation:
// (1) the deterministic envelope is OPERATING-COST ONLY — it
// does NOT include vehicle purchase price, depreciation,
// insurance, registration, taxes, financing, or resale value,
// so this is NOT full Total Cost of Ownership in the
// accounting sense;
// (2) maintenance_savings_estimate is a flat $50/month
// heuristic — not a real per-vehicle service-record sum;
// (3) per-month equivalent_gas_cost in monthly_breakdown is
// ESTIMATED from each month's charging energy (not from
// actual per-month distance), so a month with low charging
// but high driving will appear cheaper than reality;
// (4) gas_efficiency_mpg, gas_price, and base_cost_per_kwh
// come from user-editable settings — if the user has not
// configured them the deterministic defaults apply (25 MPG,
// $3.50/gal, $0.12/kWh).
// - REQUIRES the narrator to honestly disclose insufficient
// data: when total_sessions is 0 OR months_of_ownership is
// 1 (the floor / no real history), say so plainly rather
// than inventing a savings story.
// - REQUIRES the narrator to be HONEST about negative savings:
// if total_savings < 0 (electricity is more expensive than
// the gas equivalent), say so PLAINLY. Never cheerlead, and
// NEVER recommend buying or switching to a gas vehicle —
// that is out of scope for an EV operating-cost narrator.
// - Refuses cross-vehicle requests: the AI handler always
// scopes to the caller-supplied vehicle_id from the body;
// any other vehicle ID in the user message is by definition
// out of scope.
// - Asks for short, focused output (3-5 sentences narrating
// the savings drivers + assumptions) so the surface fits
// inside the existing TrueCostPage layout without a scroll
// bomb.
// - Bans quoting precise street addresses or location
// coordinates in the narration: the redaction policy already
// strips them, but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync ownership-cost narrator. ` +
	`Your job is to EXPLAIN the deterministic operating-cost envelope for ONE vehicle in scope; you NEVER change the numbers and NEVER invent dollar amounts. ` +
	`ALWAYS call query_tco_summary FIRST with the caller-supplied vehicle_id and narrate the result. ` +
	`Do NOT recompute, override, or contradict the envelope: the narration may quote total_charging_cost, equivalent_gas_cost, total_savings, monthly_savings, cost_per_km_ev, cost_per_km_ice, total_sessions, months_of_ownership, and the monthly_breakdown rows, but never invent an alternate dollar amount, an alternate savings figure, or an alternate per-month value the tool did not return. ` +
	`ALWAYS disclose the FOUR LIMITING ASSUMPTIONS that materially affect interpretation: ` +
	`(1) this is OPERATING-COST ONLY — vehicle purchase price, depreciation, insurance, registration, taxes, financing, and resale value are NOT included, so this is NOT full Total Cost of Ownership in the accounting sense; ` +
	`(2) maintenance_savings_estimate is a flat $50-per-month heuristic, not a real per-vehicle service-record sum; ` +
	`(3) per-month equivalent_gas_cost in monthly_breakdown is ESTIMATED from each month's charging energy rather than from actual per-month distance, so a month with low charging but high driving will appear cheaper than reality; ` +
	`(4) gas_efficiency_mpg, gas_price, and base_cost_per_kwh come from user-editable settings — when the user has not configured them the deterministic defaults apply (25 MPG, $3.50/gal, $0.12/kWh). ` +
	`If total_sessions is 0 or months_of_ownership equals 1 (the floor), say plainly that there is not yet enough history to draw conclusions rather than inventing a savings story. ` +
	`If total_savings is NEGATIVE (electricity is more expensive than the gas equivalent), say so PLAINLY and HONESTLY — never cheerlead, and never recommend buying or switching to a gas vehicle, which is out of scope for an EV operating-cost narrator. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 3-5 sentences explaining the dominant savings driver (cost-per-km gap, sessions count, monthly trend), the most relevant limiting assumption, and an honest data-quality note when applicable, grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The name MUST be registered in the
// process-wide tools.Registry — `query_tco_summary` is registered
// by RegisterTCONarrationTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// The tool is READ / pure-functional: it does NOT touch the
// database write path (the underlying ComputeTCOSummary helper
// only runs SELECTs against charging_sessions + drives +
// settings), and the dispatcher's deny-all confirm gate is
// therefore never reached in practice — defence in depth in case
// a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_tco_summary",
}

// Strategy is the concrete strategy.Strategy implementation for
// the tco-narration surface. Construct via [New]; the zero value
// is intentionally non-functional so a forgotten constructor
// surfaces as a runtime nil dereference rather than silently
// using empty defaults.
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

// Tools implements [strategy.Strategy]. Returns a defensive copy
// of the allowed tool names so a caller cannot mutate the
// package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler builds the synthesised "narrate vehicle N's
// ownership cost" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyDigest wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Redaction requirements use PolicyDigest from
// internal/ai/redact/policies.go. It allows ClassVehicleName only;
// aggregate cost data is user-visible. This strategy reuses
// PolicyDigest directly when the per-feature allow-list is
// identical to PolicyDigest's (ClassVehicleName only,
// ModeRedactedTags) — predictive-maintenance / state-machine
// debugger narrator / mqtt-sse inspector explanations all do
// the same. The dispatcher installs the same instance per-request
// regardless of identifier; a future per-feature divergence is a
// policy change rather than an in-strategy edit.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyDigest())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/tco-narration/goldens.yaml` directly
// (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
