// Package features is the single source of truth for every AI feature
// in TeslaSync (ADR-015 §I10, methodology principle P9).
//
// One registry. Five guarantees:
//
//  1. The Settings UI is generated from this registry — adding a new
//     toggle means adding an entry, not touching the form.
//  2. The off-mode walker (Phase-50 / 9999 final-gate) discovers every
//     feature surface through this registry, so a feature without an
//     entry is invisible to the AI-off contract enforcement.
//  3. The Go vet tool tools/aivet asserts every /api/v1/ai/* route is
//     registered here, that every registered backend pattern is
//     wrapped by guard.Wrap, and that no entry is missing surface
//     metadata (CoverageOK below).
//  4. The TS generator tools/aigen emits web/src/ai/features.ts from
//     this file, so the frontend and backend cannot drift on the set
//     of feature IDs.
//  5. The useAiEnabled hook (web/src/hooks/useAiEnabled.ts) and the
//     withAiFeature HOC (web/src/components/ai/withAiFeature.tsx) read
//     the same set of IDs and refuse to render an unwrapped or
//     unknown surface.
//
// Adding a feature is a one-place change: register the entry, then let
// CI (aivet + ESLint rule) refuse the merge unless every required
// surface exists.
package features

import (
	"fmt"
	"sort"
)

// RouteSet enumerates every concrete surface a feature exposes. The
// final-gate AI-off invariant suite walks each list and asserts the
// expected behaviour for each in `ai_mode='off'`:
//
//   - Backend  : HTTP request → 404
//   - Frontend : React route mount → no DOM nodes carrying the feature's
//     UITestIDs
//   - JobNames : background dispatcher gate trips before execution
//   - PushKinds: push fan-out worker filters before delivery
//
// Empty arrays are explicit and allowed — they mean "this feature
// does not have this kind of surface". A nil array, by contrast, is a
// missing field and fails CoverageOK below: the final gate cannot
// prove a contract for a surface it cannot enumerate.
type RouteSet struct {
	// Backend is the chi-router method+path patterns owned by the
	// feature, e.g. "POST /api/v1/ai/chatbot". Patterns MUST match
	// the registration in internal/api/router.go verbatim.
	Backend []string

	// Frontend is the SPA route paths that host the feature, e.g.
	// "/chatbot". The final gate visits each with Playwright in
	// off mode and asserts no AI surface renders.
	Frontend []string

	// UITestIDs is the set of `data-ai-feature` markers withAiFeature
	// stamps onto its rendered tree. Absence in off mode is the
	// invariant the offMode.invariant.test verifies.
	UITestIDs []string

	// JobNames is the set of background dispatcher job IDs registered
	// for this feature. Each job re-checks ai_mode + per-feature opt-in
	// before executing (ADR-015 §I12 #3).
	JobNames []string

	// PushKinds is the set of push_subscriptions.kind values delivered
	// by this feature. The push fan-out worker filters by kind AND
	// the recipient's current ai_mode at delivery time (ADR-015 §I12 #2).
	PushKinds []string
}

// Feature is one row in the registry. The tier code is a single
// letter mapping to the Phase-50 methodology slice prefix
// (F, U, N, D, C, T, A, G, X, S, M, P, V, PU, GEN, ML).
//
// DefaultOn must be false for every feature (ADR-015 §I7); the field
// is kept on the struct to make that invariant explicit, and CoverageOK
// rejects any future change.
type Feature struct {
	ID          string   // canonical kebab-case, e.g. "chatbot-llm"
	Name        string   // display name shown in Settings → AI
	Description string   // one-line UX hint
	Tier        string   // methodology slice prefix
	DefaultOn   bool     // always false (ADR-015 §I7)
	NeedsRAG    bool     // requires F7 embeddings
	NeedsTools  bool     // mutates state via F4 tool registry
	NeedsStream bool     // uses F5 SSE streaming
	Routes      RouteSet // surface metadata for the off-mode walker
}

// Registry is the single source of truth for AI feature metadata.
// Every later Phase-50 slice (0011 onward) extends this map with a
// populated entry as part of its diff. A slice that does not is
// rejected by aivet and the ESLint rule at CI time.
//
// Keys MUST match the canonical kebab-case ID embedded in the entry
// (CoverageOK enforces this).
var Registry = map[string]Feature{
	// Phase-50 / U1 (slice 0011) seeds the LLM chatbot. The route
	// stub is wired in slice F0 (this slice) so the AI-off contract
	// has a concrete 404 to assert against.
	"chatbot-llm": {
		ID:          "chatbot-llm",
		Name:        "LLM Chatbot",
		Description: "Conversational fleet assistant powered by an LLM. Falls back to the heuristic chatbot when AI is off.",
		Tier:        "U",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/chatbot"},
			Frontend:  []string{"/chatbot"},
			UITestIDs: []string{"ai-feature-chatbot-llm-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},

	// Phase-50 / F1 (slice 0002) — provider-abstraction health probe.
	// Ops-only diagnostic that reports the *currently active*
	// adapter's name + capabilities so a deploy can confirm the
	// settings-driven provider selection behaves as expected. Has no
	// frontend surface (hence empty Frontend / UITestIDs) and is
	// gated behind sudo + the standard ai-mode + feature toggle so a
	// production install can leave it off and surface nothing.
	"ai-provider-health": {
		ID:          "ai-provider-health",
		Name:        "AI Provider Health (ops)",
		Description: "Diagnostic endpoint that reports the active AI provider and its capabilities. Off by default; enable only for ops debugging.",
		Tier:        "F",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  false,
		NeedsStream: false,
		Routes: RouteSet{
			Backend:   []string{"GET /api/v1/ai/_internal/health"},
			Frontend:  []string{},
			UITestIDs: []string{},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / F3 (slice 0004) — AI Call Log + Usage Card meta-feature.
	//
	// `__usage__` is a SPECIAL-CASE meta-feature: it has no per-feature
	// content of its own, only a usage/spend visualisation that the
	// AiUsageCard consumes. It is the exception to ADR-015 §I7
	// (per-feature opt-in) — the prompt explicitly carves it out as
	// "gates on ai_mode != 'off' only, no per-feature toggle". The
	// internal/api/ai_usage_handler.go layer wraps guard.Settings so
	// AIFeatureEnabled("__usage__") returns true whenever the mode is
	// non-off, while every other feature ID falls through to the real
	// per-feature toggle. The double-underscore prefix marks this entry
	// as not user-toggleable in the Settings → AI surface.
	//
	// The three Backend routes are mounted by mountAIUsageRoutes in
	// internal/api/router.go. They MUST stay in lockstep with the
	// strings here so tools/aivet's coverage check passes.
	"__usage__": {
		ID:          "__usage__",
		Name:        "AI Usage Card",
		Description: "Per-call audit log + spend visualisation for the AI provider chain. Gates on ai_mode != 'off' only.",
		Tier:        "F",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  false,
		NeedsStream: false,
		Routes: RouteSet{
			Backend: []string{
				"GET /api/v1/ai/usage/today",
				"GET /api/v1/ai/usage/by-feature",
				"GET /api/v1/ai/usage/recent",
			},
			Frontend:  []string{},
			UITestIDs: []string{"ai-feature-usage"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / U2 (slice 0012) — Weekly digest narration.
	//
	// Adds opt-in LLM-narrated prose on top of the existing template
	// weekly digest. The baseline template renderer at
	// web/src/features/analytics/pages/WeeklyDigestPage.tsx remains the
	// canonical baseline for any user with `ai_mode='off'`; this
	// feature only wires the AI surface that lives alongside it.
	//
	// Backend: POST /api/v1/ai/digests/weekly/narrate is mounted by
	// mountAIRoutes inside `internal/api/ai_routes.go` via guard.Wrap
	// so off-mode requests return 404 BEFORE the handler runs
	// (ADR-015 §I6).
	//
	// Frontend: the canonical host route is `/analytics/digest`
	// (declared per the slice prompt) — the AI section actually
	// renders inside the existing /weekly-digest page so the off-mode
	// invariant test (`WeeklyDigestAIOff.test.tsx`) can prove that
	// the wrapped component carrying `ai-feature-digest-narration-root`
	// is absent from the DOM in off mode.
	//
	// Background: `ai_digest_weekly` is the cross-cutting cron the
	// future scheduler will invoke once-a-week to fan out narrated
	// digests; the job re-checks ai_mode + per-feature toggle on every
	// tick (ADR-015 §I12 #3) and is a no-op when either is off.
	//
	// Push: `ai_digest_ready` is the push_subscriptions.kind delivered
	// when a narration completes; the future push fan-out worker
	// filters by this kind AND the recipient's current ai_mode at
	// delivery time (ADR-015 §I12 #2).
	"digest-narration": {
		ID:          "digest-narration",
		Name:        "Weekly digest narration",
		Description: "Opt-in LLM narration of the weekly digest. The deterministic template digest remains the baseline when AI is off.",
		Tier:        "U",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/digests/weekly/narrate"},
			Frontend:  []string{"/analytics/digest"},
			UITestIDs: []string{"ai-feature-digest-narration-root"},
			JobNames:  []string{"ai_digest_weekly"},
			PushKinds: []string{"ai_digest_ready"},
		},
	},
	// Phase-50 / U3 (slice 0013) — Year-in-review narration.
	//
	// Adds opt-in LLM-narrated prose layered on top of the existing
	// template year-in-review slide deck. The baseline slide renderer
	// at web/src/features/analytics/pages/YearReviewPage.tsx (mounted
	// at the SPA route /year-review/:year) remains the canonical
	// baseline for any user with `ai_mode='off'`; this feature only
	// wires the AI surface that lives alongside it.
	//
	// Backend: POST /api/v1/ai/analytics/year-in-review/narrate is
	// mounted by mountAIRoutes in `internal/api/ai_routes.go` via
	// guard.Wrap so off-mode requests return 404 BEFORE the handler
	// runs (ADR-015 §I6).
	//
	// Frontend: the canonical host route declared by the slice prompt
	// is `/analytics/year-in-review` — the AI section actually renders
	// inside the existing /year-review/:year page so the off-mode
	// invariant test (`YearReviewAIOff.test.tsx`) can prove that the
	// wrapped component carrying `ai-feature-yir-narration-root` is
	// absent from the DOM in off mode. The pattern (canonical host
	// route in the registry, real render path elsewhere) mirrors the
	// digest-narration entry above (slice 0012); both surfaces are
	// rendered conditionally inside the same baseline page they
	// narrate.
	//
	// Background: `ai_yir_pregen` is the cross-cutting cron the future
	// scheduler will invoke (typically in the early days of a new year)
	// to pre-generate narrated year-in-review slides; the job re-checks
	// ai_mode + per-feature toggle on every tick (ADR-015 §I12 #3) and
	// is a no-op when either is off.
	//
	// Push: `ai_yir_ready` is the push_subscriptions.kind delivered
	// when a year-in-review narration completes; the future push fan-out
	// worker filters by this kind AND the recipient's current ai_mode
	// at delivery time (ADR-015 §I12 #2).
	"yir-narration": {
		ID:          "yir-narration",
		Name:        "Year-in-review narration",
		Description: "Opt-in LLM narration of the annual year-in-review slides. The deterministic template slides remain the baseline when AI is off.",
		Tier:        "U",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/analytics/year-in-review/narrate"},
			Frontend:  []string{"/analytics/year-in-review"},
			UITestIDs: []string{"ai-feature-yir-narration-root"},
			JobNames:  []string{"ai_yir_pregen"},
			PushKinds: []string{"ai_yir_ready"},
		},
	},
	// Phase-50 / U4 (slice 0014) — Anomaly explanation narration.
	//
	// Adds opt-in LLM-narrated plain-language explanation of anomalies
	// the deterministic Z-score detector has ALREADY identified. The
	// baseline detector + static safe-range explanation strings at
	// `internal/api/anomaly_handler.go` (rendered by
	// `web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx`,
	// mounted at the SPA route /anomaly-detection) remain the
	// canonical baseline for any user with `ai_mode='off'`; this
	// feature only wires the AI surface that lives alongside it.
	//
	// Detector behaviour, threshold values, and alerting routing are
	// UNCHANGED. The strategy reads anomalies via the typed
	// `query_anomaly_context` tool which delegates to the existing
	// AnomalyHandler.DetectAnomalies — no new SQL, no parallel
	// detector implementation.
	//
	// Backend: POST /api/v1/ai/anomalies/explain is mounted by
	// mountAIRoutes in `internal/api/ai_routes.go` via guard.Wrap so
	// off-mode requests return 404 BEFORE the handler runs (ADR-015
	// §I6).
	//
	// Frontend: the canonical host route declared by the slice prompt
	// is `/analytics/anomalies` — the AI section actually renders
	// inside the existing /anomaly-detection page (the only anomaly
	// dashboard in the SPA today; lives under
	// `web/src/features/diagnostics/...` not `analytics/...` because
	// the diagnostics directory is the canonical anomaly surface).
	// The off-mode invariant test
	// (`AnomalyDashboardAIOff.test.tsx`) proves that the wrapped
	// component carrying `ai-feature-anomaly-explanations-root` is
	// absent from the DOM in off mode.
	//
	// Background / Push: this slice ships zero new jobs and zero new
	// push kinds — anomaly explanation is request/response, narrated
	// on demand from the dashboard. The empty arrays are explicit so
	// CoverageOK passes.
	"anomaly-explanations": {
		ID:          "anomaly-explanations",
		Name:        "Anomaly explanation narration",
		Description: "Opt-in LLM narration that explains already-detected anomalies in plain language. The deterministic detector and safe-range explanations remain the baseline when AI is off.",
		Tier:        "U",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/anomalies/explain"},
			Frontend:  []string{"/analytics/anomalies"},
			UITestIDs: []string{"ai-feature-anomaly-explanations-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / D4 (slice 0024) — Auto trip naming.
	//
	// Adds opt-in LLM-assisted SUGGESTION of trip names from the
	// route context of one existing trip. The strategy is
	// propose-only: the AI produces a structured name proposal via
	// the F4 `draft_trip_name` + `validate_trip_name` tools and the
	// user then explicitly confirms / edits / saves the name from
	// the TripDetailPage UI. The actual persistence flows through
	// the existing typed trip-update path (out of scope for this
	// slice — the slice prompt says "while requiring explicit user
	// confirmation before saving"). Both tools are pure DTO
	// transforms with no DB writes.
	//
	// The deterministic TripDetailPage at `/trips/:id` — existing
	// stat cards, name field, KVList of trip metadata — remains the
	// canonical baseline for any user with `ai_mode='off'`. Manual
	// trip naming and existing trip labels are unchanged; this
	// feature only wires the opt-in suggestion panel that lives
	// alongside.
	//
	// Backend: POST /api/v1/ai/trips/{tripID}/name/draft is mounted
	// by mountAIRoutes in `internal/api/ai_routes.go` via guard.Wrap
	// so off-mode requests return 404 BEFORE the handler runs
	// (ADR-015 §I6). The endpoint streams a structured trip-name
	// proposal envelope via SSE — the response is a STRUCTURED
	// PROPOSAL the frontend renders for the user to confirm or
	// edit before saving. No state is mutated by this route. The
	// tripID URL param is parsed + validated by the handler as a
	// positive int64; 0 / negative / non-numeric values are
	// rejected with a 400 BEFORE opening the SSE stream.
	//
	// Frontend: the AI suggestion panel attaches to /trips/:id —
	// the canonical Trip Detail page that already renders the
	// deterministic distance / energy / efficiency / cost stat
	// cards plus the trip metadata KVList. Those baseline panels
	// remain the canonical path for any user with ai_mode='off'.
	// The wrapped AIAutoTripNameSuggestion component carrying
	// `ai-feature-auto-trip-naming-root` is absent from the DOM
	// when AI is off — see the off-mode invariant test
	// `TestAutoTripNamingAIOffHidesSuggestionButton.test.tsx`.
	//
	// Background: zero jobs. Trip-name suggestion is request /
	// response, on demand from the trip detail page — there is no
	// scheduled pre-render and no embedding corpus (NeedsRAG=false:
	// the strategy reads the trip header + its constituent drives
	// directly via typed read tools). Explicit `[]string{}` so
	// CoverageOK passes.
	//
	// Push kinds: zero — the panel is request/response on demand.
	// Explicit `[]string{}` so CoverageOK passes.
	//
	// NeedsRAG=false; NeedsTools=true (two propose-only tools);
	// NeedsStream=true (the structured proposal envelope plus the
	// optional one-line rationale are streamed back over SSE).
	"auto-trip-naming": {
		ID:          "auto-trip-naming",
		Name:        "Auto trip naming",
		Description: "Opt-in LLM-assisted trip-name suggestions grounded in the trip's route context (start/end places, drive count, distance, time window). Propose-only: the AI produces a structured proposal via two typed read-only tools and the user explicitly confirms or edits before saving through the existing trip-update path. The deterministic TripDetailPage stat cards, KVList of metadata, and existing trip labels remain the canonical baseline when AI is off. The per-feature redaction policy keeps lat/long, street addresses, and place names tagged; only the vehicle name may be narrated.",
		Tier:        "D",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/trips/{tripID}/name/draft"},
			Frontend:  []string{"/trips/:id"},
			UITestIDs: []string{"ai-feature-auto-trip-naming-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / N1 (slice 0015) — Natural-language alert builder.
	//
	// Adds opt-in LLM-assisted DRAFTING of AlertRule DTOs from a
	// natural-language description of the desired alert. The strategy
	// is propose-only: the AI produces a typed AlertRule draft via the
	// F4 `draft_alert_rule` + `validate_alert_rule` tools and the user
	// then explicitly clicks Save in the existing AlertStudioPage —
	// the actual mutation flows through the existing
	// POST /api/v1/alerts/rules typed handler, which is unchanged.
	//
	// The deterministic AlertStudioPage form + validateAlertRule
	// validator at `internal/api/alert_handler_rules.go` remain the
	// canonical baseline for any user with `ai_mode='off'`; this
	// feature only wires the AI surface that lives alongside it.
	//
	// Backend: POST /api/v1/ai/alerts/rules/draft is mounted by
	// mountAIRoutes in `internal/api/ai_routes.go` via guard.Wrap so
	// off-mode requests return 404 BEFORE the handler runs (ADR-015
	// §I6). The endpoint streams a draft AlertRule DTO via SSE —
	// the response is a STRUCTURED PROPOSAL the frontend renders
	// for the user to confirm or edit before saving through the
	// canonical alerts handler. No state is mutated by this route.
	//
	// Frontend: the canonical host route declared by the slice prompt
	// is `/alerts/studio` — the AI section actually renders inside
	// the existing /notifications/studio page (the only AlertStudio
	// page in the SPA today; lives under `web/src/features/notifications/...`
	// because the legacy `alert-studio` and `alerts` paths redirect
	// to it). The off-mode invariant test
	// (`TestNLAlertBuilderAIOffHidesPanelAndManualFormWorks.test.tsx`)
	// proves that the wrapped component carrying
	// `ai-feature-nl-alert-builder-root` is absent from the DOM in
	// off mode and the manual form continues to work. The pattern
	// (canonical host route in the registry, real render path
	// elsewhere) mirrors the digest-narration / yir-narration /
	// anomaly-explanations entries above.
	//
	// Background / Push: this slice ships zero new jobs and zero new
	// push kinds — alert drafting is request/response, on demand from
	// the AlertStudio page. The empty arrays are explicit so
	// CoverageOK passes.
	"nl-alert-builder": {
		ID:          "nl-alert-builder",
		Name:        "Natural-language alert builder",
		Description: "Opt-in LLM assistant that drafts typed AlertRule DTOs from a plain-language description. The deterministic AlertStudio form + validators remain the baseline when AI is off; saving still flows through the existing typed alerts handler.",
		Tier:        "N",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/alerts/rules/draft"},
			Frontend:  []string{"/alerts/studio"},
			UITestIDs: []string{"ai-feature-nl-alert-builder-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / N2 (slice 0016) — Natural-language automation builder.
	//
	// Adds opt-in LLM-assisted DRAFTING of typed Automation graph DTOs
	// (trigger + conditions + actions) from a natural-language
	// description. The strategy is propose-only: the AI produces a
	// typed automation draft via the F4 `draft_automation_graph` +
	// `validate_automation_graph` tools and the user then explicitly
	// clicks Save in the existing AutomationBuilderPage — the actual
	// mutation flows through the existing POST /api/v1/automations
	// typed handler (AutomationHandler.Create wrapped by
	// decodeAutomationInputDTO + per-step validators), which is
	// unchanged.
	//
	// The deterministic AutomationBuilderPage graph editor +
	// decodeAutomationInputDTO at
	// `internal/api/automation_handler_decode.go` remain the
	// canonical baseline for any user with `ai_mode='off'`; this
	// feature only wires the AI surface that lives alongside it.
	//
	// Backend: POST /api/v1/ai/automations/draft is mounted by
	// mountAIRoutes in `internal/api/ai_routes.go` via guard.Wrap so
	// off-mode requests return 404 BEFORE the handler runs (ADR-015
	// §I6). The endpoint streams a draft Automation DTO via SSE —
	// the response is a STRUCTURED PROPOSAL the frontend renders
	// for the user to confirm or edit before saving through the
	// canonical automations handler. No state is mutated by this
	// route.
	//
	// Frontend: the canonical host route declared by the slice prompt
	// is `/automations/builder` — the AI section actually renders
	// inside the existing AutomationBuilderPage which mounts at
	// /automations/new and /automations/:id/edit (the only
	// AutomationBuilder pages in the SPA today; lives under
	// `web/src/features/automations/...`). The off-mode invariant
	// test
	// (`TestNLAutomationBuilderAIOffHidesPanelAndManualBuilderWorks.test.tsx`)
	// proves that the wrapped component carrying
	// `ai-feature-nl-automation-builder-root` is absent from the DOM
	// in off mode and the manual graph editor continues to work.
	// The pattern (canonical host route in the registry, real render
	// path elsewhere) mirrors the digest-narration / yir-narration /
	// anomaly-explanations / nl-alert-builder entries above.
	//
	// Background / Push: this slice ships zero new jobs and zero new
	// push kinds — automation drafting is request/response, on demand
	// from the AutomationBuilder page. The empty arrays are explicit
	// so CoverageOK passes.
	"nl-automation-builder": {
		ID:          "nl-automation-builder",
		Name:        "Natural-language automation builder",
		Description: "Opt-in LLM assistant that drafts typed Automation graph DTOs (trigger + conditions + actions) from a plain-language description. The deterministic AutomationBuilder graph editor + validators remain the baseline when AI is off; saving still flows through the existing typed automations handler.",
		Tier:        "N",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/automations/draft"},
			Frontend:  []string{"/automations/builder"},
			UITestIDs: []string{"ai-feature-nl-automation-builder-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / N3 (slice 0017) — Natural-language search across drives,
	// charges, and alerts.
	//
	// Adds opt-in LLM-assisted DRAFTING of natural-language search queries
	// that retrieve and narrate matches across the user's drive summaries,
	// charging sessions, and alert history via the F7 RAG retriever. The
	// strategy is propose-only and read-only: the AI fetches existing
	// chunks via the F4 `retrieve_chunks` tool, optionally hydrates one
	// or more cited results via `hydrate_search_result`, and narrates the
	// answer to the user — it never writes to the database, never creates
	// or mutates any drive/charge/alert, and never bypasses the
	// per-tenant subject scoping built into the F7 retriever.
	//
	// The deterministic typed search at GET /api/v1/search served by the
	// existing SearchHandler (`internal/api/search_handler.go`) and
	// rendered by the SearchPage at the SPA route /search remains the
	// canonical baseline for any user with `ai_mode='off'`. This feature
	// only wires the AI side panel that lives alongside the typed
	// filters.
	//
	// Backend: POST /api/v1/ai/search/query is mounted by mountAIRoutes
	// in `internal/api/ai_routes.go` via guard.Wrap so off-mode requests
	// return 404 BEFORE the handler runs (ADR-015 §I6). The endpoint
	// streams a narrated response + cited result envelopes via SSE — the
	// response is a STRUCTURED PROPOSAL the frontend renders alongside
	// the typed result list. No state is mutated by this route.
	//
	// Frontend: the canonical host route declared by the slice prompt is
	// `/search` — the AI section actually renders inside the existing
	// SearchPage at `web/src/features/system/pages/SearchPage.tsx` so
	// the off-mode invariant test
	// (`TestNLSearchAIOffFallsBackToTypedFilters.test.tsx`) proves that
	// the wrapped component carrying `ai-feature-nl-search-root` is
	// absent from the DOM in off mode and the typed filter form
	// continues to work. The pattern (canonical host route in the
	// registry, real render path inside the existing baseline page)
	// mirrors digest-narration / yir-narration / anomaly-explanations /
	// nl-alert-builder / nl-automation-builder above.
	//
	// Background: `ai_search_indexer` is the cross-cutting cron a future
	// scheduler will invoke to refresh the embeddings the F7 retriever
	// reads when scoring NL queries; the job re-checks ai_mode +
	// per-feature toggle on every tick (ADR-015 §I12 #3) and is a no-op
	// when either is off. This slice declares the JobName so registry
	// coverage + the off-mode walker can enforce the absence-in-off
	// contract before the worker ships, mirroring the U2 digest-narration
	// `ai_digest_weekly` precedent (worker landed in a follow-up slice).
	//
	// Push: zero new push kinds — NL search is request/response, on
	// demand from the SearchPage. The empty array is explicit so
	// CoverageOK passes.
	"nl-search": {
		ID:          "nl-search",
		Name:        "Natural-language search",
		Description: "Opt-in LLM-assisted natural-language search across the user's drives, charging sessions, and alert history via the F7 RAG retriever. The deterministic typed search filters at /search remain the baseline when AI is off; results are still rendered via the existing typed search handler — the AI side panel only narrates and cites the retrieved chunks.",
		Tier:        "N",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/search/query"},
			Frontend:  []string{"/search"},
			UITestIDs: []string{"ai-feature-nl-search-root"},
			JobNames:  []string{"ai_search_indexer"},
			PushKinds: []string{},
		},
	},
	// Phase-50 / N4 (slice 0018) — Per-drive coaching narrative.
	//
	// Backend: POST /api/v1/ai/drives/{driveID}/coach. The route is
	// the FIRST AI surface to take its primary identifier from a chi
	// URL path parameter (instead of a JSON body) — the AI surface
	// attaches to a specific drive's detail page (/drives/:id), so
	// the URL is the natural place for the drive_id. The handler
	// (internal/api/ai_drive_coach_handler.go) parses driveID with
	// strconv.ParseInt + a positive-integer check before opening the
	// SSE stream, then runs the dispatch loop against the
	// drive-coaching strategy with the locked decorator order
	// (redact → rate-limit → cost-cap → audit → trace).
	//
	// Frontend: the canonical host route declared by the slice
	// prompt is `/drives/:driveId`, but the actual app route in
	// web/src/router/routeRegistry.ts is `/drives/:id` — we register
	// the SAME pattern the router actually uses so the off-mode
	// invariant test
	// (`TestDriveCoachingAIOffShowsOnlyBaselineStats.test.tsx`)
	// proves that the wrapped component carrying
	// `ai-feature-drive-coaching-root` is absent from the DOM when
	// ai_mode='off' AND the deterministic stat cards / hero gauges /
	// energy summary / etc. on DriveDetailPage continue to render.
	// Mirrors the host-route-vs-render-path pattern of every other
	// N-tier feature above.
	//
	// Background + push: zero new background jobs and zero new push
	// kinds — drive coaching is request/response on demand from the
	// drive detail page. Both arrays are explicit []string{} so
	// CoverageOK passes.
	//
	// NeedsRAG=false: the strategy uses ONLY the two declared tools
	// (`query_drive_detail` + `query_drive_telemetry_summary`); it
	// does NOT call the F7 retriever. The
	// `drive_summary` / `route_efficiency` / `speed_profile` source
	// types listed in the slice prompt's RAG section are not yet
	// wired into internal/ai/rag/rag.go, and adding them would
	// require migrations that are explicitly NOT in this slice's
	// allowed file list. The two read-only tools fully satisfy the
	// strategy's needs from the existing per-drive aggregates on
	// the *models.Drive struct.
	"drive-coaching": {
		ID:          "drive-coaching",
		Name:        "Per-drive coaching",
		Description: "Opt-in LLM-narrated 2-4 paragraph coaching summary for an individual drive. Reads from the deterministic per-drive aggregates surfaced by the existing /drives/{driveID} handler and a small typed telemetry-summary tool; the deterministic stat cards, hero gauges, and energy summary on the drive detail page remain the canonical baseline when AI is off.",
		Tier:        "N",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/drives/{driveID}/coach"},
			Frontend:  []string{"/drives/:id"},
			UITestIDs: []string{"ai-feature-drive-coaching-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / N5 (slice 0019) — Per-charging-session diagnosis.
	//
	// Backend: POST /api/v1/ai/charging/{sessionID}/diagnose. The route
	// follows the same URL-as-primary-identifier shape introduced in
	// the N4 drive-coaching slice: the AI surface attaches to a
	// specific charging session's detail page (/charging/:id), so
	// {sessionID} lives in the chi URL path and the JSON body is
	// empty. The handler (internal/api/ai_charging_diagnosis_handler.go)
	// parses sessionID with strconv.ParseInt + a positive-integer check
	// before opening the SSE stream, then runs the dispatch loop
	// against the charging-diagnosis strategy with the locked decorator
	// order (redact → rate-limit → cost-cap → audit → trace).
	//
	// Frontend: the canonical host route declared by the slice prompt
	// is `/charging/:sessionId`, but the actual app route in
	// web/src/lib/routeRegistry.ts (line 45) is `/charging/:id` — we
	// register the SAME pattern the router actually uses so the
	// off-mode invariant test
	// (`TestChargingDiagnosisAIOffShowsOnlyDeterministicFlags.test.tsx`)
	// proves that the wrapped component carrying
	// `ai-feature-charging-diagnosis-root` is absent from the DOM
	// when ai_mode='off' AND the deterministic charging stat cards
	// / hero gauges / charge curve / battery-level chart on
	// ChargingDetailPage continue to render. Mirrors the host-route-
	// vs-render-path pattern of every other N-tier feature above —
	// most notably the drive-coaching N4 slice immediately preceding
	// this one which made the same `:driveId` → `:id` adjustment.
	//
	// Background + push: zero new background jobs and zero new push
	// kinds — charging diagnosis is request/response on demand from
	// the charging detail page. Both arrays are explicit []string{}
	// so CoverageOK passes.
	//
	// NeedsRAG=false: the strategy uses ONLY the two declared tools
	// (`query_charge_session` + `query_charging_aggregation`); it
	// does NOT call the F7 retriever. The slice prompt's RAG section
	// names `charge_session` / `energy_price` / `vehicle_state`
	// source types but those are not yet wired into
	// internal/ai/rag/rag.go, and adding them would require
	// migrations explicitly outside this slice's allowed file list.
	// The two read-only tools fully satisfy the strategy's needs
	// from the existing per-session aggregates on the
	// *models.ChargingSession struct plus the deterministic
	// flag-detection logic that today lives in
	// web/src/lib/chargingAggregation.ts (slice 0019 mirrors that
	// logic server-side as a *read-only* tool — flag computation
	// itself is unchanged on the frontend per the slice prompt's
	// "without changing how flags are computed" mandate).
	"charging-diagnosis": {
		ID:          "charging-diagnosis",
		Name:        "Charging session diagnosis",
		Description: "Opt-in LLM-narrated explanation of trickle, expensive, low-power, or interrupted charging flags for an individual charging session. Reads from the existing /charging/{sessionID} aggregates plus a deterministic flag-detection envelope; the deterministic charging stat cards, hero gauges, charge curve, and existing flag badges on the charging detail page remain the canonical baseline when AI is off.",
		Tier:        "N",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/charging/{sessionID}/diagnose"},
			Frontend:  []string{"/charging/:id"},
			UITestIDs: []string{"ai-feature-charging-diagnosis-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / N6 (slice 0020) — RAG-backed app help.
	//
	// `rag-help` is the opt-in LLM-narrated app help assistant. The
	// AI route POST /api/v1/ai/help/query opens a one-shot SSE
	// stream backed by the dispatcher loop: the LLM calls
	// retrieve_docs across the curated docs|runbooks|i18n corpora
	// (F7 rag.Retriever scoped to the GLOBAL user_subject="" rows
	// the F7 docs_indexer writes), optionally calls cite_help_chunk
	// to format a citation envelope, and narrates a concise answer
	// with explicit citations.
	//
	// The deterministic baseline rendered by the SPA route /help —
	// curated links into the existing /docs/* + /system-status +
	// /chatbot + /search + /onboarding pages plus the existing
	// in-app tooltips and i18n help copy — is unchanged when AI is
	// off (ADR-015 §I3, §I5, §I6). Off-mode users never see the AI
	// surface at all; the deterministic curated links remain the
	// canonical help path.
	//
	// JobNames: `ai_docs_indexer` is the gated background job that
	// keeps the help corpus embeddings fresh. Today it is a fail-
	// closed gate stub (mirrors the pattern from ai_digest_weekly
	// and ai_year_in_review_pregen); a future slice wires the
	// actual fan-out across curated docs/runbooks/i18n sources.
	// The job MUST be listed here so the final-gate proves it has
	// no scheduled invocation when ai_mode='off'.
	"rag-help": {
		ID:          "rag-help",
		Name:        "RAG-backed app help",
		Description: "Opt-in LLM-narrated answers to natural-language application help questions, grounded in the application's own documentation, runbooks, and i18n strings via the F7 RAG retriever. The deterministic curated /help page links + tooltips + i18n help copy remain the canonical baseline when AI is off.",
		Tier:        "N",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/help/query"},
			Frontend:  []string{"/help"},
			UITestIDs: []string{"ai-feature-rag-help-root"},
			JobNames:  []string{"ai_docs_indexer"},
			PushKinds: []string{},
		},
	},
	// Phase-50 / D1 (slice 0021) — Natural-language drive search and replay.
	//
	// Backend: POST /api/v1/ai/drives/search. The AI handler streams
	// SSE frames from the dispatch loop; the two declared tools are
	// retrieve_drive_chunks (F7 retriever over the drive corpora) and
	// hydrate_drive_replay (read-only port that resolves a drive
	// reference into a {title, subtitle, url, replay_url, when}
	// envelope). The route is mounted under guard.Wrap so it returns
	// 404 when ai_mode='off' OR when the per-feature toggle is off.
	//
	// Frontend: the AI side panel attaches to /drives — the canonical
	// drive history page. The DrivesListPage's deterministic typed
	// filters (range picker, vehicle select, search input, anomaly
	// callouts) AND the existing /drives/:id/replay TripReplayPage
	// controls remain the canonical baseline path for any user with
	// ai_mode='off'. The wrapped AINLDriveSearch component carrying
	// `ai-feature-nl-drive-search-replay-root` is absent from the DOM
	// when AI is off — see the off-mode invariant test
	// `TestNLDriveSearchReplayAIOffUsesTypedFiltersOnly.test.tsx`.
	//
	// Background: `ai_drive_indexer` is the gated job that keeps the
	// drive corpora embeddings fresh. Today it is a fail-closed gate
	// stub (mirrors `ai_docs_indexer` + `ai_search_indexer`); a
	// future slice wires the actual fan-out across drive_summary,
	// route_segment, and location_summary sources. The job MUST be
	// listed here so the final-gate proves it has no scheduled
	// invocation when ai_mode='off'.
	//
	// Push kinds: zero — the AI side panel is request/response on
	// demand from the user's NL query. Explicit []string{} so
	// CoverageOK passes.
	//
	// NeedsRAG=true because retrieve_drive_chunks calls the F7
	// retriever; NeedsTools=true because the strategy invokes two
	// read-only tools; NeedsStream=true because the handler streams
	// SSE frames from the dispatch loop.
	"nl-drive-search-replay": {
		ID:          "nl-drive-search-replay",
		Name:        "NL drive search and replay",
		Description: "Opt-in LLM-assisted natural-language search across the calling user's drive history with one-click jump-to-replay anchors, grounded in the F7 RAG retriever over drive_summary, route_segment, and location_summary corpora. The deterministic typed filters on /drives and the existing /drives/:id/replay TripReplayPage controls remain the canonical baseline when AI is off; the AI side panel only narrates and cites already-retrieved drives with replay anchors — it never replaces the typed query path.",
		Tier:        "D",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/drives/search"},
			Frontend:  []string{"/drives"},
			UITestIDs: []string{"ai-feature-nl-drive-search-replay-root"},
			JobNames:  []string{"ai_drive_indexer"},
			PushKinds: []string{},
		},
	},
	// Phase-50 / D2 (slice 0022) — Speed-profile insights.
	//
	// Backend: POST /api/v1/ai/drives/{driveID}/speed-profile/insights.
	// The AI handler streams SSE frames from the dispatch loop; the
	// two declared tools are query_speed_profile (returns SI-canonical
	// aggregates plus derived speed regime classification from the
	// existing *models.Drive struct) and query_drive_context (returns
	// the drive's temporal + battery + temperature envelope). Both
	// are read-only and call `DriveSource.GetByID` directly — no new
	// SQL is added by this slice. The route is mounted under
	// guard.Wrap so it returns 404 when ai_mode='off' OR when the
	// per-feature toggle is off.
	//
	// Frontend: the AI insights panel attaches to /drives/:id — the
	// canonical drive detail page (the SPA route is registered as
	// `/drives/:id` not `:driveId`; the prompt's `:driveId` wording
	// matches the BACKEND URL param, which chi exposes as `driveID`).
	// The existing SpeedHistogramChart and deterministic summary
	// metrics remain the canonical baseline path for any user with
	// ai_mode='off'. The wrapped AISpeedProfileInsights component
	// carrying `ai-feature-speed-profile-insights-root` is absent
	// from the DOM when AI is off — see the off-mode invariant test
	// `TestSpeedProfileInsightsAIOffRendersChartOnly.test.tsx`.
	//
	// Background: zero jobs. The narrative is generated on demand
	// from the user's click on the insights panel — there is no
	// scheduled pre-render. Explicit `[]string{}` so CoverageOK
	// passes.
	//
	// Push kinds: zero — the panel is request/response on demand.
	// Explicit `[]string{}` so CoverageOK passes.
	//
	// NeedsRAG=false (the strategy reads the user's own drive row
	// directly via typed read-only tools; precise route coordinates
	// stay tagged by the PolicySpeedProfileInsights redaction
	// policy). NeedsTools=true. NeedsStream=true.
	"speed-profile-insights": {
		ID:          "speed-profile-insights",
		Name:        "Speed-profile insights",
		Description: "Opt-in LLM-narrated insights about a single drive's speed regime, outliers, and route context. Reads from the existing *models.Drive aggregates via two read-only tools; the deterministic SpeedHistogramChart + summary metrics on /drives/:id remain the canonical baseline when AI is off. Precise route coordinates remain tagged by the per-feature redaction policy; only the vehicle name may be narrated.",
		Tier:        "D",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/drives/{driveID}/speed-profile/insights"},
			Frontend:  []string{"/drives/:id"},
			UITestIDs: []string{"ai-feature-speed-profile-insights-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / D3 (slice 0023) — Route-efficiency suggestions.
	//
	// Backend: POST /api/v1/ai/routes/{routeID}/efficiency/suggest.
	// The AI handler streams SSE frames from the dispatch loop; the
	// two declared tools are retrieve_route_chunks (the F7 RAG
	// retriever scoped to the calling user_subject over the
	// per-feature allowlist {drive_summary, route_efficiency,
	// weather_context}; only drive_summary is wired into the F7
	// indexer today, the other two are reserved by string for the
	// future ai_route_indexer slice) and query_route_efficiency
	// (returns SI-canonical aggregates over the user's top
	// repeat-driven routes for ONE vehicle, mirroring the
	// deterministic /api/v1/analytics/route-efficiency baseline
	// shape via the same drives table — no new SQL). Both are
	// read-only; PolicyRouteEfficiencySuggestions tags every
	// location class (lat/long, street addr, place name) so a
	// leaked transcript reveals only the vehicle name. The route
	// is mounted under guard.Wrap so it returns 404 when
	// ai_mode='off' OR when the per-feature toggle is off.
	//
	// Frontend: the AI suggestions panel attaches to
	// /analytics/route-efficiency — the canonical Route Efficiency
	// page that already renders the deterministic RouteCards,
	// kWh/100mi metric bars, and per-route best/worst summaries.
	// Those baseline panels remain the canonical path for any
	// user with ai_mode='off'. The wrapped
	// AIRouteEfficiencySuggestions component carrying
	// `ai-feature-route-efficiency-suggestions-root` is absent
	// from the DOM when AI is off — see the off-mode invariant
	// test `TestRouteEfficiencySuggestionsAIOffShowsMetricsOnly.test.tsx`.
	//
	// Background: ai_route_indexer is a fail-closed stub that
	// re-checks ai_mode + per-feature toggle on every tick and
	// returns Skipped=1 whenever either gate is off. The future
	// indexer body that will populate the route_efficiency /
	// weather_context corpora replaces the stub body without
	// touching the registry. Mirrors the slice 0021
	// ai_drive_indexer fail-closed pattern.
	//
	// Push kinds: zero — the panel is request/response on demand.
	// Explicit `[]string{}` so CoverageOK passes.
	//
	// NeedsRAG=true because retrieve_route_chunks calls the F7
	// retriever; NeedsTools=true because the strategy invokes two
	// read-only tools; NeedsStream=true because the handler
	// streams SSE frames from the dispatch loop.
	"route-efficiency-suggestions": {
		ID:          "route-efficiency-suggestions",
		Name:        "Route-efficiency suggestions",
		Description: "Opt-in LLM-narrated suggestions for lower-consumption habits and route choices, grounded in the user's repeat-driven routes via the F7 RAG retriever plus a typed read-only route-aggregation tool. The deterministic RouteCards and kWh/100mi metric bars on /analytics/route-efficiency remain the canonical baseline when AI is off; precise route coordinates and street addresses remain tagged by the per-feature redaction policy so only the vehicle name may be narrated.",
		Tier:        "D",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/routes/{routeID}/efficiency/suggest"},
			Frontend:  []string{"/analytics/route-efficiency"},
			UITestIDs: []string{"ai-feature-route-efficiency-suggestions-root"},
			JobNames:  []string{"ai_route_indexer"},
			PushKinds: []string{},
		},
	},
	// Phase-50 / D5 (slice 0025) — Trip planner LLM agent.
	//
	// `trip-planner-llm-agent` adds an opt-in LLM-assisted trip
	// planner alongside the deterministic heuristic trip planner.
	// The heuristic planner served by POST /api/v1/trip-planner/plan
	// and rendered by /trip-planner remains the canonical baseline
	// — opt-in toggle defaults FALSE per ADR-015 §I1 so off-mode
	// users see the manual form + canonical Plan button only.
	//
	// Backend: POST /api/v1/ai/trips/plan/draft mounted from
	// internal/api/ai_routes.go via guard.Wrap("trip-planner-llm-agent",
	// aiTripPlannerLLMHandler.ServeHTTP) so the route returns 404
	// when ai_mode='off' OR when the per-feature toggle is off (the
	// AND of the global mode gate and the per-feature toggle).
	//
	// Tools (all PROPOSE-only / read-only; no DB write tools exist
	// in this slice): `query_chargers_along_route` and
	// `query_user_charge_dwells` read the existing
	// `charging_sessions` table via the shared ChargeSource port
	// satisfied at boot by *database.ChargingRepo (no new SQL);
	// `draft_trip_plan` delegates to the canonical
	// TripPlannerHandler.computePlan path via a narrow
	// TripPlanComputer port satisfied by AITripPlanComputer
	// (wraps *TripPlannerHandler in the same package). The AI tool
	// produces the same SI-canonical envelope
	// (total_distance_m, total_duration_s, total_energy_wh,
	// arrival_soc) the deterministic baseline produces.
	// PolicyTripPlannerLLMAgent tags every location class (lat/long,
	// street addr, place name) so a leaked transcript reveals only
	// the vehicle name.
	//
	// Frontend: the AI agent panel attaches to /trip-planner — the
	// canonical Trip Planner page that already renders the manual
	// form, deterministic plan envelope, and map. The form + Plan
	// button remain the canonical path for any user with
	// ai_mode='off'. The wrapped AITripPlannerLLMAgent component
	// carrying `ai-feature-trip-planner-llm-agent-root` is absent
	// from the DOM when AI is off — see the off-mode invariant test
	// `TestTripPlannerAIOffUsesHeuristicPlanner.test.tsx`.
	//
	// Background: zero jobs — the agent is request/response on
	// demand. Explicit `[]string{}` so CoverageOK passes.
	//
	// Push kinds: zero — the agent streams its proposal via SSE on
	// the same HTTP request, no out-of-band push. Explicit
	// `[]string{}`.
	//
	// NeedsRAG=false because the agent does NOT call the F7
	// retriever today; corridor projection over the user's
	// charging history is a typed query, not an embedding lookup.
	// NeedsTools=true because the strategy invokes three read-only
	// tools; NeedsStream=true because the handler streams SSE
	// frames from the dispatch loop.
	"trip-planner-llm-agent": {
		ID:          "trip-planner-llm-agent",
		Name:        "Trip planner LLM agent",
		Description: "Opt-in LLM-assisted trip planner that proposes a route + charger sequence by projecting the user's past charging history onto the corridor and delegating the actual plan to the canonical TripPlannerHandler.computePlan path. The deterministic heuristic planner at POST /api/v1/trip-planner/plan and the manual /trip-planner form remain the canonical baseline when AI is off; start/end locations and charger place names remain tagged by the per-feature redaction policy so only the vehicle name may be narrated.",
		Tier:        "D",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/trips/plan/draft"},
			Frontend:  []string{"/trip-planner"},
			UITestIDs: []string{"ai-feature-trip-planner-llm-agent-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / C1 (slice 0026) — Smart-charge schedule suggestion.
	//
	// Opt-in LLM agent that proposes a time-of-use-optimized charge
	// schedule by delegating to the canonical
	// *ChargePlannerHandler.computeSchedule path so the proposed
	// envelope is byte-equivalent to the deterministic
	// POST /api/v1/charge-planner/optimize baseline. PROPOSE-only:
	// the LLM has no save tool — the user reviews the proposed
	// schedule in the AI panel and explicitly clicks the existing
	// canonical Schedule button on the SmartChargePage UI to apply
	// it via POST /api/v1/charge-planner/apply (unchanged
	// baseline). Manual charge schedule settings + the heuristic
	// optimizer remain the canonical baseline when AI is off.
	"smart-charge-schedule-suggestion": {
		ID:          "smart-charge-schedule-suggestion",
		Name:        "Smart-charge schedule suggestion",
		Description: "Opt-in LLM agent that proposes a TOU-optimized charge schedule by delegating to the canonical ChargePlannerHandler.computeSchedule path. The manual schedule form, deterministic POST /api/v1/charge-planner/optimize optimizer, and explicit Schedule button on the Smart Charge page remain the canonical baseline when AI is off; the AI never writes a schedule directly. Home/work locations remain tagged by the per-feature redaction policy so only the vehicle name may be narrated.",
		Tier:        "C",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/charging/schedule/draft"},
			Frontend:  []string{"/charging/schedule"},
			UITestIDs: []string{"ai-feature-smart-charge-schedule-suggestion-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / C2 (slice 0027) — Battery health forecast narrative.
	//
	// Opt-in LLM narration that explains the drivers of the
	// deterministic battery-health forecast already rendered on the
	// /battery (BatteryHealthPage) page: current state-of-health,
	// degradation rate, projected 80%-of-original-capacity date,
	// charging-habit ratios (fast-charge fraction, deep-discharge
	// count, high-SOC dwell), and the risk-factor severity table the
	// existing /analytics/battery-degradation handler returns. The
	// strategy is READ-ONLY: it composes the existing
	// *database.SignalLogReader.SignalTrace + ChargeSource.GetByVehicle
	// surfaces through a narrow [BatteryHealthForecaster] port and
	// reuses the existing package-level helpers (synthesizeBatterySnapshots,
	// predictDegradation, computeRiskFactors) so the AI narration is
	// grounded in the SAME deterministic forecast model the chart
	// uses — the slice explicitly does NOT change the forecast model.
	// The narration only translates the typed envelope into a 2-3
	// sentence plain-language explanation of WHY the forecast is what
	// it is and which charging habits contribute to it.
	//
	// The deterministic BatteryHealthPage — hero metric cards, the
	// "Capacity Trend & Prediction" chart, range trend, charge level
	// distribution, insights panel, and recommendations panel —
	// remains the canonical baseline visible to every user. The AI
	// section is an opt-in panel layered ABOVE the hero metrics; it
	// is HIDDEN entirely when ai_mode='off' or the per-feature toggle
	// is off (ADR-015 §I3, §I5, §I6).
	"battery-health-forecast-narrative": {
		ID:          "battery-health-forecast-narrative",
		Name:        "Battery health forecast narrative",
		Description: "Opt-in LLM-narrated explanation of the drivers behind the deterministic battery-health forecast (state-of-health, degradation rate, projected 80% date, charging habit ratios, risk factors). The deterministic Capacity Trend & Prediction chart, hero metric cards, and recommendations panel on the Battery Health page remain the canonical baseline when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript does not reveal the user's location or charging cadence in plain text.",
		Tier:        "C",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/battery/health/narrate"},
			Frontend:  []string{"/battery/health"},
			UITestIDs: []string{"ai-feature-battery-health-forecast-narrative-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / 0028 — C3 Charging-curve fingerprint clustering.
	//
	// Opt-in LLM narrator that NAMES each deterministic
	// charging-curve cluster and EXPLAINS what makes the sessions in
	// it cohere for one vehicle in scope. The statistical clustering
	// mechanics (k-means, fingerprint similarity, etc.) are owned by
	// the ML3 sibling slice — this C3 surface ONLY adds a
	// human-readable narrator over the already-computed buckets.
	//
	// The deterministic ChargingCurvePage charts (SummaryStatsGrid,
	// SessionCurveChart, SessionComparisonChart, ChargerTypeChart,
	// SpeedTrendChart, TimeToChargeSection) and the existing client-
	// side `sessionLabel` heuristic in
	// web/src/features/charging/components/charging-curve/helpers.ts
	// remain the canonical baseline visible to every user. The AI
	// section is a panel rendered ABOVE the deterministic tabs; it
	// is HIDDEN entirely when ai_mode='off' or the per-feature
	// toggle is off (ADR-015 §I3, §I5, §I6).
	//
	// Tools: retrieve_charge_curve_chunks (F7 RAG retrieval over the
	// per-feature source-type allowlist {charge_curve, charge_session})
	// + query_charge_curve_features (deterministic per-cluster
	// envelope derived in-memory from the user's existing
	// charging_sessions rows; no new SQL).
	//
	// JobNames: ["ai_charge_curve_indexer"] — gated indexer stub
	// registered for forward-compat. Skipped (Skipped=1) whenever
	// ai_mode='off' or charging-curve-fingerprint-clustering is off,
	// matching the F7/I12 contract.
	//
	// PushKinds: explicitly empty (no notification/push channel
	// surface). features.CoverageOK rejects nil; the empty slice is
	// the affirmative "no surface" signal.
	"charging-curve-fingerprint-clustering": {
		ID:          "charging-curve-fingerprint-clustering",
		Name:        "Charging-curve fingerprint clustering",
		Description: "Opt-in LLM narrator that names and explains the deterministic charging-curve fingerprint clusters for one vehicle. The deterministic charging-curve charts and per-session labels on the Charging Curves page remain the canonical baseline when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript does not reveal the user's home charger address or the supercharger network they frequent.",
		Tier:        "C",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/charging/curves/clusters/explain"},
			Frontend:  []string{"/charging/curves"},
			UITestIDs: []string{"ai-feature-charging-curve-fingerprint-clustering-root"},
			JobNames:  []string{"ai_charge_curve_indexer"},
			PushKinds: []string{},
		},
	},
	// Phase-50 / 0029 — C4 Cost forecast narration.
	//
	// Opt-in LLM narrator that EXPLAINS the deterministic cost
	// forecast on the Cost Analysis page — historical monthly cost
	// totals, the next-N-month linear-regression projection with
	// seasonal adjustment and an approximate 95% prediction interval,
	// the home-vs-supercharger split, the gas-comparison savings
	// numbers, and the deterministic insights the existing handler
	// already emits. The AI surface narrates assumptions and
	// uncertainty in plain language; it never invents numbers and
	// never persists state.
	//
	// The deterministic CostAnalysisPage (CostForecastSection,
	// CostBreakdownSection, GasComparisonSection, plus the existing
	// insights chips) and the existing `useCostForecast` hook remain
	// the canonical baseline visible to every user. The AI section is
	// a panel rendered ABOVE the deterministic forecast; it is HIDDEN
	// entirely when ai_mode='off' or the per-feature toggle is off
	// (ADR-015 §I3, §I5, §I6).
	//
	// Tools: query_cost_forecast — a deterministic typed envelope
	// derived from the SAME ComputeCostForecast helper that the
	// canonical baseline GET /analytics/cost-forecast handler uses;
	// the AI narration is therefore grounded in the same numbers the
	// chart renders, never a parallel re-implementation.
	//
	// NeedsRAG: false — the slice prompt lists only the single typed
	// tool, so the F7 retrieval entry point is intentionally not
	// invoked.
	//
	// JobNames / PushKinds: explicitly empty (no background job, no
	// notification/push channel surface). features.CoverageOK rejects
	// nil; the empty slice is the affirmative "no surface" signal.
	"cost-forecast-narration": {
		ID:          "cost-forecast-narration",
		Name:        "Cost forecast narration",
		Description: "Opt-in LLM narrator that explains the deterministic cost forecast on the Cost Analysis page — historical monthly totals, the linear-regression projection with seasonal adjustment and approximate 95% prediction interval, the home-vs-supercharger split, gas-comparison savings, and the deterministic insights — with explicit assumptions and uncertainty. The deterministic cost-forecast chart and breakdown panels remain the canonical baseline when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript reveals neither the user's home charger address nor the supercharger sites they regularly use.",
		Tier:        "C",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/charging/costs/forecast/narrate"},
			Frontend:  []string{"/charging/costs"},
			UITestIDs: []string{"ai-feature-cost-forecast-narration-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / 0030 — C5 Vampire-drain explanation.
	//
	// Opt-in LLM narrator that EXPLAINS the deterministic vampire-drain
	// (idle-energy-loss) signal already surfaced on the Vampire Drain
	// page — total observed parked hours, average / median / p95 drain
	// rate (% / day), the recent worst event, and the most relevant
	// per-event driver (Sentry on, ambient temperature, very long
	// parked window). The AI surface narrates the drivers and offers
	// honest, non-mutating tips grounded in the user's own data; it
	// never invents events, never persists state, and never modifies
	// the deterministic VampireDrainStats / VampireDrainEvent
	// envelopes the chart and table render.
	//
	// The deterministic VampireDrainPage (summary metrics, drain-rate
	// trend chart, daily-drain bar chart, drain-sessions table, tips
	// panel) and the existing GET /vampire-drain + GET
	// /vampire-drain/stats handlers remain the canonical baseline
	// visible to every user. The AI section is a panel rendered ABOVE
	// the deterministic content; it is HIDDEN entirely when
	// ai_mode='off' or the per-feature toggle is off (ADR-015 §I3,
	// §I5, §I6).
	//
	// Tools:
	//   - retrieve_idle_drain_chunks — F7 RAG retrieval over the
	//     per-feature source-type allowlist {idle_drain, vehicle_state,
	//     climate_state}. None of the three is wired into the F7
	//     indexer today (slice 0008 only indexes drive_summary +
	//     charge_session); they are reserved by string for forward-
	//     compatibility — the gated `ai_idle_drain_indexer` job
	//     (registered as JobNames=["ai_idle_drain_indexer"] below)
	//     will fan out into the idle-drain corpus once a future slice
	//     wires the per-event embeddings. Until then the retriever
	//     simply returns zero chunks for these source types — which
	//     is the correct behaviour: the strategy's goldens already
	//     cover the zero-matches narration.
	//   - query_vampire_drain_windows — a deterministic typed
	//     envelope derived from the SAME *database.VampireDrainRepo
	//     that backs the canonical baseline GET /vampire-drain +
	//     GET /vampire-drain/stats handlers; the AI narration is
	//     therefore grounded in the same numbers the chart renders,
	//     never a parallel re-implementation. No new SQL is added by
	//     this slice.
	//
	// JobNames: ["ai_idle_drain_indexer"] — gated indexer stub
	// registered for forward-compat. Skipped (Skipped=1) whenever
	// ai_mode='off' or vampire-drain-explanation is off, matching
	// the F7 / I12 contract.
	//
	// PushKinds: explicitly empty (no notification/push channel
	// surface). features.CoverageOK rejects nil; the empty slice is
	// the affirmative "no surface" signal.
	"vampire-drain-explanation": {
		ID:          "vampire-drain-explanation",
		Name:        "Vampire-drain explanation",
		Description: "Opt-in LLM narrator that explains the deterministic vampire-drain (idle-energy-loss) signal — total observed parked hours, average / median / p95 drain rate per day, the recent worst event, and the most relevant per-event driver (Sentry on, ambient temperature, very long parked window) — grounded in the same numeric envelope the Vampire Drain page already renders. The AI surface narrates drivers and offers honest, non-mutating tips; it never invents events. The deterministic Vampire Drain summary cards, drain-rate trend chart, daily-drain bar chart, drain-sessions table, and tips panel remain the canonical baseline when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript reveals neither the user's home charger address nor the locations they regularly park.",
		Tier:        "C",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/charging/vampire-drain/explain"},
			Frontend:  []string{"/charging/vampire-drain"},
			UITestIDs: []string{"ai-feature-vampire-drain-explanation-root"},
			JobNames:  []string{"ai_idle_drain_indexer"},
			PushKinds: []string{},
		},
	},
	// Phase-50 / T1 (slice 0031) — Preheat and precool recommender.
	//
	// preheat-precool-recommender is the first T-tier (Tools-rich) AI
	// surface: it proposes a preheat or precool schedule grounded in
	// the user's typical departure history and the current outside
	// temperature, then asks the user to CONFIRM before any schedule
	// is created. The actual schedule persistence remains an explicit
	// user click on the existing manual climate controls baseline; the
	// AI panel never writes a schedule directly. This matches the
	// slice prompt's verbatim mandate: "Suggest preheat or precool
	// schedules while requiring confirmation before creating any
	// schedule."
	//
	// The deterministic ClimateControlPage (HVAC banner, climate
	// status cards, climate efficiency panel, climate history table,
	// seat-heater controls, and the manual departure-time heuristic
	// that lives entirely on the SPA today) and the existing
	// GET /api/v1/climate/latest + GET /api/v1/vehicles/{id}/state
	// handlers remain the canonical baseline visible to every user.
	// The AI section is a panel rendered ABOVE the deterministic
	// content; it is HIDDEN entirely when ai_mode='off' or the
	// per-feature toggle is off (ADR-015 §I3, §I5, §I6).
	//
	// Tools (PROPOSE-only — both):
	//   - draft_climate_schedule — drafts a preheat/precool window
	//     by combining the typical departure timestamp the caller
	//     supplies (read off the canonical departure-history typed
	//     hook on the SPA, NOT a parallel SQL path) with the
	//     vehicle's current cabin & outside temperatures. Returns a
	//     typed envelope {start_time, end_time, mode (preheat |
	//     precool), target_cabin_temp_c, current_cabin_temp_c,
	//     outside_temp_c, depart_by, vehicle_id}. PROPOSE-only:
	//     the structured envelope is rendered in the AI panel; the
	//     user reviews and clicks the existing canonical climate
	//     controls UI to save / apply.
	//   - validate_climate_schedule — pure-Go sanity check on the
	//     drafted envelope: start_time < end_time, end_time <=
	//     depart_by, target_cabin_temp_c is in a safe range, mode
	//     matches the temperature delta. Returns {status: ok |
	//     invalid, validation_error}. The LLM calls this AFTER
	//     draft_climate_schedule so the narration only quotes a
	//     window the drafter returned AND that passes the post-hoc
	//     consistency check.
	//
	// Source-types (per-feature retrieval allowlist; the slice
	// prompt mandates {climate_state, departure_history,
	// weather_context}). None of the three is wired into the F7
	// indexer today (slice 0008 only indexes drive_summary +
	// charge_session); they are reserved by string for forward-
	// compatibility — the per-feature retrieval entry point hands
	// them to the canonical rag.Retriever and gets zero chunks
	// today. Until then the goldens cover the zero-matches narration.
	// NeedsRAG is therefore true so the boot wiring instantiates the
	// per-feature retriever (rate-limit + cost-cap decorators apply
	// per-strategy).
	//
	// JobNames: explicitly empty (no background indexer is registered
	// for this slice; the future per-event embedding job is reserved
	// by string in the strategy/tools docs but not registered as a
	// dispatcher job entry — features.CoverageOK rejects nil; the
	// empty slice is the affirmative "no surface" signal).
	//
	// PushKinds: explicitly empty (no notification/push channel
	// surface). features.CoverageOK rejects nil; the empty slice is
	// the affirmative "no surface" signal.
	"preheat-precool-recommender": {
		ID:          "preheat-precool-recommender",
		Name:        "Preheat and precool recommender",
		Description: "Opt-in LLM agent that proposes a preheat or precool window — start_time, end_time, target cabin temperature, mode (preheat | precool) — by combining the user's typical departure timestamp with the vehicle's current cabin and outside temperatures. The proposal is structured and PROPOSE-only: the user reviews the typed draft in the AI panel and clicks the existing canonical climate-controls UI to apply it; the AI never creates a schedule directly. The deterministic Climate Control page (HVAC banner, status cards, efficiency panel, history table, seat-heater controls, manual departure-time heuristic) remains the canonical baseline when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript reveals neither the user's home address nor the workplaces they typically depart from.",
		Tier:        "T",
		DefaultOn:   false,
		NeedsRAG:    true,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/climate/schedule/draft"},
			Frontend:  []string{"/climate"},
			UITestIDs: []string{"ai-feature-preheat-precool-recommender-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / 0032 (T2) — Cabin temperature impact narrative.
	//
	// `cabin-temperature-impact-narrative` is an opt-in LLM narrator
	// that explains HOW outside ambient temperature affects driving
	// efficiency and range for the in-scope vehicle. The narration is
	// strictly grounded in the SAME deterministic temperature-impact
	// aggregates that the existing GET
	// /api/v1/analytics/temperature-impact handler already exposes —
	// the AI surface adds prose explanation, not new aggregation.
	//
	// Backend: POST /api/v1/ai/climate/temperature-impact/narrate is the
	// single AI route for this slice. It is mounted under guard.Wrap
	// so it returns 404 when ai_mode='off' OR the per-feature toggle
	// is off (ADR-015 §I6 + §I7).
	//
	// Frontend: /analytics/temperature-impact is the registry's logical
	// path for the temperature-impact analytics page. The actual SPA
	// route is mounted at /temperature-impact in App.tsx (mirrors how
	// route-efficiency-suggestions is registered as /analytics/route-
	// efficiency while App.tsx mounts /route-efficiency); the registry
	// stores the canonical analytics-area path for documentation +
	// off-mode walker semantics.
	//
	// UI test ID: ai-feature-cabin-temperature-impact-narrative-root is
	// the data-testid the withAiFeature HOC stamps on the gated
	// wrapper. Off-mode tests assert it is absent; on-mode tests
	// assert it is present + receives the first SSE delta.
	//
	// NeedsRAG: false — the narrator has a single read-only tool
	// (query_temperature_impact) that returns a deterministic
	// envelope; there is no per-event embedding retrieval.
	//
	// NeedsTools: true — the narrator MUST call query_temperature_impact
	// before narrating (system prompt enforces tool-first behaviour).
	//
	// NeedsStream: true — the response is SSE-streamed via the shared
	// stream.Writer so the SPA can render delta tokens live.
	//
	// JobNames: explicitly empty (no background job is registered for
	// this slice). features.CoverageOK rejects nil; the empty slice is
	// the affirmative "no surface" signal.
	//
	// PushKinds: explicitly empty (no notification/push channel
	// surface). features.CoverageOK rejects nil; the empty slice is
	// the affirmative "no surface" signal.
	"cabin-temperature-impact-narrative": {
		ID:          "cabin-temperature-impact-narrative",
		Name:        "Cabin temperature impact narrative",
		Description: "Opt-in LLM narrator that explains how outside ambient temperature affects the in-scope vehicle's driving efficiency and range, grounded strictly in the same deterministic bucketed-efficiency + monthly seasonal-trend aggregates the existing /temperature-impact analytics page already renders. The narration may quote bucket labels, the avg_battery_pct_per_100km of the best and worst bucket, the rolling 12-month avg_temp_c paired with avg_efficiency, and the deterministic insights the tool returns; it never invents alternate bucket boundaries, never reclassifies the best/worst bucket, and explicitly surfaces the descriptive-aggregate (NOT forecast / regression) nature of the surface. The deterministic temperature-impact charts (scatter, bucket bars, optimal-range panel, seasonal trend, tips) remain the canonical baseline when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript reveals neither the user's typical route start/end nor the schedule the recent-drives sample might surface.",
		Tier:        "T",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/climate/temperature-impact/narrate"},
			Frontend:  []string{"/analytics/temperature-impact"},
			UITestIDs: []string{"ai-feature-cabin-temperature-impact-narrative-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / 0033 (T3) — Tire pressure trend reasoning.
	//
	// `tire-pressure-trend-reasoning` is an opt-in LLM narrator
	// that explains the recent trend in this vehicle's four corner
	// tire pressures (front-left, front-right, rear-left,
	// rear-right) plus their seasonality and the most likely
	// driver of any deviation from the deterministic
	// thresholds the canonical /tire-pressure page already
	// renders. The narration is strictly grounded in the SAME
	// signal_log change feed (TpmsPressure* signals plus
	// OutsideTemp) the existing GET /api/v1/tire-pressure +
	// /api/v1/tire-pressure/latest handlers expose — the AI
	// surface adds prose explanation, not new aggregation, and
	// never modifies the deterministic thresholds.
	//
	// Backend: POST /api/v1/ai/tire-pressure/trends/explain is the
	// single AI route for this slice. It is mounted under guard.Wrap
	// so it returns 404 when ai_mode='off' OR the per-feature toggle
	// is off (ADR-015 §I6 + §I7).
	//
	// Frontend: /vehicle-systems/tires is the registry's logical
	// path for the tire-pressure analytics page. The actual SPA
	// route is mounted at /tire-pressure in App.tsx (mirrors how
	// cabin-temperature-impact-narrative is registered as
	// /analytics/temperature-impact while App.tsx mounts
	// /temperature-impact); the registry stores the canonical
	// vehicle-systems-area path for documentation + off-mode
	// walker semantics.
	//
	// UI test ID: ai-feature-tire-pressure-trend-reasoning-root is
	// the data-testid the withAiFeature HOC stamps on the gated
	// wrapper. Off-mode tests assert it is absent; on-mode tests
	// assert it is present + receives the first SSE delta.
	//
	// NeedsRAG: false — the narrator has a single read-only tool
	// (query_tire_pressure_trend) that returns a deterministic
	// envelope from the signal_log change feed; there is no
	// per-event embedding retrieval. The slice prompt's
	// "source types: tire_pressure;climate_state" describes the
	// data domains the tool reads from (TpmsPressure* and
	// OutsideTemp signals via signal.StateReader.Timeline), NOT
	// an embeddings-backed retrieval surface — F7 is not invoked.
	//
	// NeedsTools: true — the narrator MUST call
	// query_tire_pressure_trend before narrating (system prompt
	// enforces tool-first behaviour).
	//
	// NeedsStream: true — the response is SSE-streamed via the
	// shared stream.Writer so the SPA can render delta tokens live.
	//
	// JobNames: explicitly empty (no background job is registered
	// for this slice). features.CoverageOK rejects nil; the empty
	// slice is the affirmative "no surface" signal.
	//
	// PushKinds: explicitly empty (no notification/push channel
	// surface). features.CoverageOK rejects nil; the empty slice
	// is the affirmative "no surface" signal.
	"tire-pressure-trend-reasoning": {
		ID:          "tire-pressure-trend-reasoning",
		Name:        "Tire pressure trend reasoning",
		Description: "Opt-in LLM narrator that explains the recent 30-day trend in this vehicle's four corner tire pressures (front-left, front-right, rear-left, rear-right), the seasonality the change feed shows when paired with the same outside ambient temperature signal, and the most likely driver of any deviation from the deterministic soft-low / normal-min / normal-max / soft-high thresholds the canonical Tire Pressure page already shows. The narration may quote the per-tire latest, average, min, max, and rate-of-change-per-day, the soft and normal threshold band edges, the deterministic likely-cause hints the tool returns (cold-weather correlation, slow-leak signature, all-tires-trending suggesting weather rather than puncture), and the deterministic insights the tool returns; it never invents alternate thresholds, never reclassifies a tire as critical when the deterministic helper says low, and explicitly surfaces that the rate-of-change projection is a descriptive linear extrapolation rather than a predictive model. The deterministic Tire Pressure page (4-tire radial gauges, soft/hard warning banner, summary metric cards, pressure history chart, history table) remains the canonical baseline when AI is off. Per-feature redaction policy keeps every PII class except the vehicle name tagged so a leaked transcript reveals neither the user's typical commute corridor nor the place names where a pressure event occurred.",
		Tier:        "T",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/tire-pressure/trends/explain"},
			Frontend:  []string{"/vehicle-systems/tires"},
			UITestIDs: []string{"ai-feature-tire-pressure-trend-reasoning-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / 0034 (A1) — Alert tuning suggestions.
	//
	// `alert-tuning-suggestions` is an opt-in LLM that proposes a
	// lower-noise typed AlertRule patch for an EXISTING rule based
	// on the rule's recent firing history, then asks the user to
	// review the patch in the AlertStudio UI and click Save. The
	// strategy is PROPOSE-ONLY: it never writes to the database
	// itself; the actual save flows through the existing typed
	// PUT /api/v1/alerts/rules/{id} handler that the deterministic
	// AlertStudio form already uses. The deterministic Alert
	// Studio (manual threshold tuning + the existing alert
	// analytics dashboard) remains the canonical baseline when AI
	// is off (ADR-015 §I3).
	//
	// Backend: POST /api/v1/ai/alerts/rules/{ruleID}/tune/draft is
	// the single AI route for this slice. ruleID is taken from the
	// URL path; the AI handler clamps the LLM's tool calls to
	// that scope so a "tune rule 999 instead" prompt cannot
	// cross-rule the proposal. The route is mounted under
	// guard.Wrap so it returns 404 when ai_mode='off' OR the
	// per-feature toggle is off (ADR-015 §I6 + §I7).
	//
	// Frontend: /alerts/studio is the canonical AlertStudio page.
	// The AI side panel is rendered next to the editor via
	// withAiFeature('alert-tuning-suggestions', ...) so it is
	// completely absent from the DOM when the toggle is off
	// (ADR-015 §I5).
	//
	// UI test ID: ai-feature-alert-tuning-suggestions-root is the
	// data-testid the withAiFeature HOC stamps on the gated
	// wrapper. Off-mode tests assert it is absent; on-mode tests
	// assert it is present + receives the first SSE delta.
	//
	// NeedsRAG: false — the assistant has two propose-only tools
	// (draft_alert_rule_patch reads the existing rule + replays
	// the recent notification_logs firing window;
	// validate_alert_rule runs the canonical AlertRule validator
	// over the merged shape). The slice prompt's "source types:
	// alert_history;alert_rule" describes the data domains the
	// tools read from (alert_rules + notification_logs), NOT an
	// embeddings-backed retrieval surface — F7 is not invoked.
	//
	// NeedsTools: true — the assistant MUST call
	// draft_alert_rule_patch FIRST and validate_alert_rule on the
	// merged proposal (system prompt enforces the tool sequence).
	//
	// NeedsStream: true — the response is SSE-streamed via the
	// shared stream.Writer so the SPA can render delta tokens
	// live and surface the typed proposal envelope as soon as the
	// tool_result arrives.
	//
	// JobNames: explicitly empty (no background job is registered
	// for this slice). features.CoverageOK rejects nil; the empty
	// slice is the affirmative "no surface" signal.
	//
	// PushKinds: explicitly empty (no notification/push channel
	// surface). features.CoverageOK rejects nil; the empty slice
	// is the affirmative "no surface" signal.
	"alert-tuning-suggestions": {
		ID:          "alert-tuning-suggestions",
		Name:        "Alert tuning suggestions",
		Description: "Opt-in LLM that proposes a lower-noise typed AlertRule patch for an existing rule based on the rule's recent firing history (sourced from notification_logs). The assistant calls draft_alert_rule_patch to compute a descriptive replay of the recent firing window through the proposed threshold + cooldown, then validate_alert_rule to confirm the merged proposal is byte-equivalent to a draft accepted by the canonical PUT /api/v1/alerts/rules/{id} handler. The narration explicitly surfaces that the projected post-patch firing count is a DESCRIPTIVE estimate from the recent firing window — NOT a forecast — and refuses to propose suspending, disabling, deleting, or loosening severity. The user reviews the typed patch in the Alert Studio UI and clicks Save to apply. The deterministic Alert Studio (manual threshold tuning + the existing alert analytics dashboard) remains the canonical baseline when AI is off. Per-feature redaction policy denies every PII class — alert IDs, signal names, and thresholds flow through the typed F4 tool envelope, not through prompt prose.",
		Tier:        "A",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/alerts/rules/{ruleID}/tune/draft"},
			Frontend:  []string{"/alerts/studio"},
			UITestIDs: []string{"ai-feature-alert-tuning-suggestions-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / 0035 (A2) — Inbox auto-categorization.
	//
	// `inbox-auto-categorization` is an opt-in LLM that reads the
	// recent notification_logs window for the user's current inbox
	// filter (vehicle scope, severity scope, time window) and
	// proposes a small, ordered set of categorical labels (drawn
	// from a closed taxonomy: battery, charging, climate, tire,
	// security, connectivity, maintenance, noise, other) that
	// describe the dominant noise sources. The user reviews the
	// proposal in the inbox UI and clicks "Apply as filter" to
	// copy the suggested rule_id set into the existing baseline
	// inbox filter — the AI never writes to notification_logs,
	// never assigns labels to rows, never bypasses the canonical
	// /api/v1/alerts/notifications inbox listing handler (ADR-015
	// §I3). The deterministic NotificationFilterBar +
	// user-driven category filters remain the canonical baseline
	// when AI is off.
	//
	// Backend: POST /api/v1/ai/alerts/inbox/categorize is the
	// single AI route for this slice. The body carries the
	// optional vehicle_id / severity / window_days filter so the
	// tool's deterministic counter scopes to the same row set the
	// SPA's filter bar would have produced. The route is mounted
	// under guard.Wrap so it returns 404 when ai_mode='off' OR
	// the per-feature toggle is off (ADR-015 §I6 + §I7).
	//
	// Frontend: /alerts/inbox is the canonical inbox host route
	// in the registry metadata; the page actually mounts at
	// /notifications/inbox (the legacy /alerts/inbox path is a
	// no-op redirect) — same convention slice 0034 uses for
	// /alerts/studio vs /notifications/studio. The AI side panel
	// is rendered above the filter bar via
	// withAiFeature('inbox-auto-categorization', ...) so it is
	// completely absent from the DOM when the toggle is off
	// (ADR-015 §I5).
	//
	// UI test ID: ai-feature-inbox-auto-categorization-root is
	// the data-testid the withAiFeature HOC stamps on the gated
	// wrapper. Off-mode tests assert it is absent; on-mode tests
	// assert it is present + receives the first SSE delta.
	//
	// NeedsRAG: false — the assistant has two propose-only tools
	// (draft_alert_categories aggregates notification_logs by a
	// deterministic signal_name → category mapping;
	// validate_alert_category asserts every proposed label is in
	// the closed taxonomy). The slice prompt's "source types:
	// alert_history;alert_payload" describes the data domains the
	// tools read from (notification_logs + alert_rules), NOT an
	// embeddings-backed retrieval surface — F7 is not invoked.
	//
	// NeedsTools: true — the assistant MUST call
	// draft_alert_categories FIRST and validate_alert_category on
	// each proposed label (system prompt enforces the tool
	// sequence).
	//
	// NeedsStream: true — the response is SSE-streamed via the
	// shared stream.Writer so the SPA can render delta tokens
	// live and surface the typed proposal envelope as soon as the
	// tool_result arrives.
	//
	// JobNames: ai_alert_inbox_categorizer is declared in the
	// slice prompt's Off-mode contract impact section as a
	// FUTURE optional background categorizer. This slice does
	// NOT register the job (no runtime registration). The
	// metadata is recorded so a future slice that adds the job
	// satisfies CoverageOK without a registry edit. The off-mode
	// invariant remains intact: the dispatcher would refuse to
	// run the job when ai_mode='off'.
	//
	// PushKinds: ai_alert_category_suggested is declared in the
	// slice prompt's Off-mode contract impact section as a
	// FUTURE optional push kind. This slice does NOT register
	// the kind in the push fan-out worker. The metadata is
	// recorded so a future slice that adds the push satisfies
	// CoverageOK without a registry edit.
	"inbox-auto-categorization": {
		ID:          "inbox-auto-categorization",
		Name:        "Inbox auto-categorization",
		Description: "Opt-in LLM that reads the recent notification_logs window for the user's current inbox filter and proposes a small ordered set of categorical labels (drawn from a closed taxonomy: battery, charging, climate, tire, security, connectivity, maintenance, noise, other) describing the dominant noise sources. The assistant calls draft_alert_categories to compute a descriptive count of how many recent notifications fall into each category — based on a deterministic signal_name → category mapping over the same notification_logs rows the SPA inbox already renders — then validate_alert_category to assert every proposed label is in the closed taxonomy. The narration explicitly surfaces that the counts are DESCRIPTIVE over the recent window — NOT a forecast — and refuses to invent categories outside the taxonomy or to comment on inbox rows the user is not currently viewing. The user reviews the typed proposal in the Inbox UI and clicks 'Apply as filter' to copy the suggested rule_ids into the canonical inbox filter — the AI never writes to notification_logs, never assigns labels to rows, never bypasses the canonical /api/v1/notifications inbox listing handler. The deterministic NotificationFilterBar + user-driven filters remain the canonical baseline when AI is off. Per-feature redaction policy denies every PII class — alert IDs, signal names, and notification text flow through the typed F4 tool envelope, not through prompt prose.",
		Tier:        "A",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/alerts/inbox/categorize"},
			Frontend:  []string{"/alerts/inbox"},
			UITestIDs: []string{"ai-feature-inbox-auto-categorization-root"},
			JobNames:  []string{"ai_alert_inbox_categorizer"},
			PushKinds: []string{"ai_alert_category_suggested"},
		},
	},
	// Phase-50 / 0036 — A3 Cross-rule conflict detection.
	//
	// `cross-rule-conflict-detection` is the LLM-backed assistant
	// at POST /api/v1/ai/alerts/rules/conflicts that READS the
	// caller's alert_rules definitions and surfaces structural
	// conflicts (rule-pair definitions that overlap or are
	// byte-identical) so the user can review them via the
	// existing baseline AlertStudio editor. The assistant calls
	// query_alert_rules FIRST to fetch the typed rule envelope
	// for the in-scope set, then detect_rule_conflicts on the
	// SAME set so the conflict report is byte-equivalent to the
	// deterministic structural detector that lives in
	// internal/ai/tools/cross_rule_conflict.go's DetectRuleConflicts.
	// The user reviews the typed envelope inline and clicks
	// "Review rule" on each conflict to navigate to the offending
	// rule in the canonical AlertStudio sidebar list — the AI
	// never edits, merges, deletes, or auto-disables any rule;
	// the existing baseline PUT /api/v1/alerts/rules/{id}
	// + validateAlertRule path remains the canonical write
	// surface (ADR-015 §I3).
	//
	// Backend: POST /api/v1/ai/alerts/rules/conflicts is the
	// single AI route for this slice. The body carries the
	// optional vehicle_id / signal_name / rule_ids /
	// enabled_only / limit filter so the tool's deterministic
	// detector scopes to the same rule set the SPA's AlertStudio
	// rule list would have produced. The route is mounted under
	// guard.Wrap so it returns 404 when ai_mode='off' OR the
	// per-feature toggle is off (ADR-015 §I6 + §I7).
	//
	// Frontend: /alerts/studio is the canonical AlertStudio host
	// route in the registry metadata; the page actually mounts
	// at /notifications/studio (the legacy /alerts/studio path
	// is a no-op redirect) — same convention slice 0034 +
	// 0035 use. The AI conflict panel is rendered above the
	// rule editor via withAiFeature('cross-rule-conflict-
	// detection', ...) so it is completely absent from the DOM
	// when the toggle is off (ADR-015 §I5).
	//
	// UI test ID: ai-feature-cross-rule-conflict-detection-root
	// is the data-testid the withAiFeature HOC stamps on the
	// gated wrapper. Off-mode tests assert it is absent; on-
	// mode tests assert it is present + receives the first SSE
	// delta.
	//
	// NeedsRAG: false — the assistant has two propose-only tools
	// (query_alert_rules reads alert_rules via the
	// CrossRuleConflictSource port; detect_rule_conflicts runs
	// the pure-functional structural conflict detector over the
	// same rule set). The slice prompt's "source types:
	// alert_rule;automation_rule" describes the data domains the
	// tools read from (alert_rules), NOT an embeddings-backed
	// retrieval surface — F7 is not invoked for A3.
	//
	// NeedsTools: true — the assistant MUST call query_alert_rules
	// FIRST and detect_rule_conflicts SECOND on the same rule
	// set (system prompt enforces the tool sequence).
	//
	// NeedsStream: true — the response is SSE-streamed via the
	// shared stream.Writer so the SPA can render delta tokens
	// live and surface the typed conflict envelope as soon as
	// the tool_result arrives.
	//
	// JobNames + PushKinds: explicitly empty arrays. This slice
	// adds NO background job (the detector is per-request, not
	// scheduled) and NO push notification (the conflict surface
	// is a passive in-page panel; the user reviews it via the
	// SPA, not via push).
	//
	// Service worker chunks: ai-cross-rule-conflict-detection
	// is the dynamic-import name the SPA's lazy loader uses for
	// the AICrossRuleConflictDetection component. Documented in
	// the slice prompt's Off-mode contract impact section so the
	// W1 wired-or-absent invariant has a known chunk name to
	// audit against.
	"cross-rule-conflict-detection": {
		ID:          "cross-rule-conflict-detection",
		Name:        "Cross-rule conflict detection",
		Description: "Opt-in LLM that reads the caller's alert_rules definitions and surfaces structural conflicts (rule-pair definitions that overlap or are byte-identical) so the user can review them via the existing baseline AlertStudio editor. The assistant calls query_alert_rules FIRST to fetch the typed rule envelope for the in-scope set, then detect_rule_conflicts on the SAME set so the conflict report is byte-equivalent to the deterministic structural detector. Conflict kinds are drawn from a closed taxonomy: redundant_duplicate (byte-identical predicate + same vehicle scope) and overlapping_threshold (same signal_name, overlapping vehicle scope, predicate intervals overlap). Severity / cooldown / trigger-mode mismatches surface as METADATA flags on a conflict, NOT as standalone conflict kinds. The narration explicitly surfaces that the report is a STRUCTURAL OVERLAP ANALYSIS of the current rule definitions — NOT a runtime firing prediction or a claim that one rule shadows another — and refuses to invent conflict kinds outside the closed taxonomy. The user reviews the typed envelope inline and clicks 'Review rule' on each conflict to navigate to the offending rule in the canonical AlertStudio sidebar list — the AI never edits, merges, deletes, or auto-disables any rule; the existing baseline PUT /api/v1/alerts/rules/{id} + validateAlertRule path remains the canonical write surface. Per-feature redaction policy denies every PII class — alert IDs, signal names, and notification text flow through the typed F4 tool envelope, not through prompt prose.",
		Tier:        "A",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  true,
		NeedsStream: true,
		Routes: RouteSet{
			Backend:   []string{"POST /api/v1/ai/alerts/rules/conflicts"},
			Frontend:  []string{"/alerts/studio"},
			UITestIDs: []string{"ai-feature-cross-rule-conflict-detection-root"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
	// Phase-50 / F8 (slice 0009) — Redaction Bypass Report meta-feature.
	//
	// `__redaction_bypass__` follows the same SPECIAL-CASE pattern as
	// `__usage__`: it has no per-feature toggle of its own, only a
	// cross-tenant operator visualisation that an admin consumes to
	// verify the deny-by-default redaction stance held. The
	// internal/api/ai_admin_handler.go layer wraps guard.Settings so
	// AIFeatureEnabled("__redaction_bypass__") returns true whenever
	// ai_mode != 'off', mirroring `__usage__`.
	//
	// The Backend route MUST stay in lockstep with mountAIAdminRoutes
	// in internal/api/router.go so tools/aivet's coverage check passes.
	"__redaction_bypass__": {
		ID:          "__redaction_bypass__",
		Name:        "AI Redaction Bypass Report",
		Description: "Per-(feature, provider) bypass summary from F8 redact decorator. Gates on ai_mode != 'off' only.",
		Tier:        "F",
		DefaultOn:   false,
		NeedsRAG:    false,
		NeedsTools:  false,
		NeedsStream: false,
		Routes: RouteSet{
			Backend: []string{
				"GET /api/v1/ai/admin/redaction-bypass",
			},
			Frontend:  []string{},
			UITestIDs: []string{"ai-feature-redaction-bypass"},
			JobNames:  []string{},
			PushKinds: []string{},
		},
	},
}

// IsKnown reports whether id corresponds to a registered feature. Used
// by guard.Wrap to fail fast on a typo at boot rather than at the
// first request.
func IsKnown(id string) bool {
	_, ok := Registry[id]
	return ok
}

// Get returns the registered feature for id and a boolean ok flag.
// Callers that need the metadata should prefer this over
// `Registry[id]` to keep the public API stable if the underlying
// container ever changes.
func Get(id string) (Feature, bool) {
	f, ok := Registry[id]
	return f, ok
}

// IDs returns every registered feature ID in deterministic
// (lexicographic) order. The TS generator uses this to emit a stable
// AiFeatureId union; the final gate uses it to walk every feature.
func IDs() []string {
	out := make([]string, 0, len(Registry))
	for id := range Registry {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// CoverageOK fails if any registered feature has a nil RouteSet
// surface field. Empty arrays are allowed (signaling "this feature
// has no surface of this kind"); nil is not, because the final-gate
// off-mode walker cannot enumerate a missing field.
//
// The map-key invariant (key == entry.ID) is validated here too, so
// a typo in the literal cannot silently shadow a registered ID.
//
// DefaultOn MUST be false for every entry (ADR-015 §I7) — a future
// PR that flips this is rejected here at CI.
func CoverageOK() error {
	for key, f := range Registry {
		if key != f.ID {
			return fmt.Errorf("feature registry: map key %q does not match entry ID %q", key, f.ID)
		}
		if f.ID == "" {
			return fmt.Errorf("feature registry: entry under key %q has empty ID", key)
		}
		if f.Name == "" {
			return fmt.Errorf("feature %q has empty Name", f.ID)
		}
		if f.Tier == "" {
			return fmt.Errorf("feature %q has empty Tier", f.ID)
		}
		if f.DefaultOn {
			return fmt.Errorf("feature %q has DefaultOn=true; ADR-015 §I7 forbids any AI feature defaulting on", f.ID)
		}
		if f.Routes.Backend == nil {
			return fmt.Errorf("feature %q has nil Routes.Backend; use []string{} for an explicit empty surface", f.ID)
		}
		if f.Routes.Frontend == nil {
			return fmt.Errorf("feature %q has nil Routes.Frontend", f.ID)
		}
		if f.Routes.UITestIDs == nil {
			return fmt.Errorf("feature %q has nil Routes.UITestIDs", f.ID)
		}
		if f.Routes.JobNames == nil {
			return fmt.Errorf("feature %q has nil Routes.JobNames", f.ID)
		}
		if f.Routes.PushKinds == nil {
			return fmt.Errorf("feature %q has nil Routes.PushKinds", f.ID)
		}
	}
	return nil
}
