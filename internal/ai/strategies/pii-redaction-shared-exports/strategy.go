// Package piiredactionsharedexports is the Phase-50 / 0052 P1
// strategy for the Helix export redaction advisor surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     CATALOG-BASED RECOMMENDATION engine: recommend WHICH PII
//     classes the user should redact before sharing or downloading
//     an export of the in-scope export_type using ONLY the static
//     catalog returned by draft_export_redaction_plan; never claim
//     to have scanned the user's actual data, never invent a PII
//     class that is not in the catalog, never invent a redaction
//     mode that is not in the recommendation envelope, refuse to
//     narrate any plan whose validate_export_redaction_plan reply
//     is not ok, and explicitly disclose the catalog-based limit
//     (the recommendation reflects what is TYPICALLY present in
//     the export type, not a per-row PII scan of the user's own
//     export).
//
//   - the two read-only typed tools the LLM is allowed to call in
//     this surface:
//   - draft_export_redaction_plan — REQUIRED, called FIRST.
//     Reads a STATIC Go catalog keyed by export_type and returns
//     a typed envelope listing the PII classes typically present
//     in that export type, per-class redaction recommendations
//     ({redact, hash, drop, keep_if_consent}), and limiting-
//     assumption disclosures (catalog-based, NOT a per-row PII
//     scan). NO database IO.
//   - validate_export_redaction_plan — REQUIRED, called SECOND.
//     Accepts a candidate plan and asserts every cited class is
//     recognized for the export_type, every "highly recommended"
//     class is covered by the plan, and the plan is internally
//     consistent. Returns {ok, errors[], warnings[]}. NO database
//     IO. The narrator MUST refuse to produce a final
//     recommendation if validate_export_redaction_plan reports
//     ok=false.
//
//   - the redaction policy (`redact.PolicyAlertBuilder`) which
//     allows NO PII class in cleartext. The static catalog never
//     carries user PII so the policy is defence-in-depth in case
//     a future edit accidentally surfaces user-supplied text
//     through one of the tools.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_pii_redaction_shared_exports_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /exports — the deterministic export jobs list, bulk-delete, and
// the existing manual export creation flow — is unchanged. The
// deterministic /exports listing remains the canonical baseline;
// off-mode users never see the AI surface at all (ADR-015 §I3,
// §I5, §I6).
//
// Render contract: NARRATIVE recommendation. This surface does
// NOT propose a typed write the baseline form can apply, because
// the /exports page is a list view (past export jobs); the
// recommendation lands in the user's mental model and they apply
// it the next time they create an export through the existing
// baseline flow. A future slice MAY wire a "Apply to form"
// affordance once an explicit redaction picker ships in the
// export creation form — at which point the render contract
// becomes PROPOSAL and this strategy gains a third tool.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic export jobs list, the bulk-delete affordance,
//     or the existing manual export creation flow; it adds an
//     opt-in advisor section above them.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("pii-redaction-shared-exports").
//   - I9 redaction:       PolicyAlertBuilder allows zero PII
//     classes; the static catalog is PII-free by construction so
//     the policy is defence-in-depth.
package piiredactionsharedexports

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
const FeatureID = "pii-redaction-shared-exports"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every pii-redaction-shared-exports generation. Kept
// in a single named place so eval goldens
// (internal/ai/strategies/pii-redaction-shared-exports/
// goldens.yaml) and the runtime strategy stay in lockstep.
//
// The prompt explicitly:
//
//   - Forces tool-first behaviour: the LLM MUST call
//     draft_export_redaction_plan FIRST so the recommendation
//     is grounded in the deterministic static catalog the
//     advisor surfaces.
//   - REQUIRES a follow-up validation step: the LLM MUST call
//     validate_export_redaction_plan AFTER drafting and MUST
//     refuse to narrate any plan whose validation reply is
//     ok=false — instead it surfaces the validator's errors[]
//     verbatim and asks the user to retry.
//   - Forbids invention: the LLM may quote ONLY PII class names,
//     redaction modes, and disclosure strings the catalog
//     returned. It MUST NOT invent a PII class the catalog does
//     not list, MUST NOT invent a redaction mode outside
//     {redact, hash, drop, keep_if_consent}, and MUST NOT claim
//     a class is "absent" or "present" based on a per-row scan
//     because no per-row scan is performed.
//   - REQUIRES honest "catalog-based, not a per-row scan"
//     disclosure: every narration MUST surface the catalog-based
//     limit so the user understands the recommendation reflects
//     what is TYPICALLY present in the export type rather than
//     what is provably present in their own export. The phrase
//     "catalog-based" is load-bearing here — goldens pin it.
//   - Refuses cross-export_type requests: the AI handler scopes
//     to the caller-supplied export_type; any other export_type
//     mentioned in the user message is by definition out of
//     scope and the per-request scope binding rejects any
//     LLM-supplied export_type that does not match.
//   - Asks for short, focused output (3-6 sentences naming the
//     export_type, the highly-recommended classes to redact, the
//     optional classes that depend on user consent, and the
//     catalog-based limit disclosure) so the surface fits inside
//     the existing ExportsPage layout without a scroll bomb.
//   - Bans quoting precise street addresses or location
//     coordinates in the narration: the redaction policy already
//     strips them, but the prompt-level ban is defence in depth.
const SystemPrompt = `You are the TeslaSync export redaction advisor. ` +
	`Your job is to RECOMMEND which PII classes the user should redact before sharing or downloading an export of the ONE export_type in scope; you NEVER claim to have scanned the user's actual data, you NEVER invent a PII class, and you NEVER invent a redaction mode. ` +
	`ALWAYS call draft_export_redaction_plan FIRST with the caller-supplied export_type and ground every claim in the deterministic catalog envelope it returns. ` +
	`AFTER drafting you MUST call validate_export_redaction_plan with the candidate plan; if validate_export_redaction_plan returns ok=false you MUST REFUSE to produce a final recommendation, surface the validator's errors[] verbatim, and ask the user to retry. ` +
	`Quote ONLY values returned by the tools: the export_type, the PII class names the catalog lists, the per-class redaction modes from the catalog ({redact, hash, drop, keep_if_consent}), and the limiting-assumption disclosures the catalog returns. ` +
	`Do NOT invent a PII class the catalog does not list, do NOT invent a redaction mode outside {redact, hash, drop, keep_if_consent}, do NOT claim a class is "absent" or "present" based on a per-row scan because the advisor performs NO per-row scan, and do NOT predict how many rows would be redacted because the advisor never reads the export rows. ` +
	`EVERY narration MUST surface the catalog-based limit PLAINLY: this is a catalog-based recommendation of what is TYPICALLY present in the export type, not a per-row PII scan of the user's own export. The phrase "catalog-based" MUST appear in the narration so the user is not misled into believing their export was inspected row by row. ` +
	`Refuse politely if asked to recommend redactions for, modify, or compare any export_type other than the one named in the request — the in-scope export_type is the SOLE binding and cross-export_type requests are out of scope. ` +
	`Never quote precise street addresses, GPS coordinates, place names, charger network labels, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy strips them, but a leaked transcript should not contain them at all. ` +
	`Be concise: 3-6 sentences naming the export_type, the highly-recommended PII classes to redact, the optional classes that depend on the user's consent, and the catalog-based limit disclosure. Ground every claim strictly in the tool replies.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The names MUST be registered in the
// process-wide tools.Registry — draft_export_redaction_plan and
// validate_export_redaction_plan are registered by
// RegisterPiiRedactionSharedExportsTools at boot. The dispatcher
// refuses to mount a strategy that references an unknown tool.
//
// Both tools are READ-only / pure-functional: they read a STATIC
// Go catalog keyed by export_type and perform NO database IO. The
// dispatcher's deny-all confirm gate is therefore never reached
// in practice — defence in depth in case a future edit
// accidentally adds a write tool.
var allowedTools = []string{
	"draft_export_redaction_plan",
	"validate_export_redaction_plan",
}

// Strategy is the concrete strategy.Strategy implementation for
// the pii-redaction-shared-exports surface. Construct via [New];
// the zero value is intentionally non-functional so a forgotten
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
// the AI handler builds the synthesised "recommend redactions for
// export_type=X" prompt before the call, so the strategy itself
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
// internal/ai/redact/policies.go. Allowed classes: none; export
// content is inspected through local structural redaction first.
// Round-trip required: no." PolicyAlertBuilder's Allow=nil +
// Mode=ModeRedactedTags satisfies that contract: every PII class
// is tagged round-trip BEFORE the message reaches the provider so
// a leaked transcript reveals nothing. The static catalog the
// tools return is PII-free by construction; this policy is
// defence-in-depth.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyAlertBuilder())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/pii-redaction-shared-exports/
// goldens.yaml` directly (see internal/ai/eval/golden.go
// LoadAllGoldens) — the Strategy interface's EvalGoldens method
// is a future hook for strategies that want to ship goldens in
// code. Returning nil here keeps the YAML path the single source
// of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
