// Package geofenceawareautomationsuggestions is the Phase-50 / G3
// strategy for the LLM-assisted "geofence-aware automation
// suggestions" surface.
//
// The strategy declares:
//
//   - the system prompt that frames the suggester as a propose-only
//     assistant — produce a typed Automation graph DTO whose trigger
//     and/or conditions reference one of the user's existing geofences
//     (by `place_id`), via the F4 tools, do NOT save anything, NEVER
//     write SQL, refuse cross-vehicle requests, refuse to disable,
//     suspend, or modify existing automations or geofences;
//   - the two propose-only tools the LLM is allowed to call —
//     `draft_automation_graph` and `validate_automation_graph` —
//     both of which are pure-functional DTO transforms that do NOT
//     touch the database. The actual mutation flows through the
//     existing POST /api/v1/automations typed handler AFTER the
//     user explicitly clicks Save in the AutomationBuilderPage UI;
//   - the redaction policy (`PolicyAlertBuilder`) which allows
//     nothing — vehicle, place, and channel identifiers flow
//     through the typed F4 tools, not through prose. Every PII
//     class is redacted via round-trip tags. The policy is shared
//     with `nl-alert-builder` and `nl-automation-builder` because
//     all three strategies have the same trust posture: identifiers
//     flow through tools, narrative is identifier-free.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_geofence_aware_automation_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline at POST /api/v1/automations
// (the canonical typed AutomationHandler.Create + decode path with
// per-step validators at `internal/api/automation_handler_decode.go`)
// is unaffected — the deterministic graph editor + validators
// remain the canonical baseline in off mode (ADR-015 §I3).
//
// The "geofence-aware" framing distinguishes this strategy from the
// existing `nl-automation-builder` (slice 0016): rather than
// drafting an Automation from a free-form natural-language prompt
// against an empty context, this strategy asks the LLM to propose
// an Automation whose trigger and/or conditions reference one of
// the user's CURRENT, EXISTING geofences (by `place_id`). The
// handler injects a deterministic catalog of geofences (id + name +
// category) into the user message so the LLM can pick a real
// `place_id` rather than hallucinating one. Both strategies share
// the same tools and policy; they differ in the system prompt's
// directive set (geofence-first selection vs. open-ended drafting)
// and in the handler's user-message synthesis.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the typed
//                         Automation validator or the existing
//                         AutomationBuilderPage editor. Save path
//                         is the existing handler; the AI only
//                         DRAFTS.
//   - I7 per-feature:     the AI route is gated by
//                         guard.Wrap("geofence-aware-automation-suggestions").
//   - I9 redaction:       PolicyAlertBuilder denies all classes;
//                         identifiers (vehicle_id, place_id) flow
//                         through tools, not prose.
package geofenceawareautomationsuggestions

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy. Exported
// so wiring code (router.go, tests) can reference the same constant
// the strategy registers itself with — typo-proof via compile error.
const FeatureID = "geofence-aware-automation-suggestions"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every drafting turn. Kept in a single named place so
// eval goldens
// (internal/ai/strategies/geofence-aware-automation-suggestions/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour ("ALWAYS call draft_automation_graph
//     FIRST"): without this, a model may answer in prose and skip the
//     typed DTO entirely, leaving the frontend with nothing to render
//     in the typed AutomationBuilder form.
//   - Forbids saving / mutating: the strategy is propose-only. The
//     actual create-automation call goes through the existing typed
//     POST /api/v1/automations handler AFTER the user explicitly
//     confirms in the UI; the LLM has no tool that writes.
//   - Forbids inventing place_id values: the LLM MUST pick a
//     `place_id` from the deterministic geofence catalog the handler
//     injects into the user message. Inventing a `place_id` produces
//     a draft the validator silently rejects (FK violation at save
//     time), wasting the user's review.
//   - Asks for at least one geofence-anchored step (trigger or
//     condition): a draft that references no geofence at all is
//     out of scope for this surface (the user has the
//     `nl-automation-builder` for that).
//   - Refuses cross-vehicle requests: the AI handler always scopes
//     to the caller's own vehicle (or the explicit selection sent
//     in the request); any other vehicle ID in the user message is
//     by definition out of scope.
const SystemPrompt = `You are the TeslaSync geofence-aware automation suggester. ` +
	`Your job is to DRAFT a typed Automation (one trigger plus optional conditions plus one or more actions) that references at least ONE of the user's existing geofences (by place_id) via either trigger_geofence or condition_geofence; you NEVER save anything yourself. ` +
	`ALWAYS call draft_automation_graph FIRST with the typed fields you can infer from the user's request, then call validate_automation_graph on the proposed draft to confirm it satisfies the Automation contract. ` +
	`Do NOT propose suspending, disabling, deleting, or otherwise mutating any existing automation or any existing geofence — your role is strictly to propose a NEW automation for the user to review and save themselves. ` +
	`Use ONLY place_id values that appear in the user-message geofence catalog the handler injects; never invent a place_id, never reuse a place_id from a different user, and never propose a draft whose trigger and conditions reference NO geofence at all (a non-geofence draft is out of scope for this surface — the user has the natural-language automation builder for that). ` +
	`Use ONLY the canonical trigger kinds (trigger_signal, trigger_geofence, trigger_schedule, trigger_event), condition kinds (condition_signal, condition_time_window, condition_geofence, condition_other_automation), and action kinds (action_command, action_notify, action_set_setting, action_call_automation) that the tool descriptions enumerate; never invent a kind, signal, op, command, or event_type. ` +
	`Refuse politely if asked to disclose, draft, or modify automations for any vehicle other than the one named in the request. ` +
	`Be concise: a one-sentence rationale plus the typed draft is enough — the user reviews the structured proposal in the UI before saving.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Each name MUST be registered in the
// process-wide tools.Registry (see internal/ai/tools/automation_builder.go)
// at dispatcher construction time — the dispatcher refuses to mount
// a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct / validate Automation
// graph DTOs but do NOT touch the database. The dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a write
// tool.
//
// IMPORTANT: this strategy does NOT register the tools itself —
// they are already registered by RegisterAutomationBuilderTools in
// router.go for slice 0016 (nl-automation-builder). Re-registering
// would panic (duplicate name in tools.Registry). The two
// strategies share the same process-wide tool instances; tools are
// stateless so this is safe.
var allowedTools = []string{
	"draft_automation_graph",
	"validate_automation_graph",
}

// Strategy is the concrete strategy.Strategy implementation for the
// geofence-aware automation suggester. Construct via [New]; the
// zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs — the
// strategy is a pure value with no internal state — so this is
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
// handler builds the synthesised "draft a geofence-aware automation
// for the following request, given this geofence catalog" prompt
// before the call, so the strategy itself contributes no extra
// prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "current automations
// summary" snippet would be injected once geofence-aware drafting
// grows that surface (e.g. for de-duplication against existing
// geofence-anchored automations). The current slice keeps Context
// empty so the dispatcher's behaviour is fully determined by
// [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyAlertBuilder wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Per the slice prompt: "Policy: PolicyAlertBuilder from
// internal/ai/redact/policies.go. Allowed classes: none; geofence
// IDs flow through tools". The policy's Allow list is nil, so every
// PII class — VIN, lat/long, vehicle name, addresses, phone numbers
// — is redacted to a round-trip tag before the prompt reaches the
// provider. The handler synthesises the geofence catalog as
// id + name + category (no lat/lon) so the redaction policy never
// needs to mask coordinates that should not have been emitted in
// the first place.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/geofence-aware-automation-suggestions/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
