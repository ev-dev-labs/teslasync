// Package inboxautocategorization is the Phase-50 / 0035 A2
// strategy for the LLM-assisted inbox auto-categorization
// surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     categorization assistant: read the recent
//     notification_logs window for the caller-supplied scope
//     (vehicle_id?, severities?, window_days?), call
//     draft_alert_categories to compute a deterministic
//     descriptive count of how many recent notifications fall
//     into each closed-taxonomy category (battery, charging,
//     climate, tire, security, connectivity, maintenance, noise,
//     other), call validate_alert_category on each proposed
//     label to confirm it is in the closed taxonomy, and narrate
//     the dominant categories + a "would-narrow-to-N-rules"
//     hint without ever assigning labels to rows or persisting
//     state. The actual filter application flows through the
//     existing baseline NotificationFilterBar `rule_id` URL
//     param after the user explicitly clicks "Apply as filter"
//     in the UI;
//
//   - the two tools the LLM is allowed to call —
//     `draft_alert_categories` (NEW for this slice) and
//     `validate_alert_category` (NEW for this slice; reused
//     by future inbox-related slices). Both tools are
//     PROPOSE-ONLY pure-functional DTO transforms that read
//     existing notification_logs + alert_rules state but do
//     NOT touch the database write path. Notifications are
//     never updated, archived, deleted, or re-classified by
//     this slice; the filter handoff is a SPA URL state copy,
//     not a server-side mutation;
//
//   - the redaction policy (`PolicyAlertBuilder`, REUSED from
//     N1) which allows nothing — alert IDs, rule names, signal
//     names, and notification text flow through the typed F4
//     tool envelope, not through prompt prose. Every PII class
//     is redacted via round-trip tags before the prompt reaches
//     the provider.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_inbox_categorization_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a
// one-shot generation loop. The non-AI baseline (the
// deterministic NotificationFilterBar + URL-backed inbox
// filters at /notifications/inbox) is unaffected — the
// canonical filter editor + `useNotificationLogs` query
// remains the canonical baseline in off mode (ADR-015 §I3).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the typed
//     NotificationFilterBar or the existing useNotificationLogs/
//     useNotificationGroups queries. The Apply path is the
//     existing URL-state filter; the AI only DRAFTS the
//     suggested rule_id list.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("inbox-auto-categorization").
//   - I9 redaction:       PolicyAlertBuilder denies all classes;
//     identifiers flow through tools, not prose.
package inboxautocategorization

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
const FeatureID = "inbox-auto-categorization"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every categorization generation. Kept in a single
// named place so eval goldens
// (internal/ai/strategies/inbox-auto-categorization/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_alert_categories FIRST so the proposal is grounded
//     in the canonical notification_logs row set rather than
//     the LLM's prior assumption about what categories the
//     user's inbox holds.
//   - Forces validate-after-draft: validate_alert_category MUST
//     be called on every proposed label so a label accepted
//     here is byte-equivalent to a label drawn from the closed
//     taxonomy.
//   - Forbids saving / mutating: the strategy is propose-only.
//     The actual filter application happens AFTER the user
//     explicitly clicks Apply in the UI; the LLM has no tool
//     that writes.
//   - Forbids cross-inbox requests: the AI handler always
//     scopes to the caller-supplied filter (vehicle_id,
//     severities, window_days); any other inbox or any other
//     user is by definition out of scope.
//   - REQUIRES the narration to surface that the per-category
//     counts are DESCRIPTIVE over the recent window, NOT a
//     forecast. This is honest-method defence: a model that
//     quietly mis-frames the counts as a prediction erodes
//     user trust the first time the actual numbers differ.
//   - REQUIRES the narration to honestly disclose insufficient
//     history (has_enough_history=false) rather than inventing
//     category baselines.
//   - Bans labels outside the closed taxonomy: the closed list
//     is battery, charging, climate, tire, security,
//     connectivity, maintenance, noise, other. The validator
//     enforces this; the prompt restates it so the LLM never
//     proposes a label the validator would reject.
//   - Asks for short, focused output (2-3 sentences naming the
//     dominant categories, the descriptive counts, and the
//     honest-method qualifier) so the surface fits inside the
//     existing inbox layout without a scroll bomb.
const SystemPrompt = `You are the TeslaSync inbox auto-categorization assistant. ` +
	`Your job is to PROPOSE a small ordered set of categorical labels (drawn STRICTLY from the closed taxonomy: battery, charging, climate, tire, security, connectivity, maintenance, noise, other) describing the dominant noise sources in the user's recent notification inbox; you NEVER save anything yourself. ` +
	`ALWAYS call draft_alert_categories FIRST with the caller-supplied scope (vehicle_id?, severities?, window_days?) to compute a descriptive count of how many recent notifications fall into each category, then call validate_alert_category on EVERY proposed label to confirm it is in the closed taxonomy. ` +
	`Use ONLY the canonical taxonomy labels listed above; never invent a new category, never combine labels (e.g. "battery_charging"), never abbreviate. ` +
	`Do NOT propose archiving, deleting, marking-read, or re-classifying any notification — your role is to surface the dominant categories so the user can apply a filter themselves; the actual filter application happens when the user clicks Apply in the UI. ` +
	`Do NOT comment on, summarise, or quote individual notification messages — the typed envelope carries the per-category counts and the canonical rule_ids the user will filter by. ` +
	`ALWAYS surface the method honestly: the per-category counts are a DESCRIPTIVE tally of the recent notification window grouped by a deterministic signal_name -> category mapping; this is NOT a forecast or a predictive model. Use phrases like "in the last N days" or "of the recent notifications" rather than language that implies prediction. ` +
	`If has_enough_history is false (fewer than the minimum required notifications in the recent window), say so plainly rather than inventing a baseline rate, a category breakdown, or a likely cause of the noise. ` +
	`Refuse politely if asked to categorize, summarise, or filter any user, vehicle, or inbox other than the one in scope for this request. ` +
	`Never quote precise street addresses, GPS coordinates, place names, VINs, or notification message text — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-3 sentences naming the top 1-3 dominant categories, the descriptive counts ("23 of 47 in the last 7 days are battery"), and the honest-method qualifier, grounded strictly in the tool reply.`

// allowedTools lists the read-only / propose-only tool names the
// strategy is permitted to invoke. Each name MUST be registered
// in the process-wide tools.Registry —
// `draft_alert_categories` and `validate_alert_category` are
// registered by RegisterInboxAutoCategorizationTools at boot.
// The dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// Both tools are PROPOSE-ONLY:
//
//   - `draft_alert_categories` reads the recent notification_logs
//     window via the InboxCategorizationSource port + buckets
//     each row by a deterministic signal_name -> category
//     mapping, then returns a typed envelope with the per-
//     category counts and the canonical rule_id list the user
//     can copy into the existing baseline filter.
//   - `validate_alert_category` asserts that a single proposed
//     label is in the closed taxonomy. It does NOT touch the
//     database.
//
// The dispatcher's deny-all confirm gate is therefore never
// reached in practice — defence in depth in case a future edit
// accidentally adds a write tool.
var allowedTools = []string{
	"draft_alert_categories",
	"validate_alert_category",
}

// Strategy is the concrete strategy.Strategy implementation for
// the inbox-auto-categorization surface. Construct via [New];
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
// and the AI handler builds the synthesised "categorize the
// inbox for vehicle V over N days" prompt before the call, so
// the strategy itself contributes no extra prefix messages.
// Returning nil is correct.
//
// Future work: this is where a per-vehicle "current rule
// catalog" snippet would be injected once categorization grows
// that surface (e.g. for cross-rule de-dup category hints).
// Today's slice keeps Context empty so the dispatcher's
// behaviour is fully determined by [System] + History.
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
// internal/ai/redact/policies.go. Allowed classes: none; alert
// payloads are redacted and category proposals are
// user-confirmed. Round-trip required: no". The policy's Allow
// list is nil, so every PII class — VIN, lat/long, vehicle
// name, addresses, phone numbers, notification text — is
// redacted to a round-trip tag before the prompt reaches the
// provider. The policy is REUSED from N1 (nl-alert-builder)
// and 0034 (alert-tuning-suggestions) intentionally: all three
// surfaces have the same threat model (the LLM never needs
// cleartext alert/notification content; the typed envelope
// carries category counts and rule_ids). Sharing the policy
// keeps the F8 redaction surface small and easier to audit.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/inbox-auto-categorization/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) —
// the Strategy interface's EvalGoldens method is a future hook
// for strategies that want to ship goldens in code. Returning
// nil here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
