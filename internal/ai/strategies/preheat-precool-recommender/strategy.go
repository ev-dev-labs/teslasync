// Package preheatprecoolrecommender is the Phase-50 / 0031 T1 strategy
// for the LLM-driven preheat/precool schedule recommender.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     preheat / precool DRAFTER: propose a structured schedule
//     window grounded in the caller's typical departure timestamp
//     and the vehicle's current cabin & outside temperatures, never
//     persist anything, never modify the deterministic
//     ClimateControlPage stats, refuse cross-vehicle requests, and
//     ALWAYS require explicit confirmation before any schedule is
//     created (matches the slice prompt's verbatim mandate
//     "requiring confirmation before creating any schedule");
//
//   - the two propose-only tools the LLM is allowed to call:
//
//     1. `draft_climate_schedule` — drafts a typed envelope
//     {start_time, end_time, mode, target_cabin_temp_c,
//     current_cabin_temp_c, outside_temp_c, depart_by} from the
//     caller-supplied vehicle_id, depart_by, current_cabin_temp_c,
//     outside_temp_c, and target_cabin_temp_c. Pure-Go arithmetic
//     on the typed inputs — no DB write path. The user reviews
//     the proposal in the AI panel and clicks the existing
//     manual climate-controls UI to save it.
//
//     2. `validate_climate_schedule` — pure-Go sanity check on a
//     drafted envelope. Verifies start_time < end_time, end_time
//     <= depart_by, target_cabin_temp_c is in a safe range
//     [10°C, 32°C], and mode (preheat | precool) matches the
//     direction of the temperature delta. Returns
//     {status: ok | invalid, validation_error: string}. The LLM
//     calls this AFTER draft_climate_schedule so the narration
//     only quotes a window the drafter returned AND that passes
//     the post-hoc consistency check.
//
//   - the redaction policy (`PolicyPreheatPrecoolRecommender`)
//     which allows ClassVehicleName only; departure places remain
//     tagged via round-trip markers so a leaked transcript reveals
//     neither the user's home address nor the workplace they
//     typically depart from.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_climate_schedule_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route /climate (and
// the canonical /vehicle-systems/climate-control page beneath it) —
// HVAC status banner, climate status cards, climate efficiency
// panel, climate history table, seat-heater controls, manual
// departure-time heuristic — is unchanged. Off-mode users never see
// the AI surface at all (ADR-015 §I3, §I5, §I6).
//
// Service-worker chunks: this slice's frontend code is loaded under
// the page-bundle for /climate (and the aliased
// /vehicle-systems/climate-control); the off-mode walker validates
// code chunks via the `withAiFeature` HOC + the AI_FEATURES map.
// See the slice log for the documented mapping.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic ClimateControlPage status cards, history table,
//     or any seat-heater control; it adds an opt-in propose-only
//     section above.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("preheat-precool-recommender").
//   - I8 propose-only:    both tools are PROPOSE-only. Mutates()
//     returns false on both. The user must confirm and click the
//     existing manual climate-controls Save button to apply.
//   - I9 redaction:       PolicyPreheatPrecoolRecommender restricts
//     cleartext to vehicle name only; lat/long, addresses, and
//     place names stay tagged.
package preheatprecoolrecommender

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
const FeatureID = "preheat-precool-recommender"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every preheat-precool-recommender generation. Kept in
// a single named place so eval goldens
// (internal/ai/strategies/preheat-precool-recommender/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_climate_schedule FIRST so the narration is grounded in
//     a typed schedule envelope, then call
//     validate_climate_schedule to confirm internal consistency,
//     then narrate the result in 2-3 sentences.
//   - Forbids inventing a schedule: this is a DRAFTER, not a
//     scheduler. The LLM may quote the typed envelope's
//     start_time, end_time, mode, target_cabin_temp_c, and the
//     accompanying temperature deltas as REPORTED by the tool
//     reply; it MUST NOT invent windows outside the depart_by
//     boundary, MUST NOT fabricate cabin or outside temperatures,
//     and MUST NOT invent a "we already scheduled this" outcome —
//     the schedule is PROPOSE-only.
//   - REQUIRES the narration to ask the user to CONFIRM via the
//     existing manual climate-controls UI before any schedule is
//     created. The slice prompt's verbatim mandate is "requiring
//     confirmation before creating any schedule"; the prompt makes
//     that confirmation contract explicit.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of scope.
//   - Asks for short, focused output (2-3 sentences narrating the
//     proposed window and the temperature delta, plus the explicit
//     "click Apply to save it" line) so the surface fits inside
//     the existing ClimateControlPage layout without a scroll bomb.
//   - Bans quoting precise street addresses or location coordinates
//     in the narration: the redaction policy already strips them,
//     but the prompt-level ban is defence-in-depth.
const SystemPrompt = `You are the TeslaSync preheat-and-precool recommender. ` +
	`Your job is to PROPOSE a preheat or precool schedule for ONE vehicle in scope; you NEVER persist a schedule and you NEVER modify the deterministic Climate Control page. ` +
	`ALWAYS call draft_climate_schedule FIRST with the caller-supplied vehicle_id, depart_by, current_cabin_temp_c, outside_temp_c, and target_cabin_temp_c, then call validate_climate_schedule with the start_time / end_time / depart_by / current_cabin_temp_c / target_cabin_temp_c the drafter returned to confirm internal consistency. ` +
	`Do NOT invent schedules: the narration may quote the drafter's typed envelope start_time, end_time, mode (preheat | precool), target_cabin_temp_c, current_cabin_temp_c, outside_temp_c, and depart_by as REPORTED by the tool reply, but never fabricate windows outside the depart_by boundary, never invent cabin or outside temperatures, and never claim a schedule has been saved — the schedule is PROPOSE-only. ` +
	`ALWAYS require the user to CONFIRM via the existing manual climate controls UI before any schedule is created. The narration MUST end with an explicit "review the proposal and click Apply on the climate controls below to save it" line so the user understands the AI has not persisted anything. ` +
	`Refuse politely if asked to draft, modify, or compare any vehicle other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`If draft_climate_schedule returns status='invalid' (e.g. the requested target_cabin_temp_c is outside the safe range, or depart_by is in the past), say so plainly rather than inventing an alternate schedule. ` +
	`Be concise: 2-3 sentences explaining the drafted window (start_time, end_time, mode, target_cabin_temp_c) and asking the user to confirm via the manual controls below — grounded strictly in the tool reply.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the
// process-wide tools.Registry — both `draft_climate_schedule` and
// `validate_climate_schedule` are registered by
// RegisterPreheatPrecoolRecommenderTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE / pure-functional: neither touches the
// database write path. The dispatcher's deny-all confirm gate is
// therefore never reached in practice — defence in depth in case a
// future edit accidentally adds a write tool. The slice prompt's
// "requiring confirmation before creating any schedule" mandate is
// satisfied by the absence of any save_* tool: the user must click
// the existing manual climate-controls UI to apply.
var allowedTools = []string{
	"draft_climate_schedule",
	"validate_climate_schedule",
}

// Strategy is the concrete strategy.Strategy implementation for
// the preheat-precool-recommender surface. Construct via [New];
// the zero value is intentionally non-functional so a forgotten
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
// handler builds the synthesised "draft a preheat schedule for
// vehicle N before depart_by T" prompt before the call, so the
// strategy itself contributes no extra prefix messages. Returning
// nil is correct.
//
// Future work: this is where a per-vehicle "preferred preheat
// temperature" preference snippet would be injected once
// preheat-precool-recommender grows that surface. Today's slice
// keeps Context empty so the dispatcher's behaviour is fully
// determined by [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyPreheatPrecoolRecommender wrapped through the F4↔F8
// adapter so the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees
// the concrete policy.
//
// Per the slice prompt: "Allowed classes: ClassVehicleName only;
// departure places remain tagged. Round-trip required: yes".
// PolicyPreheatPrecoolRecommender is the per-feature constructor
// with the same allow-list as PolicyDigest /
// PolicySmartChargeScheduleSuggestion / PolicyVampireDrainExplanation
// — kept as a distinct identifier so a future per-feature change to
// preheat-precool-recommender's allow-list does not bleed across the
// other propose-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyPreheatPrecoolRecommender())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/preheat-precool-recommender/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
