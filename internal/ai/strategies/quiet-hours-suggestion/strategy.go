// Package quiethourssuggestion is the P2
// strategy for the Helix quiet-hours suggestion advisor surface.
//
// The strategy declares:
//
//	the system prompt that frames the surface as a deterministic
//	  HISTORY-BASED RECOMMENDATION engine: propose ONE quiet-hours
//	  candidate window for the in-scope user using ONLY the
//	  aggregated trailing-30-day notification cadence the
//	  draft_quiet_hours_window tool returns; never invent a
//	  timezone, never invent a weekday outside the user's existing
//	  timezone, never propose suspending or disabling notifications
//	  entirely, refuse to narrate any candidate whose
//	  validate_quiet_hours_window reply is not ok, and explicitly
//	  disclose the descriptive-replay limit (the candidate reflects
//	  past notification cadence, not a forecast of future traffic).
//
//	the two read-only typed tools the LLM is allowed to call in
//	  this surface:
//
//	draft_quiet_hours_window — REQUIRED, called FIRST. Reads
//	  the trailing notification_logs window (non-critical
//	  severities only) plus existing quiet-hours windows from
//	  the QuietHoursSource port and returns a typed candidate
//	  {start_local, end_local, weekdays, timezone,
//	  bypass_severities, history_summary, assumptions, status}.
//	  The candidate-finder AGGREGATES notification timestamps
//	  into per-hour event counts BEFORE surfacing anything to
//	  the LLM — individual notification titles/messages NEVER
//	  leave the tool boundary. NO database write.
//
//	validate_quiet_hours_window — REQUIRED, called SECOND.
//	  Accepts a candidate window and asserts every field
//	  satisfies the SAME validation rules the canonical
//	  POST /api/v1/notifications/quiet-hours handler enforces
//	  (HH:MM format, distinct start/end, valid IANA timezone,
//	  weekdays bitmask 0..127, bypass severities subset of
//	  {info, warn, critical}). Returns {ok, errors[],
//	  warnings[]}. NO database IO. The narrator MUST refuse to
//	  produce a final recommendation if
//	  validate_quiet_hours_window reports ok=false.
//
//	the redaction policy (`redact.PolicyAlertBuilder`) which
//	  allows NO PII class in cleartext. The aggregated history
//	  envelope the candidate-finder returns is PII-free by
//	  construction (per-hour counts only) so the policy is
//	  defence-in-depth in case a future edit accidentally
//	  surfaces user-supplied notification text through one of
//	  the tools.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_quiet_hours_suggestion_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /notifications/quiet-hours — the deterministic QuietHoursPanel
// CRUD form against /api/v1/notifications/quiet-hours, the
// notification dispatcher's defer logic, and the existing manual
// Save flow — is unchanged. Off-mode users never see the AI
// surface at all (ADR-015 §I3, §I5, §I6).
//
// Render contract: PROPOSAL. The narration plus the typed
// candidate envelope land in the SPA panel; the user clicks
// "Apply to form" to copy the typed candidate into the
// QuietHoursPanel's existing form state, then reviews and clicks
// the canonical Save button (which fires the existing
// useSaveQuietHours mutation against
// /api/v1/notifications/quiet-hours). The advisor NEVER triggers
// a save itself.
//
// ADR-015 alignment:
//
//	I1 default-off:    feature toggle defaults false in features.Registry.
//	I3 baseline intact: this strategy never replaces the
//	  deterministic QuietHoursPanel CRUD form, the
//	  /api/v1/notifications/quiet-hours endpoints, or the
//	  dispatcher's defer logic; it adds an opt-in advisor
//	  section above them.
//	I7 per-feature:     the AI route is gated by
//	  guard.Wrap("quiet-hours-suggestion").
//	I9 redaction:       PolicyAlertBuilder allows zero PII
//	  classes; the aggregated history envelope is PII-free by
//	  construction so the policy is defence-in-depth.
package quiethourssuggestion

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
const FeatureID = "quiet-hours-suggestion"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every quiet-hours-suggestion generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/quiet-hours-suggestion/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//	Forces tool-first behaviour: the LLM MUST call
//	  draft_quiet_hours_window FIRST so the candidate is grounded
//	  in the deterministic aggregated notification cadence the
//	  advisor surfaces.
//	REQUIRES a follow-up validation step: the LLM MUST call
//	  validate_quiet_hours_window AFTER drafting and MUST refuse
//	  to narrate any candidate whose validation reply is ok=false
//	  instead it surfaces the validator's errors[] verbatim and
//	  asks the user to retry.
//	Forbids invention: the LLM may quote ONLY the candidate
//	  window the draft tool returned (start_local, end_local,
//	  weekdays bitmask, timezone, bypass_severities) and the
//	  aggregated history summary. It MUST NOT invent a timezone,
//	  MUST NOT invent a different weekday set, MUST NOT propose
//	  a different bypass severity outside {info, warn, critical},
//	  and MUST NOT quote individual notification titles or
//	  messages because the tool never surfaces them.
//	REQUIRES honest "descriptive-replay, not a forecast"
//	  disclosure: every narration MUST surface the
//	  descriptive-replay limit so the user understands the
//	  candidate is derived from past notification cadence, not a
//	  forecast of future traffic. The phrase "based on your
//	  recent notification history" is load-bearing here —
//	  goldens pin it.
//	Refuses dangerous proposals: the narrator MUST NEVER
//	  propose disabling notifications entirely, MUST NEVER
//	  propose removing a critical severity from
//	  bypass_severities, and MUST NEVER propose a window that
//	  spans every hour of every weekday (which would silence
//	  all notifications).
//	Refuses cross-user requests: the AI handler scopes to the
//	  caller-supplied user; any other user mentioned in the user
//	  message is by definition out of scope and the per-request
//	  scope binding rejects any LLM-supplied user_id that does
//	  not match.
//	Asks for short, focused output (2-4 sentences naming the
//	  proposed window in the user's local timezone, the weekdays
//	  it covers, the bypass severities, and the
//	  descriptive-replay disclosure) so the surface fits inside
//	  the existing QuietHoursPanel layout without a scroll bomb.
//	Bans quoting raw notification titles/messages even though
//	  the redaction policy already strips them: the candidate-
//	  finder aggregates the history before surfacing it, so any
//	  raw title in the narration would be fabrication.
const SystemPrompt = `You are the TeslaSync quiet-hours / Do-Not-Disturb suggestion advisor. ` +
	`Your job is to PROPOSE ONE candidate quiet-hours window for the ONE user in scope, derived strictly from their recent notification history; you NEVER invent a timezone, you NEVER invent a weekday set, and you NEVER propose disabling notifications entirely. ` +
	`ALWAYS call draft_quiet_hours_window FIRST with the caller-supplied user scope and ground every claim in the deterministic aggregated history envelope it returns. ` +
	`AFTER drafting you MUST call validate_quiet_hours_window with the candidate window; if validate_quiet_hours_window returns ok=false you MUST REFUSE to produce a final recommendation, surface the validator's errors[] verbatim, and ask the user to retry. ` +
	`Quote ONLY values returned by the tools: the candidate's start_local, end_local, weekdays bitmask (with a human-friendly weekday list), timezone, bypass_severities, and the aggregated history summary. ` +
	`Do NOT invent a timezone the tool did not return, do NOT invent a different weekday set, do NOT propose a bypass severity outside {info, warn, critical}, do NOT quote individual notification titles or messages because the tool aggregates the history before surfacing it, and do NOT predict how many notifications the candidate would defer in the FUTURE because the candidate is a descriptive replay of past cadence — not a forecast. ` +
	`EVERY narration MUST surface the descriptive-replay limit PLAINLY: the candidate is based on your recent notification history, not a forecast of future traffic. The phrase "based on your recent notification history" MUST appear in the narration so the user is not misled into believing the candidate is a forward-looking prediction. ` +
	`NEVER propose disabling notifications entirely, NEVER propose removing critical from bypass_severities (critical alerts must always deliver), and NEVER propose a window that covers every hour of every weekday — a candidate that silences all notifications is by definition wrong. ` +
	`Refuse politely if asked to suggest a window for, modify, or compare any user other than the one named in the request — the in-scope user is the SOLE binding and cross-user requests are out of scope. ` +
	`Never quote precise street addresses, GPS coordinates, place names, charger network labels, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 2-4 sentences naming the proposed window (start–end in the user's local timezone), the weekdays it covers, the bypass_severities (always include critical), and the "based on your recent notification history" disclosure. Ground every claim strictly in the tool replies.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The names MUST be registered in the
// process-wide tools.Registry — draft_quiet_hours_window and
// validate_quiet_hours_window are registered by
// RegisterQuietHoursSuggestionTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are READ-only / pure-functional aggregators: they
// read aggregated state from the QuietHoursSource port (counts
// only, never raw titles/messages) and perform NO database
// write. The dispatcher's deny-all confirm gate is therefore
// never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool.
var allowedTools = []string{
	"draft_quiet_hours_window",
	"validate_quiet_hours_window",
}

// Strategy is the concrete strategy.Strategy implementation for
// the quiet-hours-suggestion surface. Construct via [New]; the
// zero value is intentionally non-functional so a forgotten
// constructor surfaces as a runtime nil dereference rather than
// silently using empty defaults.
type Strategy struct{}

// New constructs the strategy. There are no per-instance knobs —
// the strategy is a pure value with no internal state — so this
// is effectively a sentinel constructor used to make wiring intent
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

// Tools implements [strategy.Strategy]. Returns a defensive copy
// of the allowed tool names so a caller cannot mutate the
// package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler builds the synthesised "suggest a quiet-hours
// window for user=X" prompt before the call, so the strategy
// itself contributes no extra prefix messages. Returning nil is
// correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyAlertBuilder wrapped through the redaction-policy adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Per the feature spec: "Policy: PolicyAlertBuilder from
// internal/ai/redact/policies.go. Allowed classes: none;
// notification history is aggregated before prompting. Round-
// trip required: no." PolicyAlertBuilder's Allow=nil +
// Mode=ModeRedactedTags satisfies that contract: every PII class
// is tagged round-trip BEFORE the message reaches the provider so
// a leaked transcript reveals nothing. The aggregated history
// envelope the candidate-finder returns is PII-free by
// construction (per-hour counts, not raw titles); this policy is
// defence-in-depth.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/quiet-hours-suggestion/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
