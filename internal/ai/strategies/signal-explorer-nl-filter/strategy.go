// Package signalexplorernlfilter defines the LLM-backed signal-explorer-nl-filter strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a propose-only
//     SignalFilter drafter: produce a typed SignalFilter DTO via
//     tools constrained to the per-vehicle signal catalog
//     the handler installs server-side; never edit URL state; never
//     fetch history rows; refuse cross-vehicle requests; refuse to
//     propose a signal name that is not in the in-scope catalog;
//
//   - the two propose-only tools the LLM is allowed to call:
//
//     1. `draft_signal_filter` — accept a typed
//     {vehicle_id, signals, range_preset, per_page} input and
//     return a normalised + validated SignalFilter draft envelope.
//     The tool is per-request scope-bound to the per-vehicle
//     signal catalog the handler installed via
//     nl.WithScopedSignalCatalog; the LLM CANNOT propose a
//     signal name that is not in the catalog. Defence-in-depth
//     against prompt injection in operator-authored prompts.
//
//     2. `validate_signal_filter` — accept the same typed shape
//     and re-run the canonical validator without rebuilding the
//     draft envelope. Used by the LLM to confirm a draft is
//     acceptable before narrating it to the user.
//
//   - the redaction policy (`PolicyChatbot`) which keeps vehicle identifiers
//     flow through tools and query DTOs"): VIN, lat/long,
//     addresses, place names, vehicle-name, AND every other PII
//     class remain tagged via round-trip markers so a leaked
//     transcript reveals nothing about the operator's environment,
//     vehicle identifiers, or any value an operator pasted into
//     the request prose.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_signal_explorer_nl_filter_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop scoped to the per-vehicle signal catalog visible
// at request time. The non-AI baseline rendered by the SPA route
// /signals/explorer (the deterministic SignalSelector + RangePicker
// + Per-Page select + Explore button + Live toggle) is unchanged.
// Off-mode users never see the AI section at all (ADR-015 §I3, §I5,
// §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic SignalSelector + RangePicker + Explore +
//     Live controls or the canonical
//     GET /api/v1/signals/{vehicleID}/{signalName}/history read
//     path. The AI proposes a typed SignalFilter; the user
//     explicitly clicks "Apply" to copy the draft into the
//     baseline form, then clicks the canonical Explore button to
//     fetch.
//   - I7 per-feature:    the AI route is gated by
//     guard.Wrap("signal-explorer-nl-filter").
//   - I9 redaction:      PolicyChatbot redacts EVERY PII class so
//     a confused LLM cannot leak a hostname, IP, VIN, or any
//     pasted value to the model.
package signalexplorernlfilter

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
const FeatureID = "signal-explorer-nl-filter"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every signal-explorer-nl-filter generation. Kept in a
// single named place so eval goldens
// (internal/ai/strategies/signal-explorer-nl-filter/goldens.yaml)
// and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_signal_filter with the typed fields it can infer from
//     the user's request and the per-vehicle signal catalog the
//     handler synthesises into the user message. Then it MUST call
//     validate_signal_filter on the proposed draft to confirm it
//     satisfies the SignalFilter contract before narrating the
//     plan to the user.
//   - Forbids editing filter state directly: this is a propose-
//     only surface. The LLM has no tool that mutates the SPA URL
//     state; the actual filter application flows through the
//     existing typed SignalSelector + RangePicker after the user
//     explicitly clicks "Apply" in the AI panel. The narration
//     MUST surface this "review and click Apply yourself"
//     expectation so the user is never surprised.
//   - REQUIRES every proposed signal name to be in the per-vehicle
//     catalog passed in the user message. Inventing a signal name
//     that is not in the catalog is forbidden — the tool enforces
//     the same invariant via the per-request scope binding, but
//     the prompt-level ban is defence-in-depth.
//   - Forbids cross-vehicle requests: the AI handler always works
//     with the per-vehicle catalog scoped to the request's
//     vehicle_id; any other vehicle ID in the user message is by
//     definition out of scope.
//   - Asks for short, focused output (one rationale sentence per
//     proposed filter plus the typed draft) so the surface fits
//     inside the existing SignalExplorerPage layout without a
//     scroll bomb.
//   - Bans inventing values for signals the catalog does not
//     contain: "show me regen efficiency" when no `regen_efficiency`
//     signal exists must produce a polite refusal, not a guess.
const SystemPrompt = `You are the TeslaSync signal-explorer-nl-filter agent. ` +
	`Your job is to PROPOSE a typed SignalFilter draft that the user can apply to the SignalExplorerPage at /signals/explorer; you NEVER edit filter state yourself. ` +
	`ALWAYS call draft_signal_filter FIRST with the typed fields you can infer from the user's request and the in-scope per-vehicle signal catalog the user message lists, then call validate_signal_filter on the proposed draft to confirm it satisfies the SignalFilter contract. ` +
	`Do NOT propose any signal name that is NOT included in the in-scope per-vehicle catalog the user message lists; the per-request scope binding will refuse it, but you should refuse it first with a polite explanation. ` +
	`The range_preset values you may propose are exactly: "today", "yesterday", "7d", "30d", "90d", "all"; choose the smallest preset that satisfies the user's request when ambiguous. ` +
	`The per_page values you may propose are exactly: 25, 50, 100, 500; default to 25 when the user did not specify. ` +
	`The signals array MUST contain between 1 and 5 entries — never more, never zero — and entries MUST be unique. ` +
	`Refuse politely if asked to propose a filter for a signal that is not in the in-scope catalog, including signals for other vehicles. ` +
	`Be concise: one rationale sentence per proposed filter plus the typed draft is enough — the user reviews the structured proposal in the AI panel and clicks the canonical Apply button to copy the draft into the baseline filter form. ` +
	`Never claim the filter was applied, run, or fetched; it is propose-only.`

// allowedTools lists the propose-only tool names the strategy is
// permitted to invoke. Names MUST be registered in the process-wide
// tools.Registry — both `draft_signal_filter` and
// `validate_signal_filter` are registered by
// RegisterSignalExplorerNLFilterTools at boot. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// Both tools are PROPOSE-ONLY: they construct + validate a
// SignalFilter DTO but do NOT touch URL state, the database, or
// signal_log. The dispatcher's deny-all confirm gate is therefore
// never reached in practice — defence in depth in case a future
// edit accidentally adds a write tool.
var allowedTools = []string{
	"draft_signal_filter",
	"validate_signal_filter",
}

// Strategy is the concrete strategy.Strategy implementation for the
// signal-explorer-nl-filter surface. Construct via [New]; the zero
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
// handler builds the synthesised "draft a signal filter using the
// following per-vehicle catalog" prompt before the call, so the
// strategy itself contributes no extra prefix messages. Returning
// nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the strategy redaction adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Policy contract: "Policy: PolicyChatbot from
// internal/ai/redact/policies.go. Allowed classes: none; vehicle
// identifiers flow through tools and query DTOs. Round-trip
// required: no." PolicyChatbot's deny-by-default stance keeps
// every PII class round-tripped to a tag before the message ever
// reaches the provider.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/signal-explorer-nl-filter/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil here
// keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
