// Package periodcomparenarration implements LLM-narrated period comparison.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     period-compare explainer: narrate WHY the per-metric deltas
//     are what they are using ONLY the values returned by the tool
//     reply, never change the deterministic deltas, never invent
//     numbers, refuse cross-vehicle requests, and explicitly
//     surface the per-metric percent change with directional
//     phrasing;
//
//   - the single read-only tool the LLM is allowed to call —
//     `query_period_compare` — which composes the existing
//     api.ComputePeriodStats helper through a narrow
//     [PeriodCompareSource] port and reuses the SAME deterministic
//     aggregate the chart on /period-compare (and its alias
//     /analytics/compare) renders. The tool is pure-functional: it
//     does NOT mutate fleet state and adds NO new SQL — every read
//     goes through the same shared helper that already backs the
//     deterministic GET /api/v1/analytics/period-stats handler;
//
//   - the redaction policy (`PolicyPeriodCompareNarration`) which
//     allows ClassVehicleName only; VIN, lat/long, addresses, and
//     place names remain tagged via round-trip markers so a leaked
//     transcript does not reveal where the user lives, works, or
//     drives.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_period_compare_narration_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /period-compare (alias /analytics/compare) — Vehicle/Period
// selectors, the disambiguation banner, six MetricCards (distance,
// drives, energy, efficiency, cost, CO2), the side-by-side
// BarChart, the comparison DataTable, and the deterministic
// insights bullets — is unchanged. The deterministic period-stats
// model remains the canonical baseline; off-mode users never see
// the AI surface at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic PeriodComparePage chart, summary cards, or
//     deterministic insights panel; it adds an opt-in narrative
//     section alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("period-compare-narration").
//   - I9 redaction:       PolicyPeriodCompareNarration restricts
//     cleartext to vehicle name only; lat/long, addresses, place
//     names, and charging-location identifiers stay tagged so a
//     leaked transcript does not reveal where the user lives,
//     works, or drives.
package periodcomparenarration

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
const FeatureID = "period-compare-narration"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every period-compare-narration generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/period-compare-narration/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_period_compare before narrating so the narration is
//     grounded in the canonical period-stats envelope.
//   - Forbids changing the deltas: this is an EXPLAINER, not a
//     calculator. The LLM may quote distance, drives, energy,
//     efficiency, cost, CO2, and the per-metric percent change
//     returned by the tool; it MUST NOT invent alternate totals,
//     alternate deltas, or alternate percent changes.
//   - REQUIRES the narrator to honestly disclose insufficient
//     data (zero drives in either window) rather than inventing a
//     trend.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (2-3 sentences narrating the
//     dominant deltas + directional phrasing) so the surface fits
//     inside the existing PeriodComparePage layout without a
//     scroll bomb.
//   - Bans quoting precise street addresses or location coordinates
//     in the narration: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync period-compare narrator. ` +
	`Your job is to EXPLAIN the deterministic period-over-period analytics for ONE vehicle in scope; you NEVER change the deltas or invent numbers. ` +
	`ALWAYS call query_period_compare FIRST with the caller-supplied vehicle_id and the two trailing-day windows, and narrate the result. ` +
	`Do NOT recompute, override, or contradict the deltas: the narration may quote total distance, total drives, energy used, average efficiency, total cost, CO2 saved, AND the per-metric percent change returned by the tool, but never invent alternate totals, never fabricate a percent change the tool did not return, and never reclassify a positive change as negative or vice versa. ` +
	`ALWAYS describe directional changes honestly using the tool's per-metric percent_change sign — positive means Period A was higher than Period B, negative means Period A was lower. Use phrases like "X% more" / "X% less" / "roughly flat" rather than absolute superlatives. ` +
	`If either window has zero drives or zero energy (period_a.total_drives == 0 OR period_b.total_drives == 0), say so plainly rather than inventing a percent change for a zero baseline. ` +
	`Cost figures are best-effort and may mix currencies if the user has multi-currency charging sessions; surface that caveat when total_cost is non-zero. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences explaining which one or two metrics moved most (e.g. "Roadie drove about 15% more in Period A than Period B and consumed 12% more energy; efficiency was roughly flat"), grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The name MUST be registered in the
// process-wide tools.Registry — `query_period_compare` is
// registered by RegisterPeriodCompareNarrationTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// The tool is READ / pure-functional: it does NOT touch the
// database write path (the underlying ComputePeriodStats helper
// only runs SELECTs against drives + charging_sessions), and the
// dispatcher's deny-all confirm gate is therefore never reached
// in practice — defence in depth in case a future edit
// accidentally adds a write tool.
var allowedTools = []string{
	"query_period_compare",
}

// Strategy is the concrete strategy.Strategy implementation for
// the period-compare-narration surface. Construct via [New]; the
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
// handler builds the synthesised "narrate vehicle N's period
// comparison" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyPeriodCompareNarration wrapped through the F4↔F8 adapter
// so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees
// the concrete policy.
//
// Per the feature requirements: "Allowed classes: ClassVehicleName only;
// aggregate analytics data is user-visible. Round-trip required:
// yes". PolicyPeriodCompareNarration is the per-feature constructor
// with the same allow-list as PolicyDigest /
// PolicyCostForecastNarration — kept as a distinct identifier so a
// future per-feature change to period-compare-narration's
// allow-list does not bleed across the other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyPeriodCompareNarration())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/period-compare-narration/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
