---
description: "Phase-50 Prompt 0065 - W1 SPA AI feature wiring completion"
---

# Phase-50 / Prompt 0065 - W1: SPA AI feature wiring completion

> **Severity:** Foundation completion | **Delegation:** FORBIDDEN
> **Depends on:** 0001-0064 (all F-, U-, N-, D-, C-, T-, A-, G-, X-, S-, M-, P-, V-, PU-, GEN-, ML-tier slices)
> **Feature ID:** _meta — wires every guarded AI surface to its registered backend route_
> **ADR:** [ADR-015 - AI-Off Contract](../adrs/ADR-015-ai-off-contract.md)

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | `.github/prompts/db-refactor/logs/phase-50-0065-spa-feature-wiring.log` |
| Depends-on | 0001-0064 (every preceding Phase-50 slice) |
| Registry tier | W1 (Wiring completion) |
| Backend routes | none added — consumes every guarded `/api/v1/ai/*` route already registered by predecessors |
| Frontend routes | every Frontend path enumerated in `internal/ai/features/registry.go` |
| UI test IDs | every `UITestIDs` entry in `internal/ai/features/registry.go` (no new IDs added) |
| Allowed files to change | See the **Allowed files** section below. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no `return nil`, `// TODO`, `panic("not impl")`, no literal `disabled` / `disabled={true}` placeholder buttons in production AI components, and no `// future slice` / `// coming soon` comment blocks in shipped files
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify every predecessor (0001-0064) STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - `git status` outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| `=== PREFLIGHT ===` | Branch, predecessor logs (0001-0064), and dirty-tree check. Enumerate the registry IDs in scope. |
| `=== SURVEY ===` | Per registry feature: current SPA component path, current submit handler (or `none`), evidence of placeholder pattern (`"coming soon" \| "future slice" \| unconditional disabled`). Compare to the backend route's wire shape and streaming/non-streaming classification. |
| `=== REASONING ===` | Why the wiring approach preserves ADR-015 I3 (baseline intact), I5 (off-mode absence), I6 (404 in off mode), I7 (no SQL bypass), I8 (no duplicate writers), and methodology principles P1-P12. |
| `=== CHANGES ===` | Per-feature wiring diff summary: hook used (`useAiStream` for streaming, typed `useMutation` for one-shot), event/error handling, baseline coexistence preserved. |
| `=== GATE ===` | Full command transcripts with EXIT markers. |
| `=== COMMIT ===` | git add/commit transcript, or blocked-log-only commit transcript. |
| `=== AI-OFF CONTRACT ===` | ADR-015 footer with evidence for every invariant this slice touches. Critically: per-feature off-mode evidence that the wired component does NOT render and does NOT call the route. |
| `=== STATUS ===` | Final `EXIT=<int>` and `STATUS=<DONE|BLOCKED>` markers on their own lines. |

## Problem

Every prior Phase-50 feature slice (F5 0006 and U/N/D/C/T/A/G/X/S/M/P/V/PU/GEN/ML tiers) landed three of the four required pieces for its guarded AI surface:

1. ✓ Registry entry with populated `Backend`, `Frontend`, `UITestIDs`.
2. ✓ Backend handler under `/api/v1/ai/*` wrapped in `guard.Wrap`, returning 404 in `ai_mode='off'` and a real LLM/JSON response on.
3. ✓ Frontend AI component wrapped with `withAiFeature('<id>', InnerSection)` that renders the `data-testid="ai-feature-<id>-root"` only when the feature is on.
4. ✗ **NO submit handler that actually calls the registered backend route.**

Every feature slice's `InnerSection` ships a `disabled` placeholder button with a comment such as:

```
// The actual SSE call wiring lands in a future slice (the slice
// prompt is explicit that the F0 contract requires only the
// rendered-or-absent invariant). The current component shows the
// UI affordance with a "coming soon" disabled button so the
// off-mode test has a concrete UI test ID to assert against and the
// on-mode positive control proves the gate actually fires.
```

The result: with `ai_mode` enabled and every per-feature toggle on, the SPA still shows decorative AI cards whose buttons do nothing. The backend routes return real responses (verified by handler tests) but no SPA surface ever calls them. End-to-end, the AI tier ships zero user-visible function.

The "future slice" referenced in those comments was never authored. This prompt is that slice.

W1 completes the scope deferred by F5 (0006) §D6.4 (`Replace the typewriter in ChatbotPage.tsx with useAiStream`) and by every later slice's identical deferral, in a single pass driven by `internal/ai/features/registry.go`, and codifies two new methodology principles plus an `aivet` rule so this drift cannot recur.

## Evidence

Run before editing, paste into `=== SURVEY ===`:

```powershell
# Count placeholder comments in shipped AI components.
Select-String -Path 'web/src/components/ai/AI*.tsx' -Pattern 'future slice|coming soon|wiring lands' | Measure-Object | Select -Expand Count

# Enumerate registry IDs with UITestIDs (excluding internal __*__ entries).
Select-String -Path 'internal/ai/features/registry.go' -Pattern 'ID:\s+"[a-z-]+"' | ForEach-Object { $_.Line.Trim() }

# Confirm useAiStream is imported by zero AI feature components today.
Select-String -Path 'web/src/components/ai/AI*.tsx' -Pattern 'useAiStream|useMutation' | Measure-Object | Select -Expand Count
```

The numbers in the log MUST be: placeholders ≥ 16 before this slice, 0 after. Components importing the wiring hook MUST be ≥ 15 after (one per non-internal registry feature with `UITestIDs` non-empty).

## Design

### Principle additions (methodology)

Append two principles to `0000-methodology.prompt.md` under "Principles":

- **P11 — Wired-or-absent.** Every guarded AI surface that ships a backend route MUST have its frontend counterpart call that route end-to-end when the feature is enabled. Rendering an indicator without a working call path is a deferred scope violation, not a slice deliverable.
- **P12 — No placeholder buttons.** Shipped AI components MUST NOT render an unconditionally `disabled` primary action with placeholder copy. A button may be transiently disabled while a request is in flight or while a required parent context is missing (e.g. `driveId === undefined`), but never as a permanent "coming soon" affordance.

### `tools/aivet` rule additions

Extend `tools/aivet/main.go` with two static checks driven by `internal/ai/features/spa_wiring.go` (the new source-of-truth table introduced by this slice — see next subsection):

1. **Rule W1-A (placeholder strings + permanent disabled):** fail if any file under `web/src/components/ai/AI*.tsx` OR any file listed in `SPAWiringTable.Component` contains:
   - case-insensitive substring `"future slice"`, `"coming soon"`, `"wiring lands"`, or `"would call POST"`; or
   - a literal `disabled` attribute or `disabled={true}` on a JSX `Button` element. Computed expressions like `disabled={aiStream.state === 'streaming' || !driveId}` are allowed; literal/constant-disabled buttons are not.
2. **Rule W1-B (wiring import + endpoint reference):** for every entry in `SPAWiringTable`, the file at `SPAWiringTable.Component` MUST:
   - import `useAiStream` from `@/hooks/useAiStream` (every wireable feature streams — see "Important wire-shape fact" below), AND
   - reference the canonical endpoint path from `SPAWiringTable.Endpoint` either directly as a string literal OR indirectly via the generated `web/src/ai/spaWiring.ts` map (preferred — keeps the URL in lock-step with Go).

Rule W1-A is regex (case-insensitive substring); Rule W1-B walks `SPAWiringTable`, reads each `Component` file, and parses its top-level `import` statements (line-based grep is sufficient — no full AST needed). Both rules contribute to `aivet`'s exit code: any violation → non-zero exit.

Allowlist for W1-B carve-outs (file MAY skip the import check but only when explicitly listed in `SPAWiringIndicatorOnly` — used when a single feature has BOTH a small indicator component under `components/ai/` AND a larger page-level wiring file, and the import check should target only the page):

```go
// SPAWiringIndicatorOnly lists indicator-only AI component files that
// sit alongside a page-level wiring file. Files here are exempt from
// Rule W1-B because their corresponding SPAWiringTable entry already
// points at the page that owns the call path. They remain subject to
// Rule W1-A.
var SPAWiringIndicatorOnly = []string{
    "components/ai/AIChatbotIndicator.tsx",
}
```

### `internal/ai/features/spa_wiring.go` (new file)

Source-of-truth mapping from feature ID to SPA component path and **render contract**. Owned by Go because `aivet` is Go; mirrored to TS via `tools/aigen --spa-wiring` (extend the existing generator).

**Important wire-shape fact** (verify in SURVEY before authoring this file): every guarded AI handler under `/api/v1/ai/*` opens an SSE writer via `internal/ai/stream.New` and every registry entry has `NeedsStream: true`. There are NO one-shot JSON AI handlers. Consequently every wireable feature uses `useAiStream` on the SPA side. What differs is HOW the stream's `delta` / `tool_result` / `done` events are rendered. The `RenderContract` enum below captures that difference.

```go
package features

// RenderContract classifies how an AI feature's SSE stream is rendered
// on the SPA side. All wireable features stream — they differ in what
// the stream emits and which surface consumes it.
type RenderContract string

const (
    // RenderNarrative: stream emits delta text events accumulated into
    // a single prose block. The component renders the accumulator.
    // Examples: chatbot-llm, digest-narration, yir-narration,
    // drive-coaching, charging-diagnosis, rag-help, anomaly-explanations.
    RenderNarrative RenderContract = "narrative"

    // RenderProposal: stream emits one or more tool_result events
    // carrying a typed draft (AlertRule, Automation, TripPlan,
    // ChargeSchedule, search-result-list, etc.). The component renders
    // the proposal INSIDE the AI panel with an "Apply to form" /
    // "Use this draft" action that copies the draft into the existing
    // baseline form's state via a documented hand-off prop. The AI
    // panel NEVER calls a write path. The user clicks the baseline
    // form's existing Save button to persist (ADR-015 §I3 §I8).
    // Examples: nl-alert-builder, nl-automation-builder,
    // trip-planner-llm-agent, smart-charge-schedule-suggestion,
    // nl-search, nl-drive-search-replay, speed-profile-insights,
    // route-efficiency-suggestions.
    RenderProposal RenderContract = "proposal"

    // RenderSuggestion: stream emits a single suggestion event (one
    // tool_result or a final delta) that prefills a single input
    // alongside an existing manual rename/edit affordance. User clicks
    // the existing Save/Apply button to persist.
    // Examples: auto-trip-naming.
    RenderSuggestion RenderContract = "suggestion"
)

// SPAWiring is the per-feature SPA wiring contract. Every registry
// entry with a non-empty UITestIDs and ID outside the internal-only
// allowlist (ai-provider-health, __usage__, __redaction_bypass__)
// MUST appear here. SPAWiringSelfCheck enforces presence and shape.
type SPAWiring struct {
    FeatureID  string
    Component  string         // path under web/src/, e.g. "components/ai/AIDriveCoaching.tsx"
    Endpoint   string         // canonical Backend[0] from registry, e.g. "POST /api/v1/ai/chatbot"
    Render     RenderContract
    // BaselineFormHandoff: for RenderProposal / RenderSuggestion
    // features, the SPA route path of the baseline form that consumes
    // the draft. Empty for RenderNarrative. The hand-off mechanism
    // (URL hash, context provider, or callback prop) is documented in
    // the per-feature wiring; the W1-B aivet rule does NOT enforce
    // the mechanism, only that the field is set for non-Narrative
    // features.
    BaselineFormHandoff string
}

// SPAWiringTable below is the AUTHORITATIVE snapshot at the time W1
// runs. The agent executing W1 MUST regenerate this table from the
// registry as it exists in the predecessor branch — if a feature has
// been added or renamed since this prompt was authored, the agent
// extends/updates the table accordingly, and SPAWiringSelfCheck
// catches any drift between this table and the live registry.
//
// The entries below are the ones present in the registry at the time
// of prompt authoring. Treat them as the floor, not the ceiling.
var SPAWiringTable = []SPAWiring{
    {"chatbot-llm",                      "features/system/pages/ChatbotPage.tsx",         "POST /api/v1/ai/chatbot",                                       RenderNarrative, ""},
    {"digest-narration",                 "components/ai/AIDigestNarration.tsx",           "POST /api/v1/ai/digests/weekly/narrate",                        RenderNarrative, ""},
    {"yir-narration",                    "components/ai/AIYearReviewNarration.tsx",       "POST /api/v1/ai/analytics/year-in-review/narrate",              RenderNarrative, ""},
    {"anomaly-explanations",             "components/ai/AIAnomalyExplanations.tsx",       "POST /api/v1/ai/anomalies/explain",                             RenderNarrative, ""},
    {"drive-coaching",                   "components/ai/AIDriveCoaching.tsx",             "POST /api/v1/ai/drives/{driveID}/coach",                        RenderNarrative, ""},
    {"charging-diagnosis",               "components/ai/AIChargingDiagnosis.tsx",         "POST /api/v1/ai/charging/{sessionID}/diagnose",                 RenderNarrative, ""},
    {"rag-help",                         "components/ai/AIRAGHelp.tsx",                   "POST /api/v1/ai/help/query",                                    RenderNarrative, ""},
    {"auto-trip-naming",                 "components/ai/AIAutoTripNameSuggestion.tsx",    "POST /api/v1/ai/trips/{tripID}/name/draft",                     RenderSuggestion, "/trips/:id"},
    {"nl-alert-builder",                 "components/ai/AINLAlertBuilder.tsx",            "POST /api/v1/ai/alerts/rules/draft",                            RenderProposal,   "/alerts/studio"},
    {"nl-automation-builder",            "components/ai/AINLAutomationBuilder.tsx",       "POST /api/v1/ai/automations/draft",                             RenderProposal,   "/automations/builder"},
    {"nl-search",                        "components/ai/AINLSearch.tsx",                  "POST /api/v1/ai/search/query",                                  RenderProposal,   "/search"},
    {"nl-drive-search-replay",           "components/ai/AINLDriveSearch.tsx",             "POST /api/v1/ai/drives/search",                                 RenderProposal,   "/drives"},
    {"speed-profile-insights",           "components/ai/AISpeedProfileInsights.tsx",      "POST /api/v1/ai/drives/{driveID}/speed-profile/insights",       RenderProposal,   "/drives/:id"},
    {"route-efficiency-suggestions",     "components/ai/AIRouteEfficiencySuggestions.tsx","POST /api/v1/ai/routes/{routeID}/efficiency/suggest",           RenderProposal,   "/analytics/route-efficiency"},
    {"trip-planner-llm-agent",           "components/ai/AITripPlannerLLMAgent.tsx",       "POST /api/v1/ai/trips/plan/draft",                              RenderProposal,   "/trip-planner"},
    {"smart-charge-schedule-suggestion", "components/ai/AISmartChargeSchedule.tsx",       "POST /api/v1/ai/charging/schedule/draft",                       RenderProposal,   "/charging/schedule"},
}
```

Add `SPAWiringSelfCheck()` (Go test) that asserts:

- Every `Registry` entry with non-empty `UITestIDs` and ID outside the internal-only allowlist appears in `SPAWiringTable` exactly once.
- Every `SPAWiringTable` entry's `Endpoint` matches its registry's `Backend[0]` exactly.
- Every `Component` path exists under `web/src/`.
- Every `RenderProposal` / `RenderSuggestion` entry has a non-empty `BaselineFormHandoff` that matches a `Frontend` route present in `Registry`.

### SSE wiring pattern (uniform — all wireable features)

For every entry in `SPAWiringTable`, the inner component MUST:

1. Manage `pendingRequest` state (the typed body for the POST) and a `streamingOutputId` (or output buffer reference). Both are component-local React state.
2. Call `useAiStream({ url, body: pendingRequest, onEvent })` UNCONDITIONALLY (Hooks rules — no early returns above the hook call). The `url` is the canonical endpoint path AFTER `/api/v1`, e.g. `/ai/chatbot`. `useAiStream` is a no-op while `pendingRequest === null`; trigger it by setting `pendingRequest` to a non-null value via the primary action handler.
3. Handle each `AiStreamEvent` variant according to the feature's `RenderContract`:
   - **`delta`**: For `RenderNarrative` — append `ev.text` to the displayed output buffer. For `RenderProposal` / `RenderSuggestion` — accumulate but do not bind to baseline form yet.
   - **`tool_call`**: render via existing F4 `<ConfirmDialog>` primitive when applicable; otherwise no-op.
   - **`tool_result`**: For `RenderProposal` — parse the typed payload, store it in `proposalDraft` state, render it inside the AI panel with an "Apply to form" / "Use this draft" button. The button copies the draft into the baseline form's state via a documented hand-off (URL hash, query param, or shared context — feature-specific). For `RenderSuggestion` — same mechanism but renders inline next to the existing manual edit field.
   - **`confirm_request`**: render the F4 confirm dialog and POST `/api/v1/ai/_internal/continue` with `{continuation_id}` on confirm.
   - **`done`**: mark stream complete, optionally refetch any list query (e.g. `chatSessionsQuery.refetch()` for chatbot).
   - **`error`**: surface `ev.message`, `ev.banner_level`, `ev.retry_after_s`. Render an inline error per `ai.errors.<bannerLevel>` i18n key. If `ev.banner_level === 'baseline'` AND a baseline path exists at this surface, fall back to the baseline automatically and tag the rendered output as baseline-sourced.
4. On unmount, on feature-toggle-off (`useAiEnabled('<id>')` flips to `false`), on session/route change, AND on user-initiated stop: call `aiStream.cancel()` and reset `pendingRequest = null`, `streamingOutputId = null`, `proposalDraft = null`. Each of these is a separate `useEffect` with explicit deps — do not coalesce.
5. Primary action button: `disabled` MUST be a computed expression of the form `aiStream.state === 'streaming' || aiStream.state === 'paused-confirm' || <feature-specific-guard>`. A literal `disabled` or `disabled={true}` is forbidden (W1-A enforces). A `disabled` while a required parent context is missing (e.g. `driveId === undefined`) is allowed because it is computed against props.
6. Double-submit guard: if `aiStream.state` is `streaming` or `paused-confirm`, the primary action handler is a no-op (does not enqueue a second request).
7. **Specific to ChatbotPage:** call BOTH `useAiStream(...)` and `useSendChatMessage(...)` unconditionally at the top of the component. Inside `submitMessage`, `handleRegenerate`, and `handleEditAndResend`, branch on `useAiEnabled('chatbot-llm')` to choose which path executes. Off-mode behavior of the chatbot is unchanged — the heuristic `/chatbot` route remains the canonical baseline. Add an effect that cancels the SSE and resets in-flight AI state whenever `useAiEnabled('chatbot-llm')` becomes false, the session id changes, or the page unmounts.

### Baseline form hand-off (RenderProposal / RenderSuggestion)

The propose-only contract (ADR-015 §I3 + §I8) requires that the AI panel NEVER persists state directly. The hand-off mechanism the agent picks per feature MUST satisfy:

- The AI panel receives the parent form's setter via a documented prop (recommended) OR pushes the draft into a feature-local context provider that the baseline form reads.
- The baseline form's existing Save handler is the ONLY write path. The AI panel's "Apply to form" button mutates form state only — never the persisted store.
- The off-mode test for the host page MUST continue to assert that the manual form path works end-to-end without any AI surface mounted.
- The on-mode test for the host page MUST assert that clicking "Apply to form" copies the draft into the manual form fields AND that clicking the manual Save button is what actually triggers the typed write handler — proven by spying on the baseline mutation hook, not the AI mutation.

### Per-feature i18n

For every component, replace the placeholder button label key with a real submit label, e.g.:

- `driveDetail.aiCoaching.generateButton` — "Generate coaching" (already present, behavior changes).
- `notifications.alertStudio.aiBuilder.draftButton` — "Draft alert" (already present, behavior changes).

Add per-feature error keys where missing:

- `ai.errors.rateLimit` — "AI rate limit reached. Try again in {{seconds}}s."
- `ai.errors.costCap` — "Daily AI budget reached. AI features pause until midnight."
- `ai.errors.providerUnavailable` — "AI provider unavailable. Falling back to the standard view."
- `ai.errors.generic` — "AI generation failed: {{message}}."

All three locales (`en`, `ar`, `he`) MUST receive matching keys.

## Baseline coexistence (P10)

- Baseline impls preserved: every non-AI route the AI surfaces sit alongside (`POST /chatbot`, the manual AlertStudio form, the manual TripPlanner, the trip rename PATCH, etc.) remain unchanged. AI code never modifies a baseline handler.
- Selection mechanism: `useAiEnabled('<feature-id>')` at the page composition layer chooses between the AI submit path and the baseline path. Inside `withAiFeature`-wrapped sections, AI is unconditionally on (the gate already passed); the baseline path lives on the unwrapped peer surface (manual form, legacy mutation, etc.).
- Off-mode tests: every existing per-feature `Test<Feature>AIOff*` test remains green AND a new `Test<Feature>AIOnWiredCallsRoute` integration test proves the on-mode wiring fires the registered route exactly once per click.

## Redaction policy (F8)

- Policy: each feature's existing `Policy*` (already registered by its slice) — this slice does not change any redaction policies.
- Allowed classes: unchanged from each feature's slice.
- Round-trip required: unchanged from each feature's slice.

## Off-mode contract impact

- Backend routes added: none.
- Frontend routes affected: every entry in the registry's `Frontend` lists for non-internal features. No new SPA routes are introduced.
- UI test IDs: every existing `ai-feature-<id>-root`. No new IDs.
- New background jobs: none.
- New push kinds: none.
- Service worker chunks: every existing `ai-<feature>` chunk continues to be loaded only when the feature is enabled. The chunk size grows by the wired hook + DTOs; verify the per-chunk bundle budget in `web/vite.config.ts` is not exceeded.
- Client storage keys: none added by W1. Any per-feature streaming state lives in component-local React state and is cleared on unmount.

## Registry metadata contribution

This slice does NOT add new registry entries. It adds:

- `internal/ai/features/spa_wiring.go` — the per-feature SPA wiring table (Go source of truth).
- `web/src/ai/spaWiring.ts` — generated from the Go table by `tools/aigen --spa-wiring`.
- Two new `aivet` rules (W1-A and W1-B) consuming the same table.

The SPA wiring table is consulted by `aivet` and by an off-mode invariant test, but it is NOT part of the runtime `Registry` returned by `features.All()`. It is a static contract between the SPA component layer and the registry, enforced at build time only.

<!-- BEGIN: HX (Helix UX) ADDENDUM (auto-inserted) -->
## Helix UX scaffolding (Phase-50/HX — inline, MANDATORY)

This slice MUST render its primary AI surface through the shared
`AIFeatureCard` scaffold (`web/src/components/ai/AIFeatureCard.tsx`),
NOT a bespoke GlassPanel + Button + AiOutputPanel composition. The
scaffold was extracted from 38 pre-existing AI feature cards
(commit `7c125573f`) to guarantee visual, accessibility, and i18n
consistency across every Helix surface.

The wired component MUST:

1. **Scaffold:** import `AIFeatureCard` from
   `@/components/ai/AIFeatureCard` and render the entire feature
   surface through it. Do NOT roll a per-feature `<GlassPanel>` +
   `<Button>` + `<AiOutputPanel>` composition. The card owns the
   header, AI badge, description, optional empty-state hint, action
   button, streaming label, and AiOutputPanel placement. If a second
   surface (e.g. a typed-proposal preview, a domain-specific results
   list) is needed, render it via the card's `children` slot — never
   wrap a second `GlassPanel` around the card.

2. **Universal CTA — visible label is painted by the card.**
   `AIFeatureCard` paints the visible button text as
   "Ask Helix" (idle) / "Helix is thinking…" (streaming) with the
   `HelixMark` brand glyph and the cyan glass treatment. The
   per-feature action verb (e.g. "Suggest triage", "Summarize logs")
   is passed to the card via the **`buttonLabel`** prop and surfaces
   ONLY in the button's `aria-label` (read as
   `"${askHelixLabel} · ${buttonLabel}"`) and `title` (hover
   tooltip). Do NOT pass `"Ask Helix"` as `buttonLabel` — the
   accessible name would lose the per-feature context and existing
   role-name assertions would break. **Pass the per-feature verb.**

3. **Test regexes MUST be unanchored.** Because the accessible name
   reads `"Ask Helix · <buttonLabel>"`, anchored regexes
   (`/^Suggest$/i`) will not match. Locate the CTA via
   `getByRole('button', { name: /Suggest/i })` (no `^`/`$`).
   The on-mode wiring test
   (`Test0065W1SpaFeatureWiringAIOnWiredCallsRoute`)
   added by the W1 addendum above MUST use this unanchored form.

4. **Brand glyph for assistant identity.** Use `HelixMark` from
   `@/components/branding/HelixMark` for ANY Helix/assistant identity
   slot this slice introduces (avatars, inline chat author marks,
   panel headers, status icons that represent "the AI talking").
   Do NOT use lucide `Bot`, generic sparkle icons, or feature-specific
   bespoke icons for these slots. Lucide `Bot` may still be used in
   non-AI contexts (e.g. "Bot Token" in notification provider
   settings); the rule is scoped to assistant-identity slots only.

5. **`AIThinkingDots` for streaming affordances OUTSIDE the card.**
   `AIFeatureCard` already renders `AIThinkingDots` inside its action
   button label while `stream.state === 'streaming'` (the dots are
   `aria-hidden`). If this slice surfaces a separate "thinking"
   indicator anywhere else (e.g. an inline chat row, a status pill),
   import `AIThinkingDots` from
   `@/components/ai/AIThinkingIndicator` rather than re-rolling the
   pulse animation.

6. **Helix-branded i18n copy.** Every USER-VISIBLE string this slice
   adds (empty/loading/error states, captions, hints, panel titles,
   menu labels) says "Helix" not "AI". Examples:
   `"helix.askHelix"` / `"helix.thinking"` / `"helix.usage.today"`.
   Registry `Name` / `Description` fields in
   `internal/ai/features/registry.go` are NOT user-facing in the
   same way — `CoverageOK()` only checks `Name != ""` and does not
   constrain the prose. Prefer Helix-branded copy when the registry
   entry surfaces in Settings → AI; technical / operator-only entries
   may keep accurate "AI ..." terminology.

### `AIFeatureCard` prop affordances (use them, don't sidestep them)

The scaffold supports the slice render contracts already in scope:

| Prop | When to use it |
|---|---|
| `inputSlot` | NL/prompt-input features (textarea, search box, NL-SQL editor). Pass the input via `inputSlot`; the card renders the action button beneath it (`buttonPlacement` is auto-set to `below`). |
| `children` | Typed-proposal previews, domain-specific result widgets, conflict lists — anything that renders between the action button and the AiOutputPanel. |
| `buttonPlacement='below'` | Header text too long to share a row, or feature renders extra context between header and button. |
| `emptyHint` | Per-feature "what's missing" text shown beneath the description when `canStart === false` (e.g. "Select a feedback row first."). |
| `onAction` | Override `stream.start` only when the slice needs to reset local state before firing (e.g. clear a captured conflicts list). The default is `stream.start`. |

### `canStart` MUST encode every busy/guard state

The card disables the action button when `!canStart || stream.state === 'streaming'`.
The slice's `canStart` expression MUST also be `false` while
`stream.state === 'paused-confirm'` (when the slice uses the F4
confirm-pause flow), and while any feature-specific guard is unmet
(`driveId === undefined`, no row selected, AI feature toggle off via
`useAiEnabled`). This preserves the W1 double-submit invariant ON
TOP of the scaffold — the card disables for streaming, the slice
disables for everything else.

<!-- END: HX (Helix UX) ADDENDUM -->

## Action Steps

1. In `=== PREFLIGHT ===`, verify every predecessor 0001-0064 has a log ending in `STATUS=DONE`. List the registry IDs in scope (output of the Evidence Select-String commands).
2. Add `internal/ai/features/spa_wiring.go` and its self-check test. Run `go test ./internal/ai/features/...` and paste output. Expected: green if all listed components exist; red telling you exactly which file is missing if not.
3. Extend `tools/aivet/main.go` with rules W1-A and W1-B. Run `go run ./tools/aivet` and paste output. Expected on first run: ≥ 16 W1-A failures and ≥ 15 W1-B failures — these enumerate the per-feature work to do.
4. Extend `tools/aigen` with `--spa-wiring` flag. Generate `web/src/ai/spaWiring.ts` with the following shape (exported types + frozen lookup map consumed by component wiring, tests, and W1-B endpoint check):

   ```ts
   // Generated from internal/ai/features/spa_wiring.go — DO NOT EDIT.
   export type RenderContract = 'narrative' | 'proposal' | 'suggestion'
   export interface SPAWiringEntry {
     readonly featureId: string
     readonly component: string         // path under web/src/
     readonly endpoint: string          // canonical Backend[0], e.g. "POST /api/v1/ai/chatbot"
     readonly endpointPath: string      // path-only, e.g. "/ai/chatbot" (after "/api/v1") for useAiStream
     readonly render: RenderContract
     readonly baselineFormHandoff: string  // empty for narrative
   }
   export const SPA_WIRING: ReadonlyArray<SPAWiringEntry> = Object.freeze([ ... ])
   export const SPA_WIRING_BY_ID: Readonly<Record<string, SPAWiringEntry>> = Object.freeze({ ... })
   ```

   Each component wired by W1 MUST import `SPA_WIRING_BY_ID['<feature-id>'].endpointPath` rather than hand-writing the URL string. The W1-B check passes when either the component imports `SPA_WIRING_BY_ID` keyed by the feature ID OR the canonical endpoint string appears verbatim in the file.
5. Append principles P11 and P12 to `0000-methodology.prompt.md`. Update `0006-F5-sse-streaming.prompt.md` §D6.4 to point at this slice for the wiring deliverable. Update every per-feature slice's "future slice" / "coming soon" prose in the prompt files to reference this slice's number (0065-W1). Do this with `git grep -l 'future slice' .github/prompts/db-refactor/phase-50-ai-adoption/` and patch each.
6. Wire each feature per its `RenderContract` classification. For each component:
   - Remove every `// "coming soon"` / `// future slice` / `// wiring lands` / `// would call POST` comment block.
   - Replace the literal `disabled` with a computed expression as specified in the SSE wiring pattern.
   - Add the canonical `useAiStream` call + event handler matching the feature's `RenderContract` (Narrative / Proposal / Suggestion).
   - For `RenderProposal` / `RenderSuggestion` features, also touch the host page identified by `BaselineFormHandoff` to accept the hand-off — keeping the change strictly to (a) optional prop / context wiring, (b) layout-slot mount, (c) form-state read from the hand-off. Baseline submit handler / validation / persistence stays untouched.
   - Add the FIVE-test matrix from the Tasks section using `useAiEnabled` mocked → `true` and `MockReadableStream` for SSE. Assert exactly one request to the canonical endpoint per click and that the response is rendered. Cover error envelope, cancel-on-unmount, and double-submit.
7. For the `chatbot-llm` feature specifically, replace `ChatbotPage`'s legacy submit path with a gated branch: `useAiEnabled('chatbot-llm')` ? SSE via `useAiStream` : existing `useSendChatMessage`. Extend `regenerate` and `edit-and-resend` handlers identically. Off-mode tests for `ChatbotPage` MUST still pass — they assert the heuristic baseline still owns the conversation when AI is off.
8. Re-run `go run ./tools/aivet`. Expected: 0 W1-A failures, 0 W1-B failures.
9. Run the full verification commands and paste raw output into the log with EXIT markers.
10. Commit only if every gate is green. Use the commit message format in the Commit section.

## Tasks

1. **Methodology:** P11 + P12 appended to `0000-methodology.prompt.md`; prompt prose updates in F5 and every per-feature slice that referenced "future slice".
2. **Source of truth:** `internal/ai/features/spa_wiring.go` + `SPAWiringSelfCheck`; generated `web/src/ai/spaWiring.ts`.
3. **Static enforcement:** `tools/aivet` rules W1-A (placeholder strings) and W1-B (required hook import per feature).
4. **Per-feature wiring:** 16 components migrated from placeholder to wired, plus `ChatbotPage` gated branch.
5. **Per-feature tests** — every feature in `SPAWiringTable` must have FIVE test cases, each in a separate `it()` block, mocking `useAiEnabled('<id>') === true`:

   | Test | What it proves |
   |---|---|
   | `<Feature>OnSuccessRendersResponse` | One click → exactly one POST to canonical endpoint → `delta`/`tool_result`/`done` events stream → output rendered. Spy on the global fetch to assert request count and body. |
   | `<Feature>RateLimitErrorBannerShown` | Server emits `error{banner_level:'rate_limit', retry_after_s:30}` → component renders the `ai.errors.rateLimit` copy with substituted seconds. |
   | `<Feature>BaselineFallbackOnProviderError` | Server emits `error{banner_level:'baseline', baseline_available:true}` → AI panel renders baseline-sourced output and tags it as such. (RenderNarrative only; RenderProposal features render the inline error without fallback.) |
   | `<Feature>CancelOnUnmount` | Component unmounts mid-stream → `aiStream.cancel()` fires → no further fetch calls or state updates after unmount. |
   | `<Feature>DoubleSubmitNoOp` | Click → click again before `done` → second click is a no-op (one request total). |

   Additionally for ChatbotPage:
   - `ChatbotPageAIOffStillUsesLegacyChatbot` — `useAiEnabled` returns false → `submitMessage` calls `useSendChatMessage`, no SSE request emitted.
   - `ChatbotPageRegenerateAndEditBranchOnAiMode` — same gate applies to `handleRegenerate` and `handleEditAndResend`.
   - `ChatbotPageCancelsSseOnFeatureToggleOff` — `useAiEnabled` flips to false mid-stream → SSE cancels and chat state resets without dropping persisted user message.

6. **Error envelope:** `ai.errors.rateLimit` / `ai.errors.costCap` / `ai.errors.providerUnavailable` / `ai.errors.generic` keys in `en`, `ar`, `he`. Banner-level handling consistent across every wired component (shared inline-error sub-component recommended — put it in `web/src/components/ai/AIErrorBanner.tsx` if no existing primitive covers it).
7. **Bundle budget:** run the existing `npm run build` and verify per-chunk sizes are still under the budgets configured in `web/vite.config.ts`. Do NOT add new CI gates in this slice.
8. **Log:** include the ADR-015 compliance footer with concrete per-feature on/off evidence.
<!-- BEGIN: HX (Helix UX) TASK -->
10. Helix UX scaffold: render the AI surface through `AIFeatureCard`. Pass the per-feature verb as `buttonLabel` (NOT "Ask Helix"). Use `HelixMark` for assistant-identity glyphs; use `AIThinkingDots` for any thinking affordance outside the card. User-visible i18n copy says "Helix" not "AI". Tests locating the CTA use unanchored regexes.
<!-- END: HX (Helix UX) TASK -->

## Allowed files

- `internal/ai/features/spa_wiring.go` (new)
- `internal/ai/features/spa_wiring_test.go` (new — `SPAWiringSelfCheck`)
- `tools/aivet/**` (extend with rules W1-A and W1-B + tests)
- `tools/aigen/**` (add `--spa-wiring` generator)
- `web/src/ai/spaWiring.ts` (generated — commit alongside Go source)
- `web/src/components/ai/AI*.tsx` (every existing AI feature component; remove placeholders, add wiring)
- `web/src/components/ai/__tests__/AI*WiredCallsRoute.test.tsx` (new per-feature tests)
- `web/src/components/ai/__tests__/AI*ErrorEnvelope.test.tsx` (banner_level UX coverage)
- `web/src/components/ai/__tests__/AI*CancelOnUnmount.test.tsx` (lifecycle coverage)
- `web/src/api/ai/**` (typed event/payload DTOs per feature where the proposal/suggestion contract needs typed shapes)
- `web/src/features/system/pages/ChatbotPage.tsx` (gated submit branch)
- `web/src/features/system/pages/__tests__/ChatbotPage*.test.tsx` (extend coverage)
- Host pages whose baseline forms receive proposal/suggestion hand-offs from RenderProposal/RenderSuggestion features. These are explicitly allowed because the hand-off mechanism requires either a callback prop or a context provider at the host page level. The exact set is the union of `BaselineFormHandoff` route paths in `SPAWiringTable`, mapped to their file paths:
  - `web/src/features/notifications/pages/AlertStudioPage.tsx` (nl-alert-builder)
  - `web/src/features/notifications/pages/AutomationsBuilderPage.tsx` (nl-automation-builder)
  - `web/src/features/system/pages/SearchPage.tsx` (nl-search)
  - `web/src/features/driving/pages/DrivesListPage.tsx` (nl-drive-search-replay)
  - `web/src/features/driving/pages/DriveDetailPage.tsx` (speed-profile-insights — peer to drive-coaching)
  - `web/src/features/analytics/pages/RouteEfficiencyPage.tsx` (route-efficiency-suggestions)
  - `web/src/features/driving/pages/TripPlannerPage.tsx` (trip-planner-llm-agent)
  - `web/src/features/charging/pages/ChargeSchedulePage.tsx` (smart-charge-schedule-suggestion)
  - `web/src/features/driving/pages/TripDetailPage.tsx` (auto-trip-naming)
  Touching these files is restricted to: (a) accepting a new optional prop / context for the AI hand-off, (b) wiring the AI panel inside an existing layout slot, (c) reading the draft from context/prop into the existing form state. NO changes to baseline submit handlers, form validation, or persistence paths.
- `web/src/i18n/en.json`, `web/src/i18n/ar.json`, `web/src/i18n/he.json` (error envelope keys + submit labels)
- `.github/prompts/db-refactor/phase-50-ai-adoption/0000-methodology.prompt.md` (append P11, P12)
- `.github/prompts/db-refactor/phase-50-ai-adoption/0006-F5-sse-streaming.prompt.md` (update §D6.4 cross-reference to point at this slice)
- Every per-feature prompt in `.github/prompts/db-refactor/phase-50-ai-adoption/` whose prose contains `"future slice"` / `"coming soon"` / `"wiring lands"` (update cross-reference to 0065-W1; no other prose changes)
- `.github/prompts/db-refactor/logs/phase-50-0065-spa-feature-wiring.log`

Do not touch Phase-49 alert-engine files, telemetry ingestion paths, signal pipeline code, SI canonicalization code, Helm structural files, any AI baseline handler (`/chatbot` heuristic responder, `POST /api/v1/alerts/rules`, etc.), or any provider/strategy/decorator/dispatch code. The wiring is SPA + static-check-tooling only.

## Verification

Run these commands and paste raw output into `=== GATE ===`:

~~~powershell
git --no-pager status --short
go test -race ./internal/ai/features/... ./tools/aivet/... ./tools/aigen/...
go run ./tools/aivet               # 0 violations after wiring lands
go run ./tools/aigen --check       # spaWiring.ts in sync with Go source
go test -race ./internal/ai/... ./internal/api/...    # no per-feature handler regression
cd web
npx tsc --noEmit
npm run lint
npm test -- --run 'AI.*WiredCallsRoute|AI.*ErrorBanner|AI.*CancelOnUnmount|AI.*DoubleSubmit|ChatbotPageAIOff|ChatbotPageRegenerateAndEditBranch|ChatbotPageCancelsSseOnFeatureToggleOff'
npm test -- --run offMode.invariant   # off-mode contract still green
npm run build                          # bundle budget honored
~~~

Off-mode proof per feature — paste exit + greps for each ID in `SPAWiringTable`:

~~~powershell
# Expected: 404 for every Backend route in registry when ai_mode='off'.
# Expected: zero elements with `data-testid="ai-feature-<id>-root"` rendered
#           when ai_mode='off' for every feature ID.
# Expected: no network request to /api/v1/ai/* originates from the SPA
#           when ai_mode='off' (observed via vitest spy on global fetch).
~~~

On-mode proof per feature — paste exit + assertion summary:

~~~powershell
# Expected per feature in SPAWiringTable:
#   1. Mount the component with useAiEnabled → true.
#   2. Click the primary action button.
#   3. Exactly ONE fetch to the canonical endpoint.
#   4. Response rendered: streamed text accumulator visible (Stream)
#      or DTO field bound to its target UI surface (JSON).
#   5. banner_level error envelope rendered correctly for each level.
~~~

## Gate

The slice is DONE only if:

1. All verification commands exit 0.
2. The log contains `EXIT=0` and `STATUS=DONE` on their own lines.
3. `tools/aivet` reports 0 W1-A and 0 W1-B violations.
4. `SPAWiringSelfCheck` passes — registry and SPA wiring table are in sync.
5. Every per-feature `*AIOnWiredCallsRoute` test passes.
6. Every existing `*AIOff*` test remains green.
7. ChatbotPage off-mode tests still prove the heuristic baseline owns the conversation when AI is off.
8. `git status --short` contains only allowed files before commit.
<!-- BEGIN: HX (Helix UX) GATE -->
8. The slice's SPA component imports `AIFeatureCard` from `@/components/ai/AIFeatureCard` and renders its primary AI surface through it; the per-feature verb is passed via `buttonLabel`; assistant-identity glyphs use `HelixMark` (not lucide `Bot`); on-mode wiring tests use unanchored role-name regexes; user-visible i18n copy added by this slice contains no `"AI "` prefix in a Helix-narrative position.
<!-- END: HX (Helix UX) GATE -->


Any failure means `STATUS=BLOCKED` and only the log may be committed.

## Commit

Commit message:

~~~text
feat(ai): wire SPA AI surfaces to their backend routes (W1)

Phase-50 feature slices (F5, U1-U4, N1-N6, D1-D5, C1-C5, T3, A1-A3,
G1-G3, X1-X2, S1-S7, M1-M3, P1-P3, V1-V2, PU1-PU3, GEN1-GEN2, ML1-ML3)
each landed a backend route and a guarded indicator component but
deferred the actual submit wiring with a "coming soon" placeholder
button. W1 completes that deferred scope in one pass driven by the
new internal/ai/features/spa_wiring.go contract, codifies the
wired-or-absent and no-placeholder-button principles (P11, P12) in
the methodology, and adds tools/aivet rules W1-A and W1-B so the
drift cannot recur.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
~~~

The commit MUST include this prompt's production/test/tooling changes and its log when DONE. When BLOCKED, commit only the log.

## Blocked Path

This slice is the methodology completion of every prior Phase-50 feature slice. It cannot land partial without breaking the parallel-agent contract. Specifically:

- **Predecessor not DONE** — if any predecessor 0001-0064 log is missing or has STATUS != DONE, W1 MUST block with the missing slice ID listed. Do NOT pick a subset of features and wire only those.
- **Registry contains a wireable feature not in `SPAWiringTable`** — `SPAWiringSelfCheck` fails. The agent extends the table to cover it (the snapshot in this prompt is the authoring-time floor, not the ceiling) and updates the per-feature wiring to match. If the corresponding `web/src/components/ai/AI*.tsx` file does not exist, the predecessor slice that owns that feature is incomplete — block on that slice, do NOT scaffold the component here.
- **Parallel agent commits land mid-execution** — if `git status` outside the allowed-files set is dirty when W1 reaches the commit step, block on a clean tree. The parallel runner must pause OR the user must rebase W1 on top of the latest agent commit. W1's aivet rules will then enforce the contract on every subsequent agent commit — any later slice that ships a placeholder will fail CI, which is the intended outcome.
- **Baseline form host page resists hand-off** — if a host page (AlertStudio, AutomationsBuilder, TripPlanner, ChargeSchedule, etc.) cannot accept the proposal hand-off without touching its baseline submit handler or persistence path, block and open a follow-up prompt to refactor the host page's form state into a hand-off-friendly shape FIRST. Do NOT bypass the baseline write path from inside the AI panel.
- **Files outside allowed list dirty** — STATUS=BLOCKED. Commit only the log.

Write the log with:

~~~text
=== STATUS ===
EXIT=1
STATUS=BLOCKED
~~~

Include the precise blocker, the command output, and the next required slice or owner action.

## Deliverable

One commit for Prompt 0065 plus `.github/prompts/db-refactor/logs/phase-50-0065-spa-feature-wiring.log`, containing the ADR-015 footer:

~~~text
=== AI-OFF CONTRACT ===
I1 default-off:     PASS|FAIL  (evidence)
I2 toggle-driven:   PASS|FAIL  (evidence)
I3 baseline-intact: PASS|FAIL  (per-feature evidence — baseline route still owns its surface in off mode for every wired feature)
I4 audit-everything:PASS|FAIL  (evidence)
I5 ui-honest:       PASS|FAIL  (per-feature evidence — wired button absent in off mode)
I6 routes-404:      PASS|FAIL  (per-feature evidence — registered Backend route still 404s in off mode)
I7 no-sql-bypass:   PASS|FAIL  (evidence)
I8 no-duplicate-writers: PASS|FAIL  (per-feature evidence — JSON-style features pipe drafts into existing manual forms, never call write paths from mutation onSuccess)
I9 retrieval-uses-rag:PASS|FAIL  (evidence)
I10 type-system:    PASS|FAIL  (evidence)
~~~

## Forward dependency

The 9999 final-gate's off-mode walker and on-mode positive-control sweep both consume `SPAWiringTable`. After W1 lands, the final gate's on-mode sweep is upgraded from "indicator renders" to "indicator renders AND clicking it produces a real call to the registered route AND the response is rendered." No further wiring prompts are required for Phase-50.
