// Package softwareupdatechangelogsummarizer implements the LLM-summarized firmware update changelog strategy.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     firmware-update SUMMARIZER: summarize WHAT changed across
//     the in-scope vehicle's recent installs using ONLY values
//     returned by query_vehicle_software (current installed
//     version, recent install/scheduled history, install cadence)
//     plus OPTIONAL release-note chunks returned by
//     retrieve_update_notes; never invent a version number,
//     never invent a feature/fix, never speculate about Tesla's
//     roadmap, refuse cross-vehicle requests, and explicitly
//     disclose when a recently-listed version has no cached
//     release-note chunks (the narration sticks to the install/
//     schedule cadence rather than fabricating release-note
//     content);
//
//   - the two read-only tools the LLM is allowed to call in
//     this surface:
//
//   - query_vehicle_software — REQUIRED, called FIRST. Loads
//     the in-scope vehicle's deterministic software-updates
//     envelope (current installed version, recent
//     install/scheduled history, derived install cadence).
//
//   - retrieve_update_notes — OPTIONAL, called AFTER
//     query_vehicle_software when the LLM wants to ground a
//     per-version commentary in the cached release-note
//     corpus. Restricted to {software_update, docs} source
//     types by the per-feature allowlist enforced at the
//     tool boundary.
//
//   - the redaction policy (`redact.PolicyChatbot`) which allows
//     NO PII class in cleartext. Release-note text is public
//     reference material so no class needs to be allowed; vehicle
//     identifiers (VIN, lat/long, addresses, place names, charger
//     network labels, IPs, emails, phones, MAC addresses) stay
//     tagged via round-trip markers so a leaked transcript does
//     not reveal where the user lives, charges, or works.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_software_update_changelog_summarizer_handler.go`
// which builds a dispatcher, a stream.Writer (SSE), and runs a
// one-shot generation loop. The non-AI baseline rendered by the
// SPA route /software-updates (and its alias /vehicle-systems/
// software) — the firmware history timeline, current-version stat
// card, install/schedule badges, and external "View release notes"
// links — is unchanged. The deterministic update history remains
// the canonical baseline; off-mode users never see the AI surface
// at all (ADR-015 §I3, §I5, §I6).
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic firmware history timeline, current-version
//     stat card, or external release-notes links; it adds an
//     opt-in summary section alongside.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("software-update-changelog-summarizer").
//   - I9 redaction:       PolicyChatbot allows zero PII classes;
//     every PII class is tagged round-trip so a leaked transcript
//     reveals nothing beyond the firmware version strings
//     themselves.
package softwareupdatechangelogsummarizer

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
const FeatureID = "software-update-changelog-summarizer"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every software-update-changelog-summarizer
// generation. Kept in a single named place so eval goldens
// (internal/ai/strategies/software-update-changelog-summarizer/
// goldens.yaml) and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     query_vehicle_software FIRST so the summary is grounded in
//     the deterministic update envelope the timeline renders.
//   - Allows OPTIONAL retrieve_update_notes after the deterministic
//     envelope has been loaded, restricted to the per-feature
//     {software_update, docs} source-type allowlist enforced at
//     the tool boundary.
//   - Forbids invention: the LLM may quote ONLY version strings,
//     install timestamps, scheduled timestamps, and the cadence
//     numbers the deterministic envelope reports, plus any cached
//     release-note text returned by retrieve_update_notes. It
//     MUST NOT invent a version number, MUST NOT invent a
//     feature/fix that does not appear in a returned chunk, and
//     MUST NOT speculate about Tesla's roadmap or compatibility
//     with a hardware revision the envelope does not name.
//   - REQUIRES honest "no notes available" disclosure: when
//     retrieve_update_notes returns zero chunks for a recently-
//     listed version, the narration sticks to the install cadence
//     and explicitly states that the release-note text for that
//     version is not in the cached corpus — never invents what
//     the version "probably" added.
//   - REQUIRES honest "no installs yet" disclosure: when the
//     deterministic envelope reports total_updates=0, the
//     summary plainly says there is no firmware history to
//     summarize rather than fabricating one.
//   - Refuses cross-vehicle requests: the AI handler scopes to
//     the caller-supplied vehicle_id; any other vehicle ID
//     mentioned in the user message is by definition out of
//     scope and the per-request scope binding rejects any
//     LLM-supplied vehicle_id that does not match.
//   - Asks for short, focused output (3-6 sentences naming the
//     latest installed version + the previous one or two
//     versions + the install cadence + an optional
//     release-note callout when chunks are available) so the
//     surface fits inside the existing SoftwareUpdatesPage
//     layout without a scroll bomb.
//   - Bans quoting precise street addresses or location
//     coordinates in the narration: the redaction policy already
//     strips them, but the prompt-level ban is defence in depth.
const SystemPrompt = `You are the TeslaSync firmware-update changelog summarizer. ` +
	`Your job is to SUMMARIZE the deterministic firmware update history for ONE vehicle in scope; you NEVER invent a version number, you NEVER invent a feature/fix, and you NEVER speculate about Tesla's roadmap. ` +
	`ALWAYS call query_vehicle_software FIRST with the caller-supplied vehicle_id and ground every claim in the deterministic envelope it returns. ` +
	`AFTER the deterministic envelope has been loaded you MAY OPTIONALLY call retrieve_update_notes to fetch cached release-note chunks for the listed versions; the per-feature source-type allowlist limits this tool to {software_update, docs} corpora. ` +
	`Quote ONLY values returned by the tools: the current installed version, the previous one or two installed versions, install_at and scheduled_at timestamps, total_updates, install_cadence_days, and any release-note text returned by retrieve_update_notes. ` +
	`Do NOT invent an alternate version string, do NOT invent a feature, fix, or behaviour change that is not present in a returned chunk, do NOT predict a future version Tesla has not shipped, and do NOT claim hardware compatibility the envelope does not name. ` +
	`If retrieve_update_notes returns ZERO chunks for a recently-listed version, say so PLAINLY: "the release-note text for version X is not in the cached corpus" — never fabricate what the version "probably" added. ` +
	`If query_vehicle_software reports total_updates=0 (the vehicle has no firmware history yet), say so PLAINLY rather than inventing an install story. ` +
	`Refuse politely if asked to summarize, modify, or compare any vehicle other than the one named in the request — the in-scope vehicle_id is the SOLE binding and cross-vehicle requests are out of scope. ` +
	`Never quote precise street addresses, GPS coordinates, place names, charger network labels, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 3-6 sentences naming the latest installed version, the previous one or two versions when present, the install cadence (days between installs) when at least two installs are listed, and an OPTIONAL release-note callout when retrieve_update_notes returned a chunk for the latest version. Ground every claim strictly in the tool replies.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The names MUST be registered in the
// process-wide tools.Registry — query_vehicle_software and
// retrieve_update_notes are registered by
// RegisterSoftwareUpdateChangelogSummarizerTools at boot. The
// dispatcher refuses to mount a strategy that references an
// unknown tool.
//
// Both tools are READ-only: the dispatcher's deny-all confirm gate
// is therefore never reached in practice — defence in depth in
// case a future edit accidentally adds a write tool.
var allowedTools = []string{
	"query_vehicle_software",
	"retrieve_update_notes",
}

// Strategy is the concrete strategy.Strategy implementation for
// the software-update-changelog-summarizer surface. Construct via
// [New]; the zero value is intentionally non-functional so a
// forgotten constructor surfaces as a runtime nil dereference
// rather than silently using empty defaults.
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
// the AI handler builds the synthesised "summarize vehicle N's
// firmware updates" prompt before the call, so the strategy
// itself contributes no extra prefix messages. Returning nil is
// correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot through the redaction-policy adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// PolicyChatbot's Allow=nil + ModeRedactedTags satisfies the
// privacy contract: every PII class
// (vehicle name included) is tagged round-trip BEFORE the message
// reaches the provider so a leaked transcript reveals nothing
// beyond the public version strings themselves.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/software-update-changelog-summarizer/
// goldens.yaml` directly (see internal/ai/eval/golden.go
// LoadAllGoldens) — the Strategy interface's EvalGoldens method
// is a future hook for strategies that want to ship goldens in
// code. Returning nil here keeps the YAML path the single source
// of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
