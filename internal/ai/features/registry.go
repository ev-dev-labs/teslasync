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
