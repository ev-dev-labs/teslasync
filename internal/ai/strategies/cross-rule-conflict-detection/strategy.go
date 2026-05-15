// Package crossruleconflictdetection is the Phase-50 / 0036 A3
// strategy for the LLM-assisted cross-rule conflict-detection
// surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     conflict narrator: read the caller-supplied alert-rule set
//     (or the user's full visible rule list when the body's
//     rule_ids field is empty), call query_alert_rules FIRST to
//     fetch the typed rule envelopes, call detect_rule_conflicts
//     SECOND on the same set to compute a deterministic structural
//     overlap report, and narrate the conflicts in 2-3 sentences
//     WITHOUT proposing any rule edit, deletion, merge, or
//     auto-disable. The actual fix flows through the existing
//     baseline AlertStudio editor (the user clicks "Review rule"
//     in the AI panel, which selects the offending rule in the
//     canonical list, then edits it via the canonical typed
//     editor + clicks Save);
//
//   - the two tools the LLM is allowed to call —
//     `query_alert_rules` (NEW for this slice) and
//     `detect_rule_conflicts` (NEW for this slice). Both tools are
//     PROPOSE-ONLY pure-functional DTO transforms that read
//     existing alert_rules state but do NOT touch the database
//     write path. No rule is created, updated, or deleted by this
//     slice; the "Review rule" mechanism in the SPA copies the
//     offending rule_id into the existing baseline editor's
//     selection state (a SPA-local URL/query state copy, not a
//     server-side mutation);
//
//   - the redaction policy (`PolicyAlertBuilder`, REUSED from N1
//     /A1/A2) which allows nothing — alert IDs, signal names,
//     thresholds, and vehicle scopes flow through the typed F4
//     tool envelope, not through prompt prose. Every PII class is
//     redacted via round-trip tags before the prompt reaches the
//     provider.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_cross_rule_conflict_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline (the deterministic
// AlertStudio rule list + manual per-rule editing + the existing
// validateAlertRule single-rule validator that the canonical PUT
// /api/v1/alerts/rules/{id} handler already uses) is unaffected
// — that path remains the canonical baseline in off mode
// (ADR-015 §I3).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic single-rule validator, the AlertStudio rule
//     list, or any existing PUT/POST/DELETE handler. The "Review
//     rule" path is the existing list selection; the AI only
//     NARRATES the structural conflicts.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("cross-rule-conflict-detection").
//   - I8 propose-only:   no tool in the allowlist mutates state.
//   - I9 redaction:      PolicyAlertBuilder denies all classes;
//     identifiers flow through tools, not prose.
package crossruleconflictdetection

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, tests) can reference the
// same constant the strategy registers itself with — typo-proof
// via compile error.
const FeatureID = "cross-rule-conflict-detection"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every conflict-detection generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/cross-rule-conflict-detection/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_alert_rules FIRST so the analysis is grounded in the
//     canonical alert_rules envelope rather than the LLM's prior
//     assumption about what rules the user has.
//   - Forces detect-after-query: detect_rule_conflicts MUST be
//     called on the SAME rule set that query returned so the
//     conflict report is byte-equivalent to the deterministic
//     structural overlap computed by the pure-functional Go
//     detector.
//   - Forbids editing / mutating: the strategy is propose-only.
//     The actual fix flows through the existing baseline
//     AlertStudio editor AFTER the user clicks "Review rule" in
//     the UI; the LLM has no tool that writes.
//   - Forbids merging, deleting, auto-disabling, or auto-resolving
//     conflicts. The AI's role is to surface the structural
//     conflict and let the user decide what to do — never to
//     propose a destructive action.
//   - Forbids cross-user requests: the AI handler always scopes
//     to the rule_ids visible in the caller's session; any other
//     user's rules are by definition out of scope.
//   - REQUIRES the narration to surface that the report is a
//     STRUCTURAL overlap analysis of the current rule definitions,
//     NOT a prediction of which rules will fire together. This is
//     honest-method defence: a model that quietly mis-frames the
//     report as a firing-behaviour prediction erodes user trust
//     the first time the actual firings differ.
//   - REQUIRES the narration to honestly disclose insufficient
//     rules (has_enough_rules=false; fewer than 2 enabled rules
//     in scope) rather than inventing a conflict where none can
//     exist.
//   - Bans inventing conflict kinds outside the closed taxonomy:
//     the closed list is `redundant_duplicate` and
//     `overlapping_threshold`. The detector enforces this; the
//     prompt restates it so the LLM never narrates a conflict
//     that the typed envelope doesn't carry.
//   - Asks for short, focused output (2-3 sentences naming the
//     conflicting rule pairs, the conflict kind, and the
//     honest-method qualifier) so the surface fits inside the
//     existing AlertStudio layout without a scroll bomb.
const SystemPrompt = `You are the TeslaSync alert cross-rule conflict-detection assistant. ` +
	`Your job is to NARRATE structural overlaps between the user's existing alert rules so the user can decide what to do; you NEVER edit, merge, delete, disable, or otherwise mutate any rule yourself. ` +
	`ALWAYS call query_alert_rules FIRST with the caller-supplied scope (vehicle_id?, signal_name?, rule_ids?, enabled_only?) to fetch the typed rule envelope, then call detect_rule_conflicts with the SAME rule set so the conflict report is byte-equivalent to the deterministic structural detector. ` +
	`Use ONLY the canonical conflict kinds the typed envelope reports: redundant_duplicate (byte-identical predicate + same vehicle scope) and overlapping_threshold (same signal_name, overlapping vehicle scope, predicate intervals overlap). NEVER invent a new conflict kind, NEVER claim a runtime suppression effect (e.g. "rule B is shadowed and will never fire") — the AI engine cannot prove suppression from rule definitions alone. ` +
	`Do NOT propose merging two rules, deleting either rule, auto-disabling either rule, lowering severity, or any other rule mutation — your role is to surface the structural conflict and let the user decide via the existing baseline AlertStudio editor. The user clicks "Review rule" on each conflict to navigate to the offending rule and edit it themselves. ` +
	`ALWAYS surface the method honestly: the conflicts are a STRUCTURAL OVERLAP ANALYSIS of the current rule definitions; this is NOT a prediction of which rules will fire together at runtime. Use phrases like "their definitions overlap" or "they have an identical predicate" rather than language that implies firing-behaviour prediction. ` +
	`If has_enough_rules is false (fewer than 2 enabled rules in scope), say so plainly rather than inventing a conflict where none can exist. ` +
	`If the conflict envelope is empty (no structural conflicts found), say so plainly and DO NOT manufacture a conflict from severity differences, cooldown differences, or trigger-mode differences alone — those are surfaced as METADATA on each conflict, not as a standalone conflict kind. ` +
	`Refuse politely if asked to analyze, list, or compare any user, vehicle, or rule set other than the one in scope for this request. ` +
	`Never quote precise street addresses, GPS coordinates, place names, VINs, or notification message text — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences naming the conflicting rule pairs (by id), the conflict kind, and the honest-method qualifier ("structural overlap analysis of the current rule definitions"), grounded strictly in the tool reply.`

// allowedTools lists the read-only / propose-only tool names the
// strategy is permitted to invoke. Each name MUST be registered
// in the process-wide tools.Registry —
// `query_alert_rules` and `detect_rule_conflicts` are
// registered by RegisterCrossRuleConflictDetectionTools at boot.
// The dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// Both tools are PROPOSE-ONLY:
//
//   - `query_alert_rules` reads the alert_rules table via the
//     CrossRuleConflictSource port and returns a typed envelope
//     of rule definitions for the in-scope set.
//   - `detect_rule_conflicts` reads the SAME alert_rules via the
//     same port + runs the pure-functional structural conflict
//     detector to return a typed envelope of conflicts.
//
// The dispatcher's deny-all confirm gate is therefore never
// reached in practice — defence in depth in case a future edit
// accidentally adds a write tool.
//
// Order is load-bearing: the canonical tool sequence is query
// FIRST, detect SECOND, narrate THIRD. The system prompt
// restates this order; the goldens harness reads the YAML
// order, so a divergence between this list and the YAML is a
// wiring bug.
var allowedTools = []string{
	"query_alert_rules",
	"detect_rule_conflicts",
}

// Strategy is the concrete strategy.Strategy implementation for
// the cross-rule-conflict-detection surface. Construct via [New];
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

// FeatureID implements [strategy.Strategy]. Returns the
// canonical registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System implements [strategy.Strategy]. Returns the
// deterministic system prompt.
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
// the conversation from StrategyInput.LastMessage / History,
// and the AI handler builds the synthesised "detect conflicts
// across the user's alert rules" prompt before the call, so
// the strategy itself contributes no extra prefix messages.
// Returning nil is correct.
//
// Future work: this is where a per-vehicle "current automation
// catalog" snippet would be injected once conflict detection
// grows that surface (e.g. for cross-rule + cross-automation
// suggestion hints). Today's slice keeps Context empty so the
// dispatcher's behaviour is fully determined by [System] +
// History.
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
// internal/ai/redact/policies.go. Allowed classes: none; rule
// definitions are DTOs and no PII is needed. Round-trip
// required: no". The policy's Allow list is nil, so every PII
// class — VIN, lat/long, vehicle name, addresses, phone numbers,
// notification text — is redacted to a round-trip tag before the
// prompt reaches the provider. The policy is REUSED from N1
// (nl-alert-builder), 0034 (alert-tuning-suggestions), and 0035
// (inbox-auto-categorization) intentionally: all four surfaces
// have the same threat model (the LLM never needs cleartext
// alert/notification content; the typed envelope carries
// rule_ids + signal names through the F4 tool layer). Sharing
// the policy keeps the F8 redaction surface small and easier to
// audit.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/cross-rule-conflict-detection/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) —
// the Strategy interface's EvalGoldens method is a future hook
// for strategies that want to ship goldens in code. Returning
// nil here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
