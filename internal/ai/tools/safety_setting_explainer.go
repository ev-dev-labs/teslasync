// Phase-50 / 0054 — P3 Helix safety setting explainer.
//
// safety_setting_explainer.go ships ONE new read-only typed
// tool used by the safety-setting-explainer strategy:
//
//   - `query_safety_settings` — typed deterministic envelope
//     describing every safety-related TeslaSync setting
//     currently stored in the `settings` table. The envelope is
//     keyed by the setting's canonical JSON-tag key (e.g.
//     "quiet_hours_enabled", "alert_digest_mode") and each
//     entry carries the short metadata bundle the LLM needs to
//     produce an honest plain-English explanation: current
//     value, default value, allowed values (when the setting is
//     a closed enum), a one-line short_description, and a
//     docs_anchor pointing the user at the canonical
//     documentation chunk. NO database write is performed by
//     this tool.
//
//     Privacy: the safety-related settings are scalar global
//     toggles only (booleans, enum strings, HH:MM strings); no
//     PII (vehicle names, addresses, GPS, VINs, emails)
//     crosses the tool boundary. The per-feature redaction
//     policy `PolicyChatbot` allows ZERO PII classes — every
//     PII class is tagged round-trip BEFORE the message
//     reaches the provider, so a leaked transcript reveals
//     nothing beyond the public scalar setting state. This is
//     defence in depth in case a future edit widens the
//     envelope's schema.
//
// Tool design (vs the slice-0053 quiet-hours-suggestion tools):
//
//   - NO per-request scope binding is needed because the
//     settings are GLOBAL to the install (one row per setting
//     in the canonical `settings` table — not per-user — see
//     internal/database/settings_repo.go's Get(ctx) signature).
//     There is no "in-scope user" to bind, so the
//     prompt-injection-defence scope-check pattern from
//     quiet_hours_suggestion.go is not applicable here. The AI
//     handler still runs the per-feature guard
//     (`ai.GuardedHandler` with `safety-setting-explainer`)
//     so a user with `ai_mode='off'` or the per-feature toggle
//     off NEVER reaches this tool.
//
//   - The tool's input schema is intentionally empty: the LLM
//     calls `query_safety_settings` with no arguments and
//     receives the full safety-setting envelope. There is no
//     per-setting-key filter because (a) the envelope is small
//     (~7 entries) and (b) hiding entries from the LLM would
//     break the strategy's "refuse out-of-scope" directive —
//     the LLM needs to see the FULL safety envelope so it can
//     honestly say "X is not in this envelope" when asked
//     about an unrelated setting.
//
// Design constraints (from the slice prompt):
//
//   - "Tools must call existing typed handlers or services; no
//     duplicate write paths." → query_safety_settings
//     delegates to a narrow read-only port `SafetySettingsSource`
//     that wraps the canonical `*database.SettingsRepo` Get
//     method. NO new SQL is written. The deterministic
//     POST /api/v1/settings handler remains the canonical
//     baseline write path; this tool NEVER triggers a save.
//
//   - "the LLM never writes raw SQL" → tool has no DB handle.
//     The port hands a pre-aggregated envelope in.
//
//   - "no duplicate write paths" → no save_* / create_* /
//     apply_* / submit_* tool exists in this slice; the only
//     tool is a pure read.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// ---------------------------------------------------------------------------
// Typed envelope.
// ---------------------------------------------------------------------------

// SafetySettingDescriptor is one entry in the typed envelope
// query_safety_settings returns. Each safety-related setting
// (quiet_hours_enabled, quiet_hours_start, quiet_hours_end,
// alert_digest_mode, critical_flash_enabled, tab_badge_enabled,
// api_suspended) is one descriptor. The shape is deterministic:
// the LLM is grounded by it and the strategy's system prompt
// requires every claim to quote a value from this envelope
// verbatim.
//
// Field semantics:
//
//   - Key: the canonical JSON-tag key from
//     internal/models/system.go's Settings struct
//     (e.g. "quiet_hours_enabled"). The LLM quotes this key in
//     its narration so the user can find the toggle in the
//     Settings UI.
//   - CurrentValue / DefaultValue: typed scalars (bool, string,
//     int, float64) read from the canonical SettingsRepo and
//     the canonical settingsDefaults() function respectively.
//     Encoded as `any` so a single descriptor type covers all
//     scalar shapes; the LLM's narration prints them via the
//     provider's JSON serializer.
//   - AllowedValues: the closed-enum allow-set when the setting
//     is an enum (e.g. {"instant","hourly","daily"} for
//     alert_digest_mode). nil for free-form scalars (booleans,
//     HH:MM strings); the LLM's system prompt requires it to
//     refrain from inventing allowed values when this is nil.
//   - ShortDescription: a one-line plain-English summary the
//     LLM may quote verbatim. Authored in this file so the
//     prose is reviewable in code review (rather than scraped
//     from user-provided docs at runtime).
//   - DocsAnchor: a relative link the LLM may surface so the
//     user can read the canonical docs chunk. The
//     retrieve_docs tool returns the same anchor when its
//     query matches; this field is the deterministic fallback
//     when the LLM does not call retrieve_docs.
type SafetySettingDescriptor struct {
	Key              string   `json:"key"`
	CurrentValue     any      `json:"current_value"`
	DefaultValue     any      `json:"default_value"`
	AllowedValues    []string `json:"allowed_values,omitempty"`
	ShortDescription string   `json:"short_description"`
	DocsAnchor       string   `json:"docs_anchor"`
}

// SafetySettingsEnvelope is the typed envelope
// query_safety_settings returns. Settings is keyed by the
// canonical JSON-tag key so the LLM can look up entries by the
// same identifier the user sees in the Settings UI. The map is
// always non-nil and always contains every key in
// safetySettingKeys (defined below) so the LLM can prove a
// requested setting is absent (and thus out of scope) by
// checking presence in the envelope.
type SafetySettingsEnvelope struct {
	// Settings is the map of canonical-key → descriptor for
	// every safety-related setting currently stored.
	Settings map[string]SafetySettingDescriptor `json:"settings"`
	// Source is the dispatcher-visible breadcrumb so the LLM's
	// follow-up prose can attribute the values to the canonical
	// SettingsRepo rather than its own reasoning.
	Source string `json:"source"`
}

// ---------------------------------------------------------------------------
// Narrow port.
// ---------------------------------------------------------------------------

// SafetySettingsSource is the narrow port the
// query_safety_settings tool delegates to. In production it is
// satisfied by *api.AISafetySettingExplainerSource (which wraps
// the canonical *database.SettingsRepo); in tests we substitute
// deterministic fakes so the tool unit tests stay hermetic.
//
// The interface MUST stay read-only — adding a Save / Update
// method here would defeat the read-only contract that
// ADR-015 §I3 + the slice prompt mandate.
type SafetySettingsSource interface {
	// LoadSafetySettings returns the typed envelope
	// describing every safety-related setting currently
	// stored. The adapter is responsible for hydrating each
	// descriptor's CurrentValue from the canonical
	// SettingsRepo and DefaultValue from the canonical
	// settingsDefaults() function so the LLM can quote both
	// values verbatim and honestly note when they differ.
	LoadSafetySettings(ctx context.Context) (*SafetySettingsEnvelope, error)
}

// ---------------------------------------------------------------------------
// query_safety_settings
// ---------------------------------------------------------------------------

// querySafetySettingsInput is the typed input shape the
// dispatcher decodes the LLM's tool-call arguments JSON into.
// Intentionally empty: the LLM passes no arguments because the
// envelope is small and complete (returning every safety-related
// setting in one call). A future edit MAY add a `key` filter
// argument, but the FULL envelope is the right default because
// the strategy's "refuse out-of-scope" directive requires the
// LLM to prove a requested key is absent from the safety
// envelope — that proof requires it to see the full list.
type querySafetySettingsInput struct{}

// querySafetySettings is the read-only tool that returns the
// safety-related settings envelope. Construct via
// RegisterSafetySettingExplainerTools so the source is wired
// before the tool reaches the registry.
type querySafetySettings struct {
	source SafetySettingsSource
}

// Name implements [Tool].
func (t *querySafetySettings) Name() string { return "query_safety_settings" }

// Description implements [Tool]. Used by the LLM during tool
// selection — kept short and intent-focused.
func (t *querySafetySettings) Description() string {
	return "Return the deterministic typed envelope describing every safety-related TeslaSync setting currently stored. " +
		"Reports a map keyed by the setting's canonical JSON-tag key (e.g. quiet_hours_enabled, alert_digest_mode) where each entry carries {key, current_value, default_value, allowed_values (when enum), short_description, docs_anchor}. " +
		"NO PII (vehicle names, addresses, GPS, VINs, emails) crosses the tool boundary — the envelope contains scalar setting values only (booleans, enum strings, HH:MM strings). " +
		"READ-only — no record is created, mutated, or deleted; NO database write. " +
		"Call this FIRST; the envelope is the ground truth for the explanation you produce — DO NOT recompute, contradict, or invent settings beyond the envelope. " +
		"If the user asks about a setting not in the envelope's `settings` map, refuse politely and direct them to the relevant Settings page."
}

// InputSchema implements [Tool].
func (t *querySafetySettings) InputSchema() json.RawMessage {
	return cachedSchema(querySafetySettingsInput{})
}

// OutputSchema implements [Tool]. Nil ⇒ free-form output object.
func (t *querySafetySettings) OutputSchema() json.RawMessage { return nil }

// Mutates implements [Tool]. PROPOSE-only — never returns true.
// The tool reads the canonical settings store but does NOT
// touch the database. The actual save flows through the
// existing POST /api/v1/settings handler AFTER the user clicks
// Save in the Settings UI.
func (t *querySafetySettings) Mutates() bool { return false }

// RequiredScope implements [Tool]. Empty — the AI guard already
// gates on ai_mode + per-feature toggle upstream, and the tool
// produces no state mutation that needs an additional RBAC
// scope.
func (t *querySafetySettings) RequiredScope() string { return "" }

// Validate implements [Tool]. The input schema is empty so
// there is nothing to validate beyond the structural decode.
// The empty-struct validator (ValidateStruct) succeeds for any
// JSON object (including {}, which is the dispatcher's default
// when the LLM emits no arguments).
func (t *querySafetySettings) Validate(raw json.RawMessage) (any, error) {
	v, err := ValidateStruct[querySafetySettingsInput](raw)
	if err != nil {
		return v, err
	}
	in, ok := v.(querySafetySettingsInput)
	if !ok {
		return v, fmt.Errorf("query_safety_settings: validator returned unexpected type %T", v)
	}
	return in, nil
}

// Execute implements [Tool]. Single read of the canonical
// settings store via the SafetySettingsSource port; no IO is
// performed beyond that read.
//
// Missing-source is a hard failure: if the dispatcher is
// invoked from an unintended path (no source wired at
// registration), the tool refuses. The AI handler is the only
// path that should be loading this tool, and
// RegisterSafetySettingExplainerTools ALWAYS wires a non-nil
// source.
func (t *querySafetySettings) Execute(ctx context.Context, in any) (any, error) {
	_ = in.(querySafetySettingsInput)
	if t.source == nil {
		return nil, errors.New("query_safety_settings: no SafetySettingsSource wired")
	}
	env, err := t.source.LoadSafetySettings(ctx)
	if err != nil {
		return nil, err
	}
	if env == nil {
		return nil, errors.New("query_safety_settings: SafetySettingsSource returned nil envelope")
	}
	if env.Settings == nil {
		// Defensive: the strategy's "refuse out-of-scope"
		// directive depends on the LLM being able to look
		// up keys in env.settings. A nil map would let an
		// adversarial LLM claim any key is "absent"; force
		// at least an empty map so the absence is honest.
		env.Settings = map[string]SafetySettingDescriptor{}
	}
	return env, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// SafetySettingExplainerSources bundles the narrow port
// RegisterSafetySettingExplainerTools needs. Mirrors
// [QuietHoursSuggestionSources] (slice 0053).
//
// Production wiring (router.go) instantiates the production
// adapter (*api.AISafetySettingExplainerSource); tests substitute
// deterministic fakes.
type SafetySettingExplainerSources struct {
	Source SafetySettingsSource
}

// RegisterSafetySettingExplainerTools installs the
// safety-setting-explainer slice's tools on r. Called from
// router.go AFTER RegisterQuietHoursSuggestionTools so the
// registry's Names list continues to grow deterministically
// without disturbing earlier registrations or any builtin-names
// pin tests.
//
// Panics on duplicate registration (Registry.Register panics) —
// a second call is a wiring bug detected at boot, not at first
// request.
func RegisterSafetySettingExplainerTools(r *Registry, s SafetySettingExplainerSources) {
	r.Register(&querySafetySettings{source: s.Source})
}
