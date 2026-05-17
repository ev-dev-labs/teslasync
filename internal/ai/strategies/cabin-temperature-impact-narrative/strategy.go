// Package cabintemperatureimpactnarrative is the Phase-50 / 0032 T2
// strategy for the LLM-narrated cabin temperature impact explainer.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     temperature-impact narrator: explain HOW outside ambient
//     temperature affects efficiency and range using ONLY the
//     bucket / monthly-trend / sample aggregates the tool returns,
//     never invent percentages, never reclassify the best/worst
//     bucket, refuse cross-vehicle requests, and explicitly
//     surface the small-sample / insufficient-data caveat;
//
//   - the single read-only tool the LLM is allowed to call —
//     `query_temperature_impact` — which composes the existing
//     api.ComputeTemperatureImpact helper through a narrow
//     [TemperatureImpactSource] port and reuses the SAME
//     deterministic aggregation the chart on
//     /temperature-impact (and its registry-aliased
//     /analytics/temperature-impact) already renders. The tool is
//     pure-functional: it does NOT mutate fleet state and adds NO
//     new SQL — every read goes through the same shared helper
//     that already backs the deterministic GET
//     /api/v1/analytics/temperature-impact handler;
//
//   - the redaction policy (`PolicyCabinTemperatureImpactNarrative`)
//     which allows ClassVehicleName only; VIN, lat/long, addresses,
//     and place names remain tagged via round-trip markers so a
//     leaked transcript does not reveal the user's typical route
//     start/end nor the schedule that the recent-drives sample
//     might surface.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_temperature_impact_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /temperature-impact — the temperature-vs-efficiency scatter,
// the bucket bars, the optimal-range panel, the seasonal trend
// line, and the temperature tips — is unchanged. The deterministic
// aggregates remain the canonical baseline; off-mode users never
// see the AI surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this slice's frontend code is loaded
// under the page-bundle for /temperature-impact; the off-mode
// walker validates code chunks via the `withAiFeature` HOC + the
// AI_FEATURES map. See the slice log for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic temperature-impact charts; it adds an opt-in
//     narrative section alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("cabin-temperature-impact-narrative").
//   - I9 redaction:       PolicyCabinTemperatureImpactNarrative
//     restricts cleartext to vehicle name only; lat/long,
//     addresses, place names, and schedule identifiers stay tagged
//     so a leaked transcript does not reveal where or when the
//     user typically drives.
package cabintemperatureimpactnarrative

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
const FeatureID = "cabin-temperature-impact-narrative"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every cabin-temperature-impact-narrative generation.
// Kept in a single named place so eval goldens
// (internal/ai/strategies/cabin-temperature-impact-narrative/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_temperature_impact before narrating so the narration is
//     grounded in the canonical temperature-impact envelope.
//   - Forbids changing the aggregates: this is an EXPLAINER, not a
//     re-aggregator. The LLM may quote bucket labels, the
//     best/worst bucket avg_battery_pct_per_100km figures, the
//     monthly trend, and the deterministic insights returned by
//     the tool; it MUST NOT invent alternate efficiency numbers,
//     alternate bucket boundaries, or alternate temperature ranges.
//   - REQUIRES the narration to honestly disclose insufficient
//     data (has_enough_data=false) rather than inventing a slope.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (2-3 sentences narrating the
//     drivers of the cabin-temperature impact + assumptions) so
//     the surface fits inside the existing TemperatureImpactPage
//     layout without a scroll bomb.
//   - Bans quoting precise street addresses or location coordinates
//     in the narration: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync cabin temperature impact narrator. ` +
	`Your job is to EXPLAIN how outside ambient temperature affects driving efficiency and range for ONE vehicle in scope; you NEVER change the aggregates or invent numbers. ` +
	`ALWAYS call query_temperature_impact FIRST with the caller-supplied vehicle_id and narrate the result. ` +
	`Do NOT recompute, override, or contradict the aggregates: the narration may quote bucket labels, the avg_battery_pct_per_100km of the best and worst bucket, the monthly seasonal trend (avg_temp_c paired with avg_efficiency), and the deterministic insights the tool returns, but never invent alternate bucket boundaries, never fabricate a percentage the tool did not return, and never reclassify the best/worst bucket. ` +
	`ALWAYS surface the method honestly: the buckets are computed by averaging recent drives grouped by ambient cabin temperature ranges, and the monthly trend is a rolling 12-month average — these are descriptive aggregates, NOT a forecast or a regression model. Use phrases like "your recent drives" or "based on recent history" rather than language that implies prediction. ` +
	`If has_enough_data is false (fewer than the minimum required drives), say so plainly rather than inventing a slope, a percentage, or a best/worst bucket. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences explaining which temperature range is most efficient for this vehicle and what the seasonal pattern looks like (e.g. "Roadie averages best efficiency in the 15-25°C bucket and shows about a 20% efficiency drop below 0°C; the monthly trend confirms a cold-weather dip from December through February"), grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The name MUST be registered in the
// process-wide tools.Registry — `query_temperature_impact` is
// registered by RegisterCabinTemperatureImpactNarrativeTools at
// boot. The dispatcher refuses to mount a strategy that references
// an unknown tool.
//
// The tool is READ / pure-functional: it does NOT touch the
// database write path (the underlying ComputeTemperatureImpact
// helper only runs SELECTs against drives), and the dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a write
// tool.
var allowedTools = []string{
	"query_temperature_impact",
}

// Strategy is the concrete strategy.Strategy implementation for
// the cabin-temperature-impact-narrative surface. Construct via
// [New]; the zero value is intentionally non-functional so a
// forgotten constructor surfaces as a runtime nil dereference
// rather than silently using empty defaults.
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
// handler builds the synthesised "narrate vehicle N's cabin
// temperature impact" prompt before the call, so the strategy
// itself contributes no extra prefix messages. Returning nil is
// correct.
//
// Future work: this is where a per-vehicle "preferred bucket
// granularity" preference snippet would be injected once the
// surface grows that knob. Today's slice keeps Context empty so
// the dispatcher's behaviour is fully determined by [System] +
// History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyCabinTemperatureImpactNarrative wrapped through the F4↔F8
// adapter so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees
// the concrete policy.
//
// Per the slice prompt: "Allowed classes: ClassVehicleName only;
// trip and location details remain tagged. Round-trip required:
// yes". PolicyCabinTemperatureImpactNarrative is the per-feature
// constructor with the same allow-list as PolicyDigest /
// PolicyCostForecastNarration / PolicyVampireDrainExplanation —
// kept as a distinct identifier so a future per-feature change to
// cabin-temperature-impact-narrative's allow-list does not bleed
// across the other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyCabinTemperatureImpactNarrative())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/cabin-temperature-impact-narrative/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
