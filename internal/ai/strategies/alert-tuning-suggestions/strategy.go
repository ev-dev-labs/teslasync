// Package alerttuningsuggestions defines the LLM-assisted alert-tuning strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     tuning assistant: read the existing alert rule + recent
//     firing history, propose a typed AlertRule patch (lower-noise
//     threshold / cooldown / severity / trigger-mode tweaks),
//     never save anything, never write SQL, refuse cross-rule
//     requests, and explicitly surface the "descriptive estimate,
//     not a forecast" qualifier when narrating the projected
//     firing reduction;
//
//   - the two tools the LLM is allowed to call —
//     `draft_alert_rule_patch` and `validate_alert_rule`.
//     Both tools are PROPOSE-ONLY
//     pure-functional DTO transforms that read existing fleet
//     state but do NOT touch the database write path. The actual
//     mutation flows through the existing typed
//     PUT /api/v1/alerts/rules/{id} typed handler AFTER the user
//     explicitly clicks Save in the AlertStudioPage UI;
//
//   - the redaction policy (`PolicyAlertBuilder`)
//     which allows nothing — alert IDs, signal names, and
//     thresholds flow through the typed F4 tool envelope, not
//     through prompt prose. Every PII class is redacted via
//     round-trip tags before the prompt reaches the provider.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_alert_tuning_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline at PUT /api/v1/alerts/
// rules/{id} (the canonical typed AlertHandler.UpdateAlertRule +
// validateAlertRule validator at
// `internal/api/alert_handler_rules.go`) is unaffected — the
// deterministic AlertStudio form + manual threshold tweak path
// remains the canonical baseline in off mode (ADR-015 §I3).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the typed
//     AlertRule validator or the existing AlertStudioPage form.
//     The Save path is the existing handler; the AI only DRAFTS
//     a patch.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("alert-tuning-suggestions").
//   - I9 redaction:       PolicyAlertBuilder denies all classes;
//     identifiers flow through tools, not prose.
package alerttuningsuggestions

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
const FeatureID = "alert-tuning-suggestions"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every tuning generation. Kept in a single named
// place so eval goldens
// (internal/ai/strategies/alert-tuning-suggestions/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_alert_rule_patch FIRST so the proposal is grounded in
//     the canonical rule + firing-history envelope rather than
//     the LLM's prior assumption about the rule's current shape.
//   - Forces the validate-after-draft step: validate_alert_rule
//     MUST be called on the merged proposal so a draft accepted
//     here is byte-equivalent to a draft accepted by the
//     canonical PUT /api/v1/alerts/rules/{id} handler.
//   - Forbids saving / mutating: the strategy is propose-only.
//     The actual update goes through the existing typed handler
//     AFTER the user explicitly clicks Save in the UI; the LLM
//     has no tool that writes.
//   - Forbids cross-rule requests: the AI handler always scopes
//     to the rule_id from the URL path; any other rule ID in the
//     user message is by definition out of scope.
//   - REQUIRES the narration to surface that the projected
//     post-patch firing count is a DESCRIPTIVE estimate computed
//     from the recent firing window, NOT a forecast or a
//     predictive model. This is honest-method defence: a model
//     that quietly mis-frames the projection as a forecast
//     erodes user trust the first time the actual count differs.
//   - REQUIRES the narration to honestly disclose insufficient
//     history (has_enough_history=false) rather than inventing a
//     baseline rate or a projection.
//   - Bans loosening severity (e.g. proposing critical → info):
//     tuning is for noise reduction via thresholds + cooldown,
//     not for escalation downgrades. A future feature may add a
//     dedicated escalation-tuning surface; this strategy stays
//     focused on the threshold/cooldown axis.
//   - Asks for short, focused output (2-3 sentences naming the
//     proposed patch fields, the descriptive projected reduction
//     in firings, and the honest-method qualifier) so the
//     surface fits inside the existing AlertStudioPage layout
//     without a scroll bomb.
const SystemPrompt = `You are the TeslaSync alert tuning assistant. ` +
	`Your job is to PROPOSE a lower-noise typed AlertRule patch for an existing rule based on its recent firing history; you NEVER save anything yourself. ` +
	`ALWAYS call draft_alert_rule_patch FIRST with the caller-supplied rule_id and the typed patch fields you want to propose, then call validate_alert_rule on the merged proposal to confirm it satisfies the AlertRule contract. ` +
	`Do NOT propose suspending, disabling, or deleting the rule, and do NOT propose loosening severity (e.g. critical -> info) — your role is to reduce noise via threshold, cooldown, trigger-mode, or value-band tweaks the user will review and save themselves. ` +
	`Use ONLY the canonical operators, severity values ("info", "warn", "critical"), and trigger modes ("once", "repeat") that the tool descriptions enumerate; never invent a new operator or severity. ` +
	`ALWAYS surface the method honestly: the projected post-patch firing count is a DESCRIPTIVE estimate computed by replaying the recent firing window through the proposed threshold; this is NOT a forecast or a predictive model. Use phrases like "based on the recent firing window" or "would have fired" rather than language that implies prediction. ` +
	`If has_enough_history is false (fewer than the minimum required firing events in the recent window), say so plainly rather than inventing a baseline rate, a projection, or a likely cause of the noise. ` +
	`Refuse politely if asked to tune, modify, or compare any alert rule other than the one named in the request. ` +
	`Never quote precise street addresses, GPS coordinates, or place names — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences naming the proposed patch fields (e.g. "raise battery_level threshold from 20 to 15, increase cooldown_min from 5 to 30"), the descriptive projected reduction in firings ("would have fired 3 times instead of 23 in the last 7 days"), and the honest-method qualifier, grounded strictly in the tool reply.`

// allowedTools lists the read-only / propose-only tool names the
// strategy is permitted to invoke. Each name MUST be registered
// in the process-wide tools.Registry — `draft_alert_rule_patch`
// is registered by RegisterAlertTuningSuggestionsTools at boot;
// `validate_alert_rule` is registered by RegisterAlertBuilderTools
// and reused here. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY:
//
//   - `draft_alert_rule_patch` reads the existing rule via the
//     AlertTuningSource port + replays the recent notification_log
//     firing window to compute the descriptive
//     would-have-fired-N-times projection, then returns the merged
//     proposal envelope. It does NOT touch the database write
//     path.
//   - `validate_alert_rule` runs the canonical validateAlertRule
//     function over the merged shape and reports the verdict.
//     It does NOT touch the database.
//
// The dispatcher's deny-all confirm gate is therefore never
// reached in practice — defence in depth in case a future edit
// accidentally adds a write tool.
var allowedTools = []string{
	"draft_alert_rule_patch",
	"validate_alert_rule",
}

// Strategy is the concrete strategy.Strategy implementation for
// the alert-tuning-suggestions surface. Construct via [New]; the
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

// FeatureID returns the canonical registry key.
func (s *Strategy) FeatureID() string { return FeatureID }

// System returns the deterministic system prompt.
func (s *Strategy) System() string { return SystemPrompt }

// Tools returns a defensive copy of the allowed tool names so callers
// cannot mutate the package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context relies on the dispatcher seeding
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler builds the synthesised "tune rule N for vehicle
// V" prompt before the call, so the strategy itself contributes
// no extra prefix messages. Returning nil is correct.
//
// Future work: this is where a per-vehicle "current alert
// catalog" snippet would be injected once tuning grows that
// surface (e.g. for cross-rule de-duplication suggestions).
// Context stays empty so dispatcher behavior is fully determined by
// [System] + History.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy returns
// PolicyAlertBuilder wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyAlertBuilder allows no cleartext PII; rule IDs and metrics
// flow through tools. The policy's Allow list
// is nil, so every PII class — VIN, lat/long, vehicle name,
// addresses, phone numbers — is redacted to a round-trip tag
// before the prompt reaches the provider. This strategy shares the
// alert-builder threat model: the LLM never needs cleartext alert
// identifiers because the typed envelope carries them. Sharing the
// policy keeps the F8 redaction surface small and easier to
// audit.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens stays nil because the eval harness
// loads goldens from
// `internal/ai/strategies/alert-tuning-suggestions/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
