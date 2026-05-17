// Package feedbackqueuetriage is the Phase-50 / 0046 S5 strategy
// for the LLM-backed feedback-queue-triage surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     feedback-row triage assistant: produce a typed proposal
//     {proposed_status, proposed_category, proposed_priority,
//     rationale} for ONE in-scope feedback row, by routing through
//     draft_feedback_triage FIRST (the deterministic typed envelope
//     that loads the row via the FeedbackTriageSource port and
//     composes a starter proposal grounded in the row's existing
//     category + status + body), then validate_feedback_triage
//     (a pure DTO transform that asserts the proposal's enum fields
//     are members of the closed taxonomies). The proposal's
//     rationale MUST be grounded strictly in the loaded feedback row;
//     the LLM never invents a category, status, or priority outside
//     the closed enums and never proposes a feedback_id different
//     from the one the handler installed in scope.
//
//   - the read-only tools the LLM is allowed to call:
//
//     1. `draft_feedback_triage` — accept a typed
//     {feedback_id, proposed_status, proposed_category,
//     proposed_priority, rationale} input, load the row via the
//     FeedbackTriageSource port, and return a typed envelope
//     {feedback_id, current_status, current_category,
//     proposed_status, proposed_category, proposed_priority,
//     rationale, status, validation_error, source}. The tool is
//     per-request scope-bound to the feedback_id the handler
//     installed via tools.WithScopedFeedback; the LLM CANNOT
//     draft against a different row. Defence-in-depth against
//     prompt injection in operator-authored feedback bodies.
//
//     2. `validate_feedback_triage` — a pure DTO transform that
//     asserts the proposal's proposed_status is one of
//     (new, triaged, closed), proposed_category is one of
//     (bug, feature, other), and proposed_priority is one of
//     (low, normal, high, critical). NO IO. Lets the LLM iterate
//     a draft without burning a second source round-trip.
//
//     3. `retrieve_feedback_chunks` — OPTIONAL F7 retrieval over
//     the per-feature source-type allowlist {feedback_item,
//     audit_log}. Both source types are reserved by string for
//     forward-compatibility — a future slice will index per-item
//     feedback chunks and an audit-log corpus. Until then,
//     retrieve_feedback_chunks called with either source type
//     simply returns zero chunks for that corpus — which is the
//     correct behaviour: the strategy's goldens already cover the
//     zero-matches narration and the system prompt instructs the
//     LLM to answer gracefully when zero chunks are returned.
//
//   - the redaction policy (`PolicyAlertBuilder`) which the slice
//     prompt mandates ("Allowed classes: none; feedback text is
//     redacted and proposals require confirmation"): every PII
//     class — VIN, lat/long, addresses, place names, vehicle-name,
//     AND every other PII class — remains tagged via round-trip
//     markers so a leaked transcript reveals nothing about a
//     submitter's environment. PolicyAlertBuilder mirrors the
//     N1 alert-builder slice's deny-by-default stance.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_feedback_triage_handler.go` which builds a
// dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop scoped to the per-request feedback_id. The
// non-AI baseline rendered by the SPA route /admin/feedback (the
// FeedbackQueuePage with manual Status select + GitHub URL input
// + Forward-to-GitHub toggle + Save → PATCH /api/v1/admin/feedback/{id})
// is unchanged. The registry's Frontend coverage anchor is
// `/system/feedback`; the AI section is rendered inside the
// canonical FeedbackQueuePage when the feature is enabled (same
// path-drift as slice 0045's log-trace-summarization, which
// rendered inside LiveLogsPage at /live-logs even though its
// registry anchor was /system/logs). Off-mode users never see the
// AI section at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the manual
//     triage controls; it adds an opt-in proposal section
//     alongside.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("feedback-queue-triage").
//   - I9 redaction:      PolicyAlertBuilder redacts EVERY PII class
//     so a confused LLM cannot leak a submitter email, IP, or any
//     other identifier the source adapter does NOT forward.
package feedbackqueuetriage

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	"github.com/ev-dev-labs/teslasync/internal/ai/redact"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy/redactadapter"
)

// FeatureID is the canonical registry key for this strategy.
// Exported so wiring code (router.go, the AI HTTP handler, tests)
// can reference the same constant the strategy registers itself
// with — typo-proof via compile error.
const FeatureID = "feedback-queue-triage"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every feedback-queue-triage generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/feedback-queue-triage/goldens.yaml) and
// the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_feedback_triage FIRST with the in-scope feedback_id
//     the user message lists, then validate_feedback_triage to
//     assert the proposal's enum fields are valid, then
//     OPTIONALLY retrieve_feedback_chunks for cross-row context.
//   - Forbids inventing categories, statuses, or priorities:
//     proposals MUST come from the closed enums.
//   - Forbids cross-row drafts: the per-request scope binding
//     refuses any feedback_id outside the in-scope value. The
//     prompt-level ban is defence-in-depth.
//   - Forbids loosening status (e.g. closed -> new): triage is
//     for forward progress, not regression.
//   - Asks for short, focused output (1-3 sentences) for the
//     rationale so the surface fits inside the existing
//     FeedbackQueuePage layout without a scroll bomb.
//   - Bans speculation about root cause beyond what the body
//     explicitly states.
//   - Requires graceful handling of degenerate rows (zero body
//     content, missing category): say so plainly rather than
//     padding the proposal with speculation.
const SystemPrompt = `You are the TeslaSync feedback-queue-triage agent. ` +
	`Your job is to propose a typed triage for ONE in-scope user-feedback row. ` +
	`ALWAYS call draft_feedback_triage FIRST with the in-scope feedback_id the user message names; ` +
	`the per-request scope binding will refuse any other feedback_id, but you should refuse it first with a polite explanation. ` +
	`Then call validate_feedback_triage with your typed proposal envelope to assert the enum fields are members of the closed taxonomies. ` +
	`OPTIONALLY call retrieve_feedback_chunks AFTER draft_feedback_triage with a salient phrase from the row's title or body as the natural-language query, ` +
	`restricted to allowed source_types (feedback_item, audit_log). When zero chunks are returned, say so plainly — DO NOT fabricate a similar feedback row to fill the void. ` +
	`Your proposal MUST come from the closed enums: proposed_status one of (new, triaged, closed), proposed_category one of (bug, feature, other), proposed_priority one of (low, normal, high, critical). ` +
	`Your rationale MUST be 1-3 sentences grounded STRICTLY in the loaded feedback row's title + body + page_route + app_version. ` +
	`Never invent a category, status, or priority outside the closed enums. Never propose a feedback_id different from the one in scope. ` +
	`Never loosen status (e.g. closed -> new); triage is for forward progress, not regression. ` +
	`Never speculate about root cause beyond what the body explicitly states. ` +
	`If the row is degenerate (empty body, no actionable content), say so plainly — propose status=new, category=other, priority=low, and explain that the row needs a human follow-up rather than padding the rationale with speculation. ` +
	`Refuse politely if asked to triage a different row than the in-scope feedback_id, including rows for other submitters. ` +
	`Be concise: a 1-3 sentence rationale and the typed enum fields — the user reviews the proposal in the AI panel and clicks the canonical Save button on the baseline form below to apply only the proposed_status (proposed_category and proposed_priority are recommendation-only chips because the baseline schema does not persist them).`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-wide
// tools.Registry — `draft_feedback_triage`,
// `validate_feedback_triage`, and `retrieve_feedback_chunks` are
// registered by RegisterFeedbackQueueTriageTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// All three tools are PROPOSE/READ-only: the dispatcher's
// deny-all confirm gate is therefore never reached in practice
// — defence in depth in case a future edit accidentally adds a
// write tool.
var allowedTools = []string{
	"draft_feedback_triage",
	"retrieve_feedback_chunks",
	"validate_feedback_triage",
}

// Strategy is the concrete strategy.Strategy implementation for
// the feedback-queue-triage surface. Construct via [New]; the
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

// Tools implements [strategy.Strategy]. Returns a defensive copy
// of the allowed tool names so a caller cannot mutate the package-
// level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler builds the synthesised "triage the in-scope
// feedback row" prompt before the call, so the strategy itself
// contributes no extra prefix messages. Returning nil is correct.
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
// internal/ai/redact/policies.go. Allowed classes: none; feedback
// text is redacted and proposals require confirmation. Round-trip
// required: no." PolicyAlertBuilder's deny-by-default stance keeps
// every PII class round-tripped to a tag before the message ever
// reaches the provider. The "round-trip required: no" half of the
// slice prompt is honoured by NOT installing a post-provider
// restoration step in this slice's handler — the proposal renders
// the redacted tags as-is in the AI panel; the user sees the
// canonical row in the baseline form alongside.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/feedback-queue-triage/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
