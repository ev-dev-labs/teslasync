// Package vampiredrainexplanation is the Phase-50 / 0030 C5 strategy
// for the LLM-narrated vampire-drain (idle-energy-loss) explanation.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     vampire-drain explainer: narrate WHY the recent idle-drain
//     numbers look the way they do using ONLY the values returned
//     by the tool replies, never invent events, never persist
//     state, never modify the deterministic VampireDrainStats /
//     VampireDrainEvent envelopes the chart and table render,
//     refuse cross-vehicle requests, and explicitly surface the
//     limits of the inference (Sentry / climate / ambient-temp
//     correlation only — no causation claims);
//
//   - the two read-only tools the LLM is allowed to call:
//
//     1. `query_vampire_drain_windows` — typed envelope derived
//     from the SAME *database.VampireDrainRepo that backs the
//     canonical baseline GET /vampire-drain + GET
//     /vampire-drain/stats handlers. The AI narration is grounded
//     in the same numbers the chart renders, never a parallel
//     re-implementation. No new SQL is added by this slice.
//
//     2. `retrieve_idle_drain_chunks` — F7 RAG retrieval over the
//     per-feature source-type allowlist {idle_drain,
//     vehicle_state, climate_state}. None of the three is wired
//     into the F7 indexer today (slice 0008 only indexes
//     drive_summary + charge_session); they are reserved by
//     string for forward-compatibility — the gated
//     `ai_idle_drain_indexer` job (registered via
//     features.Registry["vampire-drain-explanation"].Routes.JobNames)
//     will fan out into the idle-drain corpus once a future
//     slice wires the per-event embeddings. Until then the
//     retriever simply returns zero chunks for these source
//     types — which is the correct behaviour: the strategy's
//     goldens already cover the zero-matches narration;
//
//   - the redaction policy (`PolicyVampireDrainExplanation`) which
//     allows ClassVehicleName only; VIN, lat/long, addresses, and
//     place names remain tagged via round-trip markers so a leaked
//     transcript reveals neither the user's home charger address
//     nor the locations they regularly park.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_vampire_drain_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /vampire-drain (and its alias /charging/vampire-drain) — summary
// metrics cards, drain-rate trend chart, daily-drain bar chart,
// drain-sessions table, tips panel — is unchanged. Off-mode users
// never see the AI surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this slice's frontend code is loaded
// under the page-bundle for /vampire-drain (and the aliased
// /charging/vampire-drain); the off-mode walker validates code
// chunks via the `withAiFeature` HOC + the AI_FEATURES map. See
// the slice log for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic VampireDrainPage chart, summary cards, or
//     tips panel; it adds an opt-in narrative section above.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("vampire-drain-explanation").
//   - I9 redaction:       PolicyVampireDrainExplanation restricts
//     cleartext to vehicle name only; lat/long, addresses, and
//     place names stay tagged so a leaked transcript does not
//     reveal where the user lives, works, or parks.
package vampiredrainexplanation

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
const FeatureID = "vampire-drain-explanation"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every vampire-drain-explanation generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/vampire-drain-explanation/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_vampire_drain_windows before narrating so the
//     narration is grounded in the canonical vampire-drain
//     envelope. retrieve_idle_drain_chunks is OPTIONAL — it
//     returns zero chunks today and the strategy must narrate
//     gracefully when no chunks are returned.
//   - Forbids inventing events: this is an EXPLAINER, not a
//     detector. The LLM may quote the deterministic stats
//     (event_count, total_observed_hours, avg / median / p95
//     drain_pct_per_day, sample_window_days), the recent worst
//     event (start/end, duration, drain%, ambient_temp_c_avg),
//     and the per-event drivers (Sentry on, climate on, very
//     long parked window) as REPORTED by the tool reply; it MUST
//     NOT invent windows the tool did not return, MUST NOT
//     fabricate ambient temperatures, and MUST NOT claim
//     causation when the underlying signal only supports
//     correlation.
//   - REQUIRES the narration to honestly disclose the inference's
//     limits: vampire-drain attribution to Sentry / climate /
//     ambient temperature is CORRELATIONAL — the deterministic
//     repo derives drain windows from fsm_transitions +
//     signal_log, not from a controlled experiment. Use phrases
//     like "appears correlated with" rather than "caused by".
//   - REQUIRES the narrator to honestly disclose insufficient
//     data (event_count == 0 or sample_window_days < the minimum
//     useful window) rather than inventing a drivers list.
//   - Refuses cross-vehicle requests: the AI handler always
//     scopes to the caller-supplied vehicle_id from the body;
//     any other vehicle ID in the user message is by definition
//     out of scope.
//   - Asks for short, focused output (2-3 sentences narrating
//     the recent idle drain and the most likely drivers) so the
//     surface fits inside the existing VampireDrainPage layout
//     without a scroll bomb.
//   - Bans quoting precise street addresses or location
//     coordinates in the narration: the redaction policy already
//     strips them, but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync vampire-drain narrator. ` +
	`Your job is to EXPLAIN the deterministic idle-energy-loss (vampire-drain) signal for ONE vehicle in scope; you NEVER invent events and you NEVER modify the deterministic stats. ` +
	`ALWAYS call query_vampire_drain_windows FIRST with the caller-supplied vehicle_id and narrate the result. ` +
	`You MAY also call retrieve_idle_drain_chunks for additional per-event context, but it is OPTIONAL — narrate gracefully when zero chunks are returned. ` +
	`Do NOT invent windows: the narration may quote the deterministic envelope's event_count, total_observed_hours, avg / median / p95 drain_pct_per_day, sample_window_days, the recent worst event (start, end, duration_hours, drain_pct, ambient_temp_c_avg), and the per-event drivers (Sentry on, climate on, very long parked window) as REPORTED by the tool reply, but never fabricate windows the tool did not return, never invent ambient temperatures, and never claim a Sentry / climate / temperature attribution that the tool reply does not support. ` +
	`ALWAYS surface the inference's limits honestly: vampire-drain attribution to Sentry, climate, or ambient temperature is CORRELATIONAL — the deterministic repo derives drain windows from fsm_transitions + signal_log, not from a controlled experiment. Use phrases like "appears correlated with" rather than "caused by". ` +
	`If event_count is 0 or the sample window is too short to be meaningful, say so plainly rather than inventing a drivers list. ` +
	`Refuse politely if asked to narrate, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences explaining the recent idle drain rate, whether it is in line with the typical fleet, and which deterministic per-event driver most strongly correlates (e.g. "Roadie's recent idle drain averages about 1.4% / day, slightly above the typical fleet; the worst recent window appears correlated with Sentry being on for an extended cold-weather park"), grounded strictly in the tool reply.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the
// process-wide tools.Registry — both `query_vampire_drain_windows`
// and `retrieve_idle_drain_chunks` are registered by
// RegisterVampireDrainExplanationTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are READ / pure-functional: neither touches the
// database write path. query_vampire_drain_windows composes the
// SAME *database.VampireDrainRepo Events / Stats methods that back
// the canonical baseline GET /vampire-drain + GET
// /vampire-drain/stats handlers; retrieve_idle_drain_chunks goes
// through the F7 retrieval entry point and only issues SELECTs
// against the embeddings table. The dispatcher's deny-all confirm
// gate is therefore never reached in practice — defence in depth
// in case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_vampire_drain_windows",
	"retrieve_idle_drain_chunks",
}

// Strategy is the concrete strategy.Strategy implementation for
// the vampire-drain-explanation surface. Construct via [New]; the
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
// handler builds the synthesised "narrate vehicle N's vampire
// drain" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "preferred parking
// pattern" preference snippet would be injected once
// vampire-drain-explanation grows that surface. Today's slice keeps
// Context empty so the dispatcher's behaviour is fully determined
// by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyVampireDrainExplanation wrapped through the F4↔F8 adapter
// so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees
// the concrete policy.
//
// Per the slice prompt: "Allowed classes: ClassVehicleName only;
// locations and schedules remain tagged. Round-trip required:
// yes". PolicyVampireDrainExplanation is the per-feature
// constructor with the same allow-list as PolicyDigest /
// PolicyCostForecastNarration — kept as a distinct identifier so
// a future per-feature change to vampire-drain-explanation's
// allow-list does not bleed across the other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyVampireDrainExplanation())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/vampire-drain-explanation/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
