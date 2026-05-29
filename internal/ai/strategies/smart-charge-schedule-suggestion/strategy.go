// Package smartchargeschedulesuggestion defines the LLM-assisted smart-charge schedule strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     charge-schedule agent — produce a structured charge schedule
//     proposal via typed tools, do NOT save anything, NEVER write
//     SQL, refuse cross-user requests, refuse to claim costs or
//     rate-plan numbers the tool reply did not return;
//   - the two propose-only tools the LLM is allowed to call —
//     `draft_charge_schedule` (delegates to the canonical
//     *ChargePlannerHandler.computeSchedule path via a narrow
//     ChargeScheduleComputer port) and `validate_charge_schedule`
//     (pure-Go schedule sanity check). Both are PROPOSE-only:
//     `draft_charge_schedule` is a READ-only delegate, and
//     `validate_charge_schedule` is a pure-functional validator. The
//     actual save / apply flows through the user's explicit click on
//     the existing canonical Schedule/Apply button in the
//     SmartChargePage UI; this strategy ships zero write paths;
//   - the redaction policy (`PolicySmartChargeScheduleSuggestion`)
//     which allows ClassVehicleName only; home/work locations,
//     addresses, and lat/long pairs remain tagged via round-trip
//     markers so a leaked transcript does not reveal the user's
//     locations.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_smart_charge_schedule_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot generation
// loop. The non-AI baseline rendered by the SPA route
// /charging/schedule — manual schedule form, canonical optimize
// button hitting POST /api/v1/charge-planner/optimize, deterministic
// schedule envelope, rate timeline, and the explicit Apply button
// — is unchanged. The heuristic optimizer remains the canonical
// baseline; off-mode users never see the AI surface at all
// (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the manual
//     charge-schedule form, canonical Schedule/Apply buttons, or
//     the deterministic schedule envelope; it adds an opt-in
//     agent panel alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("smart-charge-schedule-suggestion").
//   - I9 redaction:       PolicySmartChargeScheduleSuggestion
//     restricts cleartext to vehicle name only; lat/long, addresses,
//     and place names stay tagged so a leaked transcript does not
//     reveal the user's home/work locations.
package smartchargeschedulesuggestion

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
const FeatureID = "smart-charge-schedule-suggestion"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every smart-charge-schedule-suggestion generation.
// Kept in a single named place so eval goldens
// (internal/ai/strategies/smart-charge-schedule-suggestion/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS follow this tool
//     sequence"): without this, a model may answer in prose and
//     skip the typed DTOs entirely, leaving the frontend with
//     nothing to render.
//   - Forbids saving / mutating: the strategy is propose-only. The
//     actual schedule application goes through an explicit user
//     confirmation in the SmartChargePage UI by clicking the
//     existing canonical Schedule/Apply button; the LLM has no
//     tool that writes.
//   - Forbids inventing facts: only the values returned by the
//     tools may be quoted in the narration. The tool reply carries
//     the canonical optimizer's returned schedule and cost numbers;
//     inventing alternate costs, rate-plan tiers, or savings
//     figures not present in the tool reply is forbidden.
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller-supplied vehicle_id from the body; any other
//     vehicle ID in the user message is by definition out of
//     scope.
//   - Asks for short, focused output (2-3 sentences narrating the
//     proposed schedule, plus the structured proposal envelope
//     that the SPA renders) so the surface fits inside the
//     existing SmartChargePage layout without a scroll bomb.
//   - Explicitly bans quoting precise street addresses or location
//     coordinates in the narration: the redaction policy already
//     strips them, but the prompt-level ban is defence-in-depth so
//     a model that was somehow handed cleartext location data
//     still refuses to repeat it back.
const SystemPrompt = `You are the TeslaSync smart-charge-schedule agent. ` +
	`Your job is to PROPOSE a typed time-of-use-optimized charge schedule for ONE vehicle in scope; you NEVER save anything yourself. ` +
	`ALWAYS follow this tool sequence: ` +
	`(1) call draft_charge_schedule FIRST with the caller-supplied vehicle_id, target_soc, depart_by, and rate_plan_id to delegate the actual schedule to the canonical ChargePlannerHandler.computeSchedule path; ` +
	`(2) call validate_charge_schedule SECOND with the draft to confirm the proposed window is internally consistent before narrating it. ` +
	`Do NOT propose deleting, renaming, suspending, or otherwise mutating any existing charge plan or any other state — your role is strictly to propose a NEW schedule for the user to review and apply themselves. ` +
	`Do NOT invent facts that are not present in the tool output: the narration may reference the optimizer-returned start_time, end_time, target_soc, estimated_cost, savings, and rate_tier, but never invent alternate cost numbers, never fabricate rate-plan tiers, and never quote precise street addresses or location coordinates. ` +
	`Refuse politely if asked to schedule a charge for, name, or modify any vehicle other than the one named in the request. ` +
	`Be concise: a 2-3 sentence narration of the proposed schedule grounded in the tool replies, plus the structured proposal envelope the UI renders, is enough — the user reviews the structured proposal in the UI before clicking the canonical Schedule button to apply it.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry — both `draft_charge_schedule` and
// `validate_charge_schedule` are registered by
// RegisterSmartChargeScheduleSuggestionTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-only / pure-functional: `draft_charge_schedule`
// delegates to the canonical computeSchedule path WITHOUT persisting,
// and `validate_charge_schedule` is a pure-Go sanity check that does
// not touch the database. The dispatcher's deny-all confirm gate is
// therefore never reached in practice — defence in depth in case a
// future edit accidentally adds a write tool.
var allowedTools = []string{
	"draft_charge_schedule",
	"validate_charge_schedule",
}

// Strategy is the concrete strategy.Strategy implementation for the
// smart-charge-schedule-suggestion surface. Construct via [New]; the
// zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
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
// handler builds the synthesised "schedule a charge for vehicle N"
// prompt before the call, so the strategy itself contributes no
// extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-user "preferred rate plan" or
// "preferred off-peak window" preference snippet would be injected
// once smart-charge-schedule-suggestion grows that surface. For now,
// [System] plus History fully determines dispatcher behaviour.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicySmartChargeScheduleSuggestion through the redaction adapter so
// the dispatcher's per-request ctx-installation step
// (dispatch.Run installs the policy via redact.WithPolicy) sees the
// concrete policy.
//
// PolicySmartChargeScheduleSuggestion is the per-feature constructor
// with the same allow-list as PolicyDigest / PolicyTripPlannerLLMAgent
// — kept as a distinct identifier so a future per-feature change to
// smart-charge-schedule-suggestion's allow-list does not bleed
// across the other read-only narrators.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicySmartChargeScheduleSuggestion())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness loads
// goldens from
// `internal/ai/strategies/smart-charge-schedule-suggestion/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
