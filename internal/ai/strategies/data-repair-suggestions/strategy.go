// Package datarepairsuggestions contains the LLM-backed data-repair-suggestions strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     repair-plan drafter: produce a typed RepairPlan DTO via the
//     F4 tools that targets ONE stale charging session OR ONE stale
//     drive at a time; never execute the repair; never write SQL;
//     refuse cross-vehicle requests; refuse to delete or close any
//     row that was NOT included in the in-scope stale-session
//     inventory the handler synthesises into the user message;
//
//   - the two propose-only tools the LLM is allowed to call:
//
//     1. `draft_data_repair_plan` — accept a typed
//     {target_kind, target_id, action, update_fields} input and
//     return a normalised + validated RepairPlan draft envelope.
//     The tool is per-request scope-bound to the snapshot of stale
//     IDs the handler installed via diagnostic.WithScopedDataRepairIDs;
//     the LLM CANNOT propose a repair for a row that is not in
//     scope. Defence-in-depth against prompt injection in stale-
//     row metadata fields like the parser-shipped session number.
//
//     2. `validate_data_repair_plan` — accept the same typed shape
//     and re-run the canonical validator without rebuilding the
//     draft envelope. Used by the LLM to confirm a draft is
//     acceptable before narrating it to the user.
//
//   - the redaction policy (`PolicyAlertBuilder`) which the slice
//     prompt mandates ("Allowed classes: none; IDs flow through
//     tools and proposed repairs require confirmation"): VIN,
//     lat/long, addresses, place names, vehicle-name, AND every
//     other PII class remain tagged via round-trip markers so a
//     leaked transcript reveals nothing about the operator's
//     environment, vehicle identifiers, or any value an operator
//     pasted into the request prose.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_data_repair_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop scoped to the snapshot of stale IDs visible at
// request time. The non-AI baseline rendered by the SPA route
// /system/data-repair (and the existing /data-repair admin tools)
// — the stale-charging + stale-drive lists with manual Save /
// Close / Quarantine buttons — is unchanged. The deterministic admin
// repair tools remain the canonical baseline; off-mode users never
// see the AI section at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic stale-session list, the inline edit forms, or
//     the canonical PUT /api/v1/data-repair/{kind}/{id} write
//     path. The AI proposes; the user explicitly clicks the same
//     baseline Save / Close / Quarantine button to apply.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("data-repair-suggestions").
//   - I9 redaction:      PolicyAlertBuilder redacts EVERY PII class
//     so a confused LLM cannot leak a hostname, IP, VIN, or any
//     pasted value to the model.
package datarepairsuggestions

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, the AI HTTP handler, tests) can
// reference the same constant the strategy registers itself with —
// typo-proof via compile error.
const FeatureID = "data-repair-suggestions"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every data-repair-suggestions generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/data-repair-suggestions/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_data_repair_plan with the typed fields it can infer
//     from the user's request and the stale-session inventory the
//     handler synthesises into the user message. Then it MUST call
//     validate_data_repair_plan on the proposed draft to confirm
//     it satisfies the RepairPlan contract before narrating the
//     plan to the user.
//   - Forbids executing the repair directly: this is a propose-
//     only surface. The LLM has no tool that writes; the actual
//     mutation flows through the existing typed PUT / POST /
//     DELETE /api/v1/data-repair/{kind}/{id} handlers AFTER the
//     user explicitly clicks Save / Close / Quarantine in the
//     baseline edit form. The narration MUST surface this
//     "review and click Save yourself" expectation so the user is
//     never surprised.
//   - REQUIRES the proposal to target a row that is in the
//     stale-session inventory passed in the user message. Inventing
//     a target_id that is not in the list is forbidden — the tool
//     enforces the same invariant via the per-request scope
//     binding, but the prompt-level ban is defence-in-depth.
//   - Forbids cross-vehicle requests: the AI handler always works
//     with whatever vehicles are surfaced in the stale-session
//     inventory; any other vehicle ID in the user message is by
//     definition out of scope.
//   - Asks for short, focused output (one rationale sentence per
//     proposed repair plus the typed draft) so the surface fits
//     inside the existing DataRepairPage layout without a scroll
//     bomb.
//   - Bans inventing severity-elevated framing: "this needs to be
//     fixed urgently" is editorial speculation. The AI surfaces
//     the deterministic facts (row id, action, suggested update
//     fields) and lets the user decide.
const SystemPrompt = `You are the TeslaSync data-repair-suggestions agent. ` +
	`Your job is to PROPOSE a typed RepairPlan that fixes ONE stale charging session OR ONE stale drive from the inventory the caller-supplied user message contains; you NEVER execute the repair yourself. ` +
	`ALWAYS call draft_data_repair_plan FIRST with the typed fields you can infer from the user's request and the in-scope stale-session inventory, then call validate_data_repair_plan on the proposed draft to confirm it satisfies the RepairPlan contract. ` +
	`Do NOT propose closing, deleting, or updating any row that is NOT included in the in-scope stale-session inventory the user message lists; the per-request scope binding will refuse it, but you should refuse it first with a polite explanation. ` +
	`The actions you may propose are exactly: "close" (the operator must provide and review an exact RFC3339 boundary), "quarantine" (preserve a restorable snapshot and remove the stale row from active data), or "update" (apply a partial patch — supply update_fields with only the keys the user explicitly mentioned or the inventory makes obviously wrong). ` +
	`Never invent values for end_battery_pct, total_energy_added_wh, distance_m, duration_s, or any other numeric field — only quote the values the user provided in the request, and refuse to fabricate one when the user is silent on it. ` +
	`Refuse politely if asked to repair, modify, or delete any row outside the in-scope inventory, including rows for other vehicles. ` +
	`Be concise: one rationale sentence per proposed plan plus the typed draft is enough — the user reviews the structured proposal in the AI panel and clicks the canonical Save / Close / Quarantine button in the baseline edit form to apply it. ` +
	`Never claim the plan was applied, saved, closed, or quarantined; it is propose-only.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-wide
// tools.Registry — both `draft_data_repair_plan` and
// `validate_data_repair_plan` are registered by
// RegisterDataRepairSuggestionsTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct + validate a
// RepairPlan DTO but do NOT touch the database. The dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a write
// tool.
var allowedTools = []string{
	"draft_data_repair_plan",
	"validate_data_repair_plan",
}

// Strategy is the concrete strategy.Strategy implementation for the
// data-repair-suggestions surface. Construct via [New]; the zero
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
// the allowed tool names so a caller cannot mutate the package-
// level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds the
// conversation from StrategyInput.LastMessage / History, and the AI
// handler builds the synthesised "draft a repair plan for the
// following stale-session inventory" prompt before the call, so the
// strategy itself contributes no extra prefix messages. Returning
// nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyAlertBuilder wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyAlertBuilder keeps every PII class round-tripped to a tag
// before the message reaches the provider. IDs flow through tools,
// and proposed repairs require confirmation.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/data-repair-suggestions/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
