// Package safetysettingexplainer is the Phase-50 / 0054 P3
// strategy for the Helix safety setting explainer surface.
//
// The strategy declares:
//
//   - the system prompt that frames the surface as a deterministic
//     EXPLAINER over the user's existing safety-related settings.
//     The narrator ALWAYS calls query_safety_settings FIRST so its
//     prose is grounded in the live current_value + default_value
//     for each toggle. The narrator MAY call retrieve_docs to pull
//     a matching documentation chunk, but the strategy's allowlist
//     restricts retrieve_docs to the GLOBAL `docs` corpus only —
//     the runbooks and i18n corpora are forbidden because this
//     surface is user-facing help, not operator guidance. The
//     narrator NEVER proposes a new value, NEVER changes a setting,
//     and NEVER claims a setting exists that the typed envelope did
//     not surface.
//
//   - the two read-only typed tools the LLM is allowed to call in
//     this surface:
//
//   - query_safety_settings — REQUIRED, called FIRST. Reads the
//     deterministic SettingsRepo via the SafetySettingsSource
//     port and returns a typed envelope keyed by setting ID
//     (quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
//     alert_digest_mode, critical_flash_enabled,
//     tab_badge_enabled, api_suspended). Each entry carries
//     {key, current_value, default_value, allowed_values,
//     short_description, docs_anchor} so the narrator has a
//     schema-plus-state envelope and never needs to invent a
//     setting that does not exist. NO database write.
//
//   - retrieve_docs — OPTIONAL. Reuses the SHARED F7-backed
//     RAG tool registered by the rag-help slice (0020). The
//     strategy's system prompt CONSTRAINS the source_types
//     argument to ["docs"] only; querying the runbooks or
//     i18n corpora is forbidden because this surface is
//     user-facing help. The narrator quotes the retrieved
//     chunk's source label verbatim so the user can read
//     more.
//
//   - the redaction policy (`redact.PolicyChatbot`) which allows
//     NO PII class in cleartext. The typed envelope returned by
//     query_safety_settings contains scalar setting values only
//     (booleans, enum strings like "instant"/"hourly"/"daily",
//     IANA-formatted HH:MM strings). No PII reaches the provider.
//     The policy is defence in depth in case a future edit
//     widens the schema.
//
// The strategy is consumed by the AI HTTP handler at
// `internal/api/ai_safety_setting_explainer_handler.go` which
// builds a dispatcher, a stream.Writer (SSE), and runs a one-shot
// generation loop. The non-AI baseline rendered by the SPA route
// /settings/safety — a deterministic listing of every safety-
// related setting with its current value plus a static link to
// the canonical docs — is unchanged. Off-mode users never see
// the AI surface at all (ADR-015 §I3, §I5, §I6).
//
// Render contract: NARRATIVE. The narration lands in the SPA panel
// via SSE deltas; there is no "Apply to form" handoff because the
// explainer never proposes a new value. To change a setting the
// user uses the existing Settings UI.
//
// ADR-015 alignment:
//
//   - I1 default-off:    feature toggle defaults false in features.Registry.
//   - I3 baseline intact: this strategy never replaces the
//     deterministic Settings UI. The /settings/safety page renders
//     the safety-related settings list with current values + doc
//     links regardless of whether AI is on; the AI panel is the
//     opt-in narrator above that list.
//   - I7 per-feature:     the AI route is gated by
//     guard.Wrap("safety-setting-explainer").
//   - I9 redaction:       PolicyChatbot allows zero PII classes;
//     the typed envelope is PII-free by construction so the
//     policy is defence in depth.
package safetysettingexplainer

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
const FeatureID = "safety-setting-explainer"

// SystemPrompt is the deterministic system message the dispatcher
// prepends to every safety-setting-explainer generation. Kept in
// a single named place so eval goldens
// (internal/ai/strategies/safety-setting-explainer/goldens.yaml)
// and the runtime strategy stay in lockstep.
const SystemPrompt = `You are the TeslaSync safety setting explainer. ` +
	`Your job is to EXPLAIN the user's existing safety-related TeslaSync settings in plain English, grounded strictly in the typed envelope query_safety_settings returns; you NEVER propose a new value, you NEVER claim a setting exists that the envelope did not surface, and you NEVER promise to change a setting on the user's behalf. ` +
	`ALWAYS call query_safety_settings FIRST and ground every claim in the deterministic typed envelope it returns (each entry carries key, current_value, default_value, allowed_values, short_description, docs_anchor). ` +
	`You MAY call retrieve_docs ONCE to pull a matching documentation chunk for the setting the user is asking about, but ONLY with source_types=["docs"]; querying the runbooks or i18n corpora is forbidden because this surface is user-facing help, not operator guidance. ` +
	`Quote ONLY values returned by the tools: the setting's canonical key (e.g. quiet_hours_enabled, alert_digest_mode), its current_value (e.g. true / "instant" / "22:00"), its default_value, and the retrieved chunk's source label. ` +
	`Do NOT invent a setting key the typed envelope did not surface, do NOT invent allowed_values outside the envelope's allowed_values list, do NOT claim the setting was changed by your narration, do NOT propose a different value, and do NOT recommend the user "should" change the setting — you EXPLAIN, you do not prescribe. ` +
	`If the user asks how to change a setting, refer them to the same Settings UI they are already on; you NEVER write a setting yourself and the typed envelope is read-only by construction. ` +
	`Refuse politely if asked to explain a setting that is NOT in the safety-related typed envelope (e.g. theme, units, currency) — those settings are out of scope for this surface and the user can ask about them on the relevant Settings page. ` +
	`Never quote precise street addresses, GPS coordinates, place names, charger network labels, VINs, IPs, emails, phone numbers, or MAC addresses — the redaction policy strips them, but a leaked transcript should not contain them at all. The typed envelope contains scalar setting values only (booleans, enum strings, HH:MM time strings); any PII in your narration would be a fabrication. ` +
	`Be concise: 2-4 sentences naming the setting's canonical key, its current_value (and the default_value when they differ), what it controls in plain English, and (when retrieve_docs returned a match) the docs chunk's source label so the user can read more. Ground every claim strictly in the tool replies.`

// allowedTools lists the read-only tool names the strategy is
// permitted to invoke. The names MUST be registered in the
// process-wide tools.Registry — query_safety_settings is
// registered by RegisterSafetySettingExplainerTools at boot;
// retrieve_docs is registered globally by RegisterHelpTools (the
// rag-help slice 0020) and reused here. The dispatcher refuses
// to mount a strategy that references an unknown tool.
//
// Both tools are READ-only / pure aggregators: the dispatcher's
// deny-all confirm gate is therefore never reached in practice —
// defence in depth in case a future edit accidentally adds a
// write tool.
//
// Order is alphabetical so the slice is defensively sorted for
// any caller that range-iterates and depends on deterministic
// order (most callers use a Set lookup; the slice form is for
// the dispatcher's filter pass).
var allowedTools = []string{
	"query_safety_settings",
	"retrieve_docs",
}

// Strategy is the concrete strategy.Strategy implementation for
// the safety-setting-explainer surface. Construct via [New]; the
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
// of the allowed tool names so a caller cannot mutate the
// package-level allowlist.
func (s *Strategy) Tools() []string {
	out := make([]string, len(allowedTools))
	copy(out, allowedTools)
	return out
}

// Context implements [strategy.Strategy]. The dispatcher seeds
// the conversation from StrategyInput.LastMessage / History, and
// the AI handler builds a synthesised "explain the safety
// settings the user is asking about" prompt before the call, so
// the strategy itself contributes no extra prefix messages.
// Returning nil is correct.
func (s *Strategy) Context(_ context.Context, _ strategy.StrategyInput) ([]provider.Message, error) {
	return nil, nil
}

// RedactionPolicy implements [strategy.Strategy]. Returns
// PolicyChatbot wrapped through the F4↔F8 adapter so the
// dispatcher's per-request ctx-installation step (dispatch.Run
// installs the policy via redact.WithPolicy) sees the concrete
// policy.
//
// Per the slice prompt: "Policy: PolicyChatbot from
// internal/ai/redact/policies.go. Allowed classes: none;
// current settings are redacted and no provider sees secrets.
// Round-trip required: yes." PolicyChatbot's Allow=nil +
// Mode=ModeRedactedTags satisfies that contract: every PII
// class is tagged round-trip BEFORE the message reaches the
// provider so a leaked transcript reveals nothing. The typed
// envelope returned by query_safety_settings contains scalar
// setting values only (booleans, enum strings, HH:MM time
// strings); the policy is defence in depth in case a future
// edit widens the schema.
func (s *Strategy) RedactionPolicy() strategy.RedactionPolicy {
	return redactadapter.Wrap(redact.PolicyChatbot())
}

// EvalGoldens implements [strategy.Strategy]. The eval harness
// loads goldens from
// `internal/ai/strategies/safety-setting-explainer/goldens.yaml`
// directly (see internal/ai/eval/golden.go LoadAllGoldens) — the
// Strategy interface's EvalGoldens method is a future hook for
// strategies that want to ship goldens in code. Returning nil
// here keeps the YAML path the single source of truth.
func (s *Strategy) EvalGoldens() []strategy.EvalGolden { return nil }

// Compile-time assertion: Strategy satisfies the port.
var _ strategy.Strategy = (*Strategy)(nil)
