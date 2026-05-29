// Package tripplannerllmagent implements the LLM-assisted trip-planner
// strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     planner agent — produce a structured trip-plan proposal via
//     the F4 tools, do NOT save anything, NEVER write SQL, refuse
//     cross-user requests, refuse to claim chargers exist that the
//     user has not visited;
//   - the three propose-only tools the LLM is allowed to call —
//     `query_chargers_along_route`, `query_user_charge_dwells`,
//     and `draft_trip_plan` — the first two are READ-only against
//     the existing charging_sessions table via the shared
//     ChargeSource port; the third delegates to the canonical
//     *TripPlannerHandler.computePlan path via a narrow
//     TripPlanComputer port. The actual save / route flows through
//     the user's explicit click on the existing canonical Plan
//     button in the TripPlannerPage UI; this strategy ships zero
//     write paths;
//   - the redaction policy (`PolicyTripPlannerLLMAgent`) which
//     allows ClassVehicleName only; start/end locations, charger
//     place names, and lat/long pairs are tagged via round-trip
//     markers so a leaked transcript does not reveal the user's
//     home/work locations or exact route geometry.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_trip_planner_llm_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /trip-planner
// — manual form, canonical Plan button hitting
// POST /api/v1/trip-planner/plan, deterministic plan envelope,
// map and charge-stop list — is unchanged. The heuristic planner
// remains the canonical baseline; off-mode users never see the AI
// surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks for this frontend surface load under the
// /trip-planner page bundle. The off-mode walker validates code
// chunks via the `withAiFeature` HOC and the AI_FEATURES map.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the manual
//     trip-planner form, canonical Plan button, or the
//     deterministic plan envelope; it adds an opt-in
//     agent panel alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("trip-planner-llm-agent").
//   - I9 redaction:       PolicyTripPlannerLLMAgent restricts
//     cleartext to vehicle name only; lat/long, addresses, and
//     place names stay tagged so a leaked transcript does not
//     reveal the user's home/work locations or exact route
//     geometry.
package tripplannerllmagent

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
const FeatureID = "trip-planner-llm-agent"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every trip-planner-llm-agent generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/trip-planner-llm-agent/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS follow this tool
//     sequence"): without this, a model may answer in prose and
//     skip the typed DTOs entirely, leaving the frontend with
//     nothing to render.
//   - Forbids saving / mutating: the strategy is propose-only. The
//     actual trip-plan persistence goes through an explicit user
//     confirmation in the TripPlannerPage UI by clicking the
//     existing canonical Plan button; the LLM has no tool that
//     writes.
//   - Forbids inventing facts: only the values returned by the
//     tools may be quoted in the narration. The tool reply carries
//     the user's actual past chargers, dwells, and the canonical
//     planner's plan envelope; inventing new chargers, claiming a
//     charger exists where none has been visited, or fabricating
//     ETA / arrival_soc numbers not present in the planner reply
//     is forbidden.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of
//     scope.
//   - Asks for short, focused output (2-3 sentences narrating the
//     proposed plan, plus the structured proposal envelope that
//     the SPA renders) so the surface fits inside the existing
//     TripPlannerPage layout without a scroll bomb.
//   - Explicitly bans quoting precise route coordinates or full
//     street addresses in the narration: the redaction policy
//     already strips them, but the prompt-level ban is
//     defence-in-depth so a model that was somehow handed
//     cleartext route data still refuses to repeat it back.
const SystemPrompt = `You are the TeslaSync trip-planner agent. ` +
	`Your job is to PROPOSE a typed trip plan from an origin to a destination for ONE vehicle in scope; you NEVER save anything yourself. ` +
	`ALWAYS follow this tool sequence: ` +
	`(1) call query_chargers_along_route FIRST with the caller-supplied origin/destination to see which corridor chargers the user has actually used; ` +
	`(2) call query_user_charge_dwells to learn the user's typical dwell behaviour at each charger; ` +
	`(3) call draft_trip_plan LAST with the caller-supplied origin/destination and SOC arguments to delegate the actual plan to the canonical TripPlannerHandler.computePlan path. ` +
	`Do NOT propose deleting, renaming, suspending, or otherwise mutating any existing trip, charger, or any other state — your role is strictly to propose a NEW plan for the user to review and save themselves. ` +
	`Do NOT invent facts that are not present in the tool output: the narration may reference the planner-returned arrival_soc, total_distance_m, charge_stops, and the user's actual past chargers from the corridor query, but never invent a charger the corridor query did not return, never fabricate ETA / cost / energy numbers not present in the planner reply, and never quote precise route coordinates or full street addresses. ` +
	`Refuse politely if asked to plan a trip for, name, or modify any vehicle other than the one named in the request. ` +
	`Be concise: a 2-3 sentence narration of the proposed plan grounded in the tool replies, plus the structured proposal envelope the UI renders, is enough — the user reviews the structured proposal in the UI before clicking the canonical Plan button.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — all three of
// `query_chargers_along_route`, `query_user_charge_dwells`, and
// `draft_trip_plan` are registered by
// RegisterTripPlannerLLMAgentTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// All three tools are READ-only / PROPOSE-only: they read the
// charging-history corpus and build a typed plan proposal but do
// NOT touch the database. The dispatcher's deny-all confirm gate
// is therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_chargers_along_route",
	"query_user_charge_dwells",
	"draft_trip_plan",
}

// Strategy is the concrete strategy.Strategy implementation for the
// trip-planner-llm-agent surface. Construct via [New]; the zero
// value is intentionally non-functional so a forgotten constructor
// surfaces as a runtime nil dereference rather than silently using
// empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this is
// effectively a sentinel constructor used to make wiring intent
// readable at the call site.
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
// the allowed tool names so a caller cannot mutate the package-level
// allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "plan a trip for vehicle N" prompt
// before the call, so the strategy itself contributes no extra
// prefix messages. Returning nil is correct.
//
// Future work: this is where a per-user "favoured route style"
// preference snippet (faster-vs-cheaper, prefer-superchargers) would
// be injected once trip-planner-llm-agent grows that surface.
// Context stays empty so dispatcher behaviour is fully determined by
// [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyTripPlannerLLMAgent wrapped through the F4↔F8 adapter so
// the dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// This policy allows only ClassVehicleName in cleartext. Start and
// end locations are tagged and restored only for the same user.
// PolicyTripPlannerLLMAgent intentionally stays separate from similar
// read-only narrator policies so future allow-list changes remain
// scoped to this feature.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyTripPlannerLLMAgent())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/trip-planner-llm-agent/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
