package api

// Phase-50 / 0054 — P3 Helix safety setting explainer.
//
// ai_safety_setting_explainer_handler.go implements the LLM-
// backed handler at POST /api/v1/ai/settings/safety/explain. The
// flow mirrors ai_quiet_hours_suggestion_handler.go (the
// immediate predecessor slice — body-driven, one-shot read-only
// explanation, no persistence):
//
//	URL  /api/v1/ai/settings/safety/explain
//	  ↓
//	read JSON body (optional field: question string [<=2000 char]) —
//	  the field falls back to a deterministic "explain my safety
//	  settings" prompt so the SPA can post {} for the most common
//	  case
//	  ↓
//	resolve provider via *provider.Registry.For("safety-setting-explainer")
//	  ↓
//	open SSE writer (internal/ai/stream.New) to the HTTP response
//	  ↓
//	synthesise the user-message that scopes the question to the
//	  safety envelope and instructs the tool sequence
//	  (query_safety_settings → optional retrieve_docs → narrate)
//	  ↓
//	run dispatch.Dispatcher.Run(ctx, strategy, input, sseWriter)
//
// The handler is mounted from internal/api/ai_routes.go via
// guard.Wrap("safety-setting-explainer", …) so when ai_mode='off'
// or the per-feature toggle is off the guard returns 404 BEFORE
// this handler ever sees the request (ADR-015 §I6).
//
// No per-request scope binding is needed: the safety settings
// are GLOBAL to the install (one row per setting in the
// canonical `settings` table — not per-user). The handler still
// reads the forward-auth subject for audit/rate-limit
// annotations, but the tool reads no per-user data so a
// missing subject does NOT prevent the request from running
// (the strategy + tool surface no per-user state).
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic /api/v1/settings
//     handler + the existing Settings UI are unchanged. This
//     handler is an OPT-IN add-on; off-mode users never see it.
//   - I7 per-feature:     the route is gated by
//     guard.Wrap("safety-setting-explainer").
//   - I9 redaction:       PolicyChatbot (Allow=nil, Mode=
//     ModeRedactedTags — every PII class round-tripped) is
//     installed by dispatch.Run from the strategy and applied
//     to EVERY message (including the synthesised user message
//     and tool outputs) by the redact decorator at the provider
//     boundary. The typed envelope the tool returns is PII-free
//     by construction (scalar setting values only); this
//     policy is defence-in-depth.
//   - I10 type system:    the AI surface lives entirely under
//     /api/v1/ai/*; no field on the existing baseline
//     /api/v1/settings JSON shape is added or modified by this
//     slice.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/ai/dispatch"
	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
	safetysettingexplainer "github.com/ev-dev-labs/teslasync/internal/ai/strategies/safety-setting-explainer"
	"github.com/ev-dev-labs/teslasync/internal/ai/strategy"
	"github.com/ev-dev-labs/teslasync/internal/ai/stream"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
	"github.com/ev-dev-labs/teslasync/internal/ai/tools/safety"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	settingsdb "github.com/ev-dev-labs/teslasync/internal/database/settings"
)

// aiSafetySettingExplainerMaxIterations bounds the dispatcher's
// tool-loop. The strategy is exactly query_safety_settings →
// (optional retrieve_docs) → answer. A hard ceiling of 8 is
// generous, matching the other narrator handlers.
const aiSafetySettingExplainerMaxIterations = 8

// aiSafetySettingExplainerMaxBodyBytes caps the request body.
// The body has at most one small free-text field; bound it
// cheaply. 16 KiB matches the other body-driven AI handlers.
const aiSafetySettingExplainerMaxBodyBytes = 16 * 1024

// aiSafetySettingExplainerMaxQuestionLen caps the optional
// question free-text field. 2000 chars is the same bound the
// chatbot handler uses for the user-message field. A
// `question` larger than this is almost certainly a runaway
// paste and will burn tokens before it ever reaches the
// useful tool calls.
const aiSafetySettingExplainerMaxQuestionLen = 2000

// aiSafetySettingExplainerRequest is the typed body shape. The
// `question` field is optional; the handler falls back to a
// deterministic "explain my safety settings" prompt when
// absent so the SPA can POST {} for the most common case.
type aiSafetySettingExplainerRequest struct {
	// Question is the user's free-text question about a
	// specific safety setting (e.g. "what does
	// alert_digest_mode do?"). Optional; defaults to a
	// generic "explain my safety settings" prompt when
	// absent. Bounded by aiSafetySettingExplainerMaxQuestionLen.
	Question string `json:"question,omitempty"`
}

// AISafetySettingExplainerHandler is the HTTP handler for
// POST /api/v1/ai/settings/safety/explain.
//
// Stateless beyond its constructor inputs; safe for concurrent
// use across requests. Construction is in router.go so the
// dispatcher's tool registry + provider registry are wired
// once at boot.
type AISafetySettingExplainerHandler struct {
	registry   *provider.Registry
	tools      *tools.Registry
	strategy   strategy.Strategy
	headerName string
	maxIters   int
}

// NewAISafetySettingExplainerHandler constructs the handler.
// All non-pointer arguments are required; the constructor
// panics on a nil so the wiring bug surfaces at boot, not at
// first request.
//
// registry:   AI provider registry (decorator chain already
//
//	applied).
//
// toolReg:    process-wide tool registry. MUST contain
//
//	query_safety_settings (registered by
//	safety.RegisterSafetySettingExplainerTools in
//	router.go) and retrieve_docs (registered globally
//	by tools.RegisterHelpTools).
//
// strat:      the safety-setting-explainer Strategy (one per
//
//	process).
//
// headerName: forward-auth header name; used for audit
//
//	annotations only — the safety envelope is global,
//	so a missing subject does NOT prevent the
//	request from running.
func NewAISafetySettingExplainerHandler(
	registry *provider.Registry,
	toolReg *tools.Registry,
	strat strategy.Strategy,
	headerName string,
) *AISafetySettingExplainerHandler {
	switch {
	case registry == nil:
		panic("api: NewAISafetySettingExplainerHandler: nil provider.Registry")
	case toolReg == nil:
		panic("api: NewAISafetySettingExplainerHandler: nil tools.Registry")
	case strat == nil:
		panic("api: NewAISafetySettingExplainerHandler: nil strategy.Strategy")
	}
	return &AISafetySettingExplainerHandler{
		registry:   registry,
		tools:      toolReg,
		strategy:   strat,
		headerName: headerName,
		maxIters:   aiSafetySettingExplainerMaxIterations,
	}
}

// parseSafetySettingExplainerRequest drains the body. The
// field is optional; the handler falls back to a deterministic
// "explain my safety settings" prompt when absent. An empty
// body ({} or even a missing body) is acceptable. Unknown
// fields are rejected so a future schema drift surfaces
// explicitly. Returns (req, true) when the body is acceptable.
func parseSafetySettingExplainerRequest(w http.ResponseWriter, r *http.Request) (aiSafetySettingExplainerRequest, bool) {
	var req aiSafetySettingExplainerRequest
	if r.Body == nil {
		return req, true
	}
	defer r.Body.Close()
	bodyBytes, readErr := io.ReadAll(io.LimitReader(r.Body, aiSafetySettingExplainerMaxBodyBytes))
	if readErr != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("failed to read body: %v", readErr))
		return req, false
	}
	if len(bytesTrim(bodyBytes)) == 0 {
		return req, true
	}
	dec := json.NewDecoder(strings.NewReader(string(bodyBytes)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return req, false
	}
	if q := strings.TrimSpace(req.Question); len(q) > aiSafetySettingExplainerMaxQuestionLen {
		writeError(w, http.StatusBadRequest, fmt.Sprintf(
			"question length %d exceeds the maximum %d characters",
			len(q), aiSafetySettingExplainerMaxQuestionLen))
		return req, false
	} else {
		req.Question = q
	}
	return req, true
}

// ServeHTTP implements [http.Handler]. The body is parsed, the
// dispatcher is invoked, and the SSE stream is closed via the
// dispatcher's deferred WriteDone. Every error path either
// writes a structured frame onto the SSE stream (when the
// writer has been opened) or a plain JSON 4xx/5xx (before it
// has).
func (h *AISafetySettingExplainerHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1) Parse + validate the request body.
	req, ok := parseSafetySettingExplainerRequest(w, r)
	if !ok {
		return
	}

	// 2) Read the forward-auth subject for audit/rate-limit
	// annotations. The safety envelope is GLOBAL so a missing
	// subject does NOT prevent the request from running —
	// this surface explains install-wide setting state, not
	// per-user state. Empty subject still annotates the
	// audit log as anonymous.
	subject, _ := tsauth.SubjectFromRequest(r, h.headerName)

	// 3) Resolve provider via the registry. Per-request
	// resolution honours mid-flight settings changes (model
	// swap, mode flip) without restart. A resolve failure
	// must NOT open the SSE stream — emit JSON 502 so the
	// frontend falls back gracefully.
	if _, err := h.registry.For(r.Context(), safetysettingexplainer.FeatureID); err != nil {
		log.Error().Err(err).Msg("ai safety-setting-explainer: provider.For failed")
		writeError(w, http.StatusBadGateway, "ai provider unavailable")
		return
	}

	// 4) Subject + feature-id annotations for audit/rate-
	// limit. No per-request tool-scope binding is needed
	// (the safety envelope is global).
	ctx := provider.WithSubject(r.Context(), subject)
	ctx = provider.WithFeatureID(ctx, safetysettingexplainer.FeatureID)

	// 5) Open the SSE writer.
	sseW, ctx, err := stream.New(ctx, w, stream.WithFeatureID(safetysettingexplainer.FeatureID))
	if err != nil {
		log.Error().Err(err).Msg("ai safety-setting-explainer: stream.New failed (non-flushable writer)")
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 6) Resolve the per-feature provider from the (now-
	// annotated) context.
	prov, err := h.registry.For(ctx, safetysettingexplainer.FeatureID)
	if err != nil {
		log.Error().Err(err).Msg("ai safety-setting-explainer: provider.For (post-stream) failed")
		_ = sseW.WriteError(err)
		return
	}

	// 7) Build the dispatcher with the deny-all confirm hook.
	// The strategy's tool whitelist is pure-read so the
	// deny-all hook is never reached in practice — defence
	// in depth.
	d := dispatch.New(h.tools, prov, denyAllConfirm, h.maxIters)

	// 8) Synthesise the user message. The recommendation is
	// NOT conversational — there is no chat history. We hand
	// the LLM a deterministic prompt that scopes to the
	// safety envelope and instructs the tool sequence
	// EXACTLY: query_safety_settings first, then optionally
	// retrieve_docs, then narration.
	userMsg := buildSafetySettingExplainerUserMessage(req.Question)

	// 9) Run the dispatcher.
	in := strategy.StrategyInput{
		LastMessage: userMsg,
		History:     nil,
	}
	if err := d.Run(ctx, h.strategy, in, sseW); err != nil {
		log.Error().Err(err).
			Str("subject", subject).
			Int("question_len", len(req.Question)).
			Msg("ai safety-setting-explainer: dispatcher returned error")
	}
}

// buildSafetySettingExplainerUserMessage synthesises the user
// message the LLM sees. The format is deterministic so canned
// goldens and provider prompt-hash caches stay stable across
// boots.
//
// When the body's question is empty, the synthesised message
// is a generic "explain my safety settings" prompt; when the
// body's question is set, it is forwarded verbatim AFTER the
// tool-sequence preamble so the LLM still respects the
// query_safety_settings-first directive.
func buildSafetySettingExplainerUserMessage(question string) string {
	question = strings.TrimSpace(question)
	if question == "" {
		question = "Give a short overview of my safety-related TeslaSync settings: which ones are enabled, which differ from their default, and what each one controls in plain English."
	}
	return fmt.Sprintf(
		"The user has asked: %q. "+
			"Follow the tool sequence EXACTLY: "+
			"(1) call query_safety_settings with no arguments to fetch the deterministic typed envelope of every safety-related setting "+
			"(each entry carries key, current_value, default_value, allowed_values when enum, short_description, docs_anchor). "+
			"(2) OPTIONALLY call retrieve_docs ONCE with source_types=[\"docs\"] for a documentation chunk that matches the user's question; "+
			"NEVER call retrieve_docs with the runbooks or i18n source types — those are operator-only corpora. "+
			"Produce a 2-4 sentence explanation grounded strictly in the typed envelope. "+
			"Quote ONLY the canonical setting key (e.g. quiet_hours_enabled, alert_digest_mode), the current_value, the default_value (when they differ), "+
			"and (when retrieve_docs returned a match) the docs chunk's source label so the user can read more. "+
			"Remember: you NEVER invent a setting key the typed envelope did not surface, NEVER invent allowed_values outside the envelope's allowed_values list, "+
			"NEVER claim the setting was changed by your narration, NEVER propose a different value, NEVER recommend the user \"should\" change the setting — "+
			"you EXPLAIN, you do not prescribe. "+
			"If the user asked about a setting that is NOT in the safety-related typed envelope (e.g. theme, units, currency), "+
			"refuse politely and direct them to the relevant Settings page rather than fabricating an answer.",
		question,
	)
}

// ---------------------------------------------------------------------------
// Production source adapter: AISafetySettingExplainerSource
// ---------------------------------------------------------------------------

// AISafetySettingExplainerSource is the production adapter
// satisfying safety.SafetySettingsSource. It wraps the canonical
// *settingsdb.SettingsRepo so the AI tool reads from the SAME
// data source the deterministic Settings UI already does — no
// new SQL, no duplicate read paths.
//
// The adapter performs ONE call against SettingsRepo.Get per
// request. The read is cheap: the canonical Settings struct is
// already a single hydrated value the rest of the API surface
// reuses.
type AISafetySettingExplainerSource struct {
	settings *settingsdb.SettingsRepo
}

// NewAISafetySettingExplainerSource constructs the production
// adapter. The repo is required; the constructor panics on a
// nil so the wiring bug surfaces at boot, not at first request.
func NewAISafetySettingExplainerSource(s *settingsdb.SettingsRepo) *AISafetySettingExplainerSource {
	if s == nil {
		panic("api: NewAISafetySettingExplainerSource: nil settings *settingsdb.SettingsRepo")
	}
	return &AISafetySettingExplainerSource{settings: s}
}

// LoadSafetySettings implements safety.SafetySettingsSource.
// Reads the canonical Settings row via SettingsRepo.Get and
// projects the safety-related fields into the typed envelope
// the LLM consumes. NO new SQL is written — the existing Get
// path is the canonical settings reader.
//
// The envelope's CurrentValue is read from the live row;
// DefaultValue is sourced from internal/settingsdb.settingsDefaults
// (we cannot import it directly since it is package-private,
// so the descriptor table below hard-codes the same default
// values as a deliberate cross-check — a divergence between
// the two surfaces in code review).
func (a *AISafetySettingExplainerSource) LoadSafetySettings(ctx context.Context) (*safety.SafetySettingsEnvelope, error) {
	cur, err := a.settings.Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("ai safety-setting-explainer: load settings: %w", err)
	}
	env := projectSafetySettingsEnvelope(cur)
	env.Source = "reader: internal/database/settings_repo.go SettingsRepo.Get (canonical settings table)"
	return env, nil
}

// projectSafetySettingsEnvelope builds the typed envelope from a
// hydrated *systemmodel.Settings. Pulled out for hermetic unit
// testing — the test feeds a known Settings value and asserts
// every safety-related entry is present with the expected
// current_value, default_value, allowed_values, and
// docs_anchor.
//
// The DEFAULTS hard-coded here MUST stay in sync with
// internal/database/settings_repo.go's settingsDefaults().
// A divergence is a load-bearing change reviewers should
// catch — the registry-coverage harness does not enforce this
// invariant, so the cross-check is human.
func projectSafetySettingsEnvelope(cur *systemmodel.Settings) *safety.SafetySettingsEnvelope {
	if cur == nil {
		// Defensive: render an empty envelope rather than
		// panic. The LLM's "refuse out-of-scope" directive
		// then flips every requested key to absent.
		return &safety.SafetySettingsEnvelope{
			Settings: map[string]safety.SafetySettingDescriptor{},
		}
	}
	out := &safety.SafetySettingsEnvelope{
		Settings: map[string]safety.SafetySettingDescriptor{
			"quiet_hours_enabled": {
				Key:              "quiet_hours_enabled",
				CurrentValue:     cur.QuietHoursEnabled,
				DefaultValue:     false,
				ShortDescription: "When true, TeslaSync defers non-critical notifications during the configured quiet-hours window. Critical alerts are always delivered.",
				DocsAnchor:       "notifications/quiet-hours.md",
			},
			"quiet_hours_start": {
				Key:              "quiet_hours_start",
				CurrentValue:     cur.QuietHoursStart,
				DefaultValue:     "22:00",
				ShortDescription: "Window start in HH:MM (24-hour) local time. Effective only when quiet_hours_enabled is true.",
				DocsAnchor:       "notifications/quiet-hours.md",
			},
			"quiet_hours_end": {
				Key:              "quiet_hours_end",
				CurrentValue:     cur.QuietHoursEnd,
				DefaultValue:     "07:00",
				ShortDescription: "Window end in HH:MM (24-hour) local time. Effective only when quiet_hours_enabled is true.",
				DocsAnchor:       "notifications/quiet-hours.md",
			},
			"alert_digest_mode": {
				Key:              "alert_digest_mode",
				CurrentValue:     cur.AlertDigestMode,
				DefaultValue:     "instant",
				AllowedValues:    []string{"instant", "hourly", "daily"},
				ShortDescription: "How alerts are batched. instant = deliver each alert as it fires; hourly = one digest per hour; daily = one digest per day.",
				DocsAnchor:       "notifications/digest.md",
			},
			"critical_flash_enabled": {
				Key:              "critical_flash_enabled",
				CurrentValue:     cur.CriticalFlashEnabled,
				DefaultValue:     true,
				ShortDescription: "When true, TeslaSync briefly flashes the browser tab title when a critical alert arrives while the tab is in the background. Honours the OS-level prefers-reduced-motion preference.",
				DocsAnchor:       "notifications/tab-signalling.md",
			},
			"tab_badge_enabled": {
				Key:              "tab_badge_enabled",
				CurrentValue:     cur.TabBadgeEnabled,
				DefaultValue:     true,
				ShortDescription: "When true, TeslaSync prefixes the browser tab title with (N) and paints a coloured dot on the favicon for unread notifications.",
				DocsAnchor:       "notifications/tab-signalling.md",
			},
			"api_suspended": {
				Key:              "api_suspended",
				CurrentValue:     cur.APISuspended,
				DefaultValue:     false,
				ShortDescription: "Operational kill-switch. When true, TeslaSync stops issuing requests to the Tesla Fleet API; existing telemetry streams continue. Used during outage triage so the install does not pile up rate-limited retries.",
				DocsAnchor:       "operations/api-suspended.md",
			},
		},
	}
	return out
}

// Compile-time assertions: AISafetySettingExplainerHandler
// satisfies http.Handler and AISafetySettingExplainerSource
// satisfies safety.SafetySettingsSource.
var (
	_ http.Handler                = (*AISafetySettingExplainerHandler)(nil)
	_ safety.SafetySettingsSource = (*AISafetySettingExplainerSource)(nil)
)
