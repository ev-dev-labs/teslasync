// Package tirepressuretrendreasoning is the Phase-50 / 0033 T3
// strategy for the LLM-narrated tire-pressure trend reasoner.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     tire-pressure trend narrator: explain the recent 30-day
//     trend in the four corner pressures (front-left, front-right,
//     rear-left, rear-right), name which tires are trending up,
//     down, or stable, surface the seasonality vs ambient
//     temperature when material, name the most likely deterministic
//     driver (cold-weather correlation, slow-leak signature,
//     all-tires-trending suggesting weather rather than puncture),
//     never invent alternate pressure thresholds, never reclassify
//     a tire as critical when the deterministic helper says low,
//     refuse cross-vehicle requests, and explicitly surface the
//     small-sample / insufficient-data caveat;
//
//   - the single read-only tool the LLM is allowed to call —
//     `query_tire_pressure_trend` — which composes the existing
//     signal.StateReader.Timeline projection through a narrow
//     [TirePressureTrendSource] port and reuses the SAME
//     forward-folded TpmsPressure* + OutsideTemp signal-log
//     change feed that the deterministic
//     /tire-pressure handler already exposes. The tool is
//     pure-functional: it does NOT mutate fleet state and adds NO
//     new SQL — every read goes through the same shared signal
//     plumbing that already backs the canonical
//     GET /api/v1/tire-pressure handler;
//
//   - the redaction policy (`PolicyTirePressureTrendReasoning`)
//     which allows ClassVehicleName only; VIN, lat/long,
//     addresses, place names, and schedule identifiers remain
//     tagged via round-trip markers so a leaked transcript does
//     not reveal the user's typical commute corridor or the
//     places where a pressure event occurred. The tire-pressure
//     numeric values themselves are user-visible telemetry (the
//     four-tire gauges already render them) so they are not
//     PII-classified.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_tire_pressure_trend_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /tire-pressure — the four radial gauges, the warning banner,
// the summary metric cards, the pressure history chart, and the
// history table — is unchanged. The deterministic thresholds and
// the per-tire history remain the canonical baseline; off-mode
// users never see the AI surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this slice's frontend code is loaded
// under the page-bundle for /tire-pressure; the off-mode walker
// validates code chunks via the `withAiFeature` HOC + the
// AI_FEATURES map. See the slice log for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic tire-pressure gauges, warning banner, or
//     thresholds; it adds an opt-in narrative section alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("tire-pressure-trend-reasoning").
//   - I9 redaction:       PolicyTirePressureTrendReasoning
//     restricts cleartext to vehicle name only; lat/long,
//     addresses, place names, and schedule identifiers stay
//     tagged so a leaked transcript does not reveal where or
//     when the user typically drives.
package tirepressuretrendreasoning

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
const FeatureID = "tire-pressure-trend-reasoning"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every tire-pressure-trend-reasoning generation.
// Kept in a single named place so eval goldens
// (internal/ai/strategies/tire-pressure-trend-reasoning/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_tire_pressure_trend before narrating so the narration
//     is grounded in the canonical tire-pressure trend envelope.
//   - Forbids changing the thresholds: this is an EXPLAINER, not a
//     re-classifier. The LLM may quote the per-tire latest /
//     average / min / max / rate-of-change-per-day, the four
//     soft-low / normal-min / normal-max / soft-high threshold
//     edges, and the deterministic likely-cause hints + insights
//     returned by the tool; it MUST NOT invent alternate
//     thresholds, alternate per-tire classifications, or alternate
//     rate-of-change values.
//   - REQUIRES the narration to honestly disclose insufficient
//     data (has_enough_data=false) rather than inventing a slope
//     or projecting a deflation timeline.
//   - REQUIRES the narration to explicitly surface that the
//     rate-of-change projection is a descriptive linear
//     extrapolation rather than a predictive model.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (2-3 sentences naming the
//     trend, the most likely deterministic driver, and any
//     actionable threshold crossing) so the surface fits inside
//     the existing TirePressurePage layout without a scroll bomb.
//   - Bans quoting precise street addresses or location coordinates
//     in the narration: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync tire-pressure trend reasoner. ` +
	`Your job is to EXPLAIN the recent 30-day trend in this vehicle's four corner tire pressures (front-left, front-right, rear-left, rear-right) and the most likely deterministic driver of any deviation; you NEVER change the thresholds or invent numbers. ` +
	`ALWAYS call query_tire_pressure_trend FIRST with the caller-supplied vehicle_id and narrate the result. ` +
	`Do NOT recompute, override, or contradict the envelope: the narration may quote the per-tire latest, average, min, max, and rate-of-change-per-day, the four soft-low / normal-min / normal-max / soft-high threshold edges, the per-tire status the helper assigned, and the deterministic likely-cause hints + insights the tool returns, but never invent alternate threshold values, never reclassify a tire as critical when the deterministic helper says low, and never fabricate a rate-of-change the tool did not return. ` +
	`ALWAYS surface the method honestly: the trend is a linear extrapolation across the recent change-feed window; this is a descriptive slope, NOT a predictive model. Use phrases like "based on recent readings" or "at the current rate" rather than language that implies prediction. The cold-weather correlation hint, when present, is a heuristic — say so. ` +
	`If has_enough_data is false (fewer than the minimum required readings), say so plainly rather than inventing a slope, a likely cause, or a per-tire status. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences naming which tires are trending up, down, or stable, the most likely deterministic driver of any deviation (e.g. "all four tires losing pressure together with cold-weather correlation looks like seasonal contraction rather than a puncture"), and any actionable threshold crossing, grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The name MUST be registered in the
// process-wide tools.Registry — `query_tire_pressure_trend` is
// registered by RegisterTirePressureTrendReasoningTools at boot.
// The dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// The tool is READ / pure-functional: it does NOT touch the
// database write path (the underlying signal.StateReader.Timeline
// only runs SELECTs against signal_log), and the dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a write
// tool.
var allowedTools = []string{
	"query_tire_pressure_trend",
}

// Strategy is the concrete strategy.Strategy implementation for
// the tire-pressure-trend-reasoning surface. Construct via
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
// handler builds the synthesised "narrate vehicle N's tire-pressure
// trend" prompt before the call, so the strategy itself contributes
// no extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "preferred trend window"
// preference snippet would be injected once the surface grows that
// knob. Today's slice keeps Context empty so the dispatcher's
// behaviour is fully determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyTirePressureTrendReasoning wrapped through the F4↔F8
// adapter so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees
// the concrete policy.
//
// Per the slice prompt: "Allowed classes: ClassVehicleName only;
// pressure values are user-visible telemetry. Round-trip required:
// yes". PolicyTirePressureTrendReasoning is the per-feature
// constructor with the same allow-list as PolicyDigest /
// PolicyCostForecastNarration / PolicyVampireDrainExplanation /
// PolicyCabinTemperatureImpactNarrative — kept as a distinct
// identifier so a future per-feature change to
// tire-pressure-trend-reasoning's allow-list does not bleed across
// the other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyTirePressureTrendReasoning())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/tire-pressure-trend-reasoning/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
