---
description: "Phase-50 Prompt 0061 - GEN2 Vehicle paint preview"
---

# Phase-50 / Prompt 0061 - GEN2: Vehicle paint preview

> **Severity:** Feature | **Delegation:** FORBIDDEN
> **Depends on:** 0001-0010 F0-F9 plus 0009 F8
> **Feature ID:** `vehicle-paint-preview`
> **ADR:** [ADR-015 - AI-Off Contract](../adrs/ADR-015-ai-off-contract.md)

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | `.github/prompts/db-refactor/logs/phase-50-0061-vehicle-paint-preview.log` |
| Depends-on | 0001-0010 F0-F9 plus 0009 F8 |
| Registry tier | GEN2 |
| Backend routes | POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft |
| Frontend routes | /vehicles/:vehicleId |
| UI test IDs | ai-feature-vehicle-paint-preview-root |
| Allowed files to change | See the **Allowed files** section below. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no `return nil`, `// TODO`, `panic("not impl")`
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - `git status` outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| `=== PREFLIGHT ===` | Branch, predecessor logs, and dirty-tree check. |
| `=== SURVEY ===` | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| `=== REASONING ===` | Why the selected design preserves ADR-015, P1-P10, and the non-AI baseline. |
| `=== CHANGES ===` | Summary of production, test, registry, i18n, and golden changes. |
| `=== GATE ===` | Full command transcripts with EXIT markers. |
| `=== COMMIT ===` | git add/commit transcript, or blocked-log-only commit transcript. |
| `=== AI-OFF CONTRACT ===` | ADR-015 footer with evidence for every invariant this slice touches. |
| `=== STATUS ===` | Final `EXIT=<int>` and `STATUS=<DONE|BLOCKED>` markers on their own lines. |

## Problem

Generate optional paint-preview concepts without mutating vehicle settings or exposing identifiers.

The current non-AI behavior must remain the canonical baseline for users with `settings.ai_mode='off'`. This slice may add an AI surface only through the Phase-50 foundation: feature registry (P9), backend guard (P6), frontend `withAiFeature`/`useAiEnabled` (P6), provider port (P1), strategy/dispatcher loop (P4), decorator chain (P5), and eval goldens (P8).

## Evidence

- Baseline implementation to preserve: Existing vehicle photos and manual theme/appearance settings
- AI implementation to add: internal/ai/strategies/vehicle-paint-preview Strategy producing preview prompt DTOs for opted-in image provider
- Existing route/page must keep working when AI is off: /vehicles/:vehicleId
- New AI backend surface must return 404 when `ai_mode='off'`: POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft
- Registry metadata must be complete so the final gate can prove absence in off mode.

## Design

1. Register feature `vehicle-paint-preview` in `internal/ai/features/registry.go` with `DefaultOn: false` and explicit `Routes` metadata. Empty arrays must be explicit, not omitted.
2. Implement the AI path as a strategy under `internal/ai/strategies/vehicle-paint-preview/**`; do not import provider adapters directly from feature code.
3. Preserve the baseline implementation and select between baseline and AI through an interface at construction or page composition time; do not branch inside business logic.
4. Route every provider call through the decorator chain in the locked order from the methodology: redaction, rate limit, cost cap, audit, trace.
5. Route every mutation proposal through F4 tools and existing typed DTO validation. The LLM never writes raw SQL and never bypasses existing handlers.
6. Add at least 3 deterministic goldens in `internal/ai/strategies/vehicle-paint-preview/goldens.yaml`, plus canned mock-provider responses when required by F6.
7. Add i18n toggle copy in `web/src/i18n/en.json`, `web/src/i18n/ar.json`, and `web/src/i18n/he.json`.
8. Add the `data-testid` root marker(s) listed below and wrap AI-only React components with `withAiFeature('vehicle-paint-preview', Component)`.

## Baseline coexistence (P10)

- Baseline impl:        Existing vehicle photos and manual theme/appearance settings
- AI impl:              internal/ai/strategies/vehicle-paint-preview Strategy producing preview prompt DTOs for opted-in image provider
- Selection mechanism:  PaintPreviewGenerator is selected by ai_mode plus vehicle-paint-preview toggle; existing photos remain baseline
- Off-mode test:        TestVehiclePaintPreviewAIOffHidesPreviewTool

## Redaction policy (F8)

- Policy:              PolicyChatbot from `internal/ai/redact/policies.go`
- Allowed classes:     none; vehicle image prompt must not include VIN, plate, or location
- Round-trip required: no

## Off-mode contract impact

- Backend routes added:     POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft
- Frontend routes affected: /vehicles/:vehicleId
- UI test IDs:             ai-feature-vehicle-paint-preview-root
- New background jobs:      none
- New push kinds:           none
- Service worker chunks:    ai-vehicle-paint-preview
- Client storage keys:      ai.paintPreview.draft

## Registry metadata contribution

Add or extend the `vehicle-paint-preview` registry entry with all fields populated:

~~~go
Routes: features.RouteSet{
    Backend:   []string{"POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft"},
    Frontend:  []string{"/vehicles/:vehicleId"},
    UITestIDs: []string{"ai-feature-vehicle-paint-preview-root"},
    JobNames:  []string{},
    PushKinds: []string{},
}
~~~

If a surface is truly absent, use `[]string{}` in the implementation instead of omitting the field.

<!-- BEGIN: W1 INLINE WIRING ADDENDUM (auto-inserted) -->
## SPA wiring (P11/P12 ΓÇö inline, do NOT defer to W1)

This slice MUST ship the SPA component **wired end-to-end** to the
backend route. The "render disabled placeholder, defer wiring to W1"
pattern is forbidden by methodology principles **P11 (Wired-or-absent)**
and **P12 (No placeholder buttons)**. Slice 0065 (W1) installs those
principles + the `aivet` enforcement rule; the **wiring itself lands
here**, in this slice's commit.

The wired component MUST:

1. Import `useAiStream` from `@/hooks/useAiStream` (already shipped).
2. Render through `AiOutputPanel` from `@/components/ai/AiOutputPanel`
   (already shipped) for **narrative** render contracts. For
   **proposal** or **suggestion** render contracts, render the typed
   draft inside the AI panel with an "Apply to form" / "Use this
   draft" action that copies the draft into the baseline form's
   state. The AI panel NEVER persists state directly; the baseline
   form's existing Save button remains the sole write path
   (ADR-015 ┬ºI3 + ┬ºI8 propose-only contract).
3. Have a primary action button whose `disabled` prop is a **computed**
   expression, e.g.
   `aiStream.state === 'streaming' || aiStream.state === 'paused-confirm' || <feature-guard>`.
   Literal `disabled` or `disabled={true}` is forbidden (Rule W1-A).
4. Call `useAiStream({ url, body, onEvent })` unconditionally at the
   top of the component (Hooks rules ΓÇö no early returns above the hook
   call). For this slice the registered backend endpoint is
   **`POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft`**, so the SPA `url` is **`/ai/vehicles/{vehicleID}/paint-preview/draft`**
   (the backend path after stripping the `/api/v1` prefix).
5. Handle each `AiStreamEvent` variant per render contract:
   - `delta` ΓåÆ append `ev.text` to the displayed output (narrative)
     or accumulate (proposal/suggestion).
   - `tool_call` ΓåÆ surface the F4 `<ConfirmDialog>` when applicable.
   - `tool_result` ΓåÆ parse the typed payload, render inside the AI
     panel (proposal/suggestion only).
   - `confirm_request` ΓåÆ open the confirm dialog and POST
     `/api/v1/ai/_internal/continue` with `{continuation_id}` on
     confirm.
   - `done` ΓåÆ mark stream complete; refetch list queries if needed.
   - `error` ΓåÆ surface `ev.message`, `ev.banner_level`,
     `ev.retry_after_s` via the existing `ai.errors.<bannerLevel>`
     i18n key. On `banner_level === 'baseline'`, fall back to the
     baseline rendering at the same surface and tag the output as
     baseline-sourced.
6. On unmount, on `useAiEnabled('vehicle-paint-preview')` flip to `false`, on
   route/session change, AND on user-initiated cancel: call
   `aiStream.cancel()` and reset all local stream state in a
   dedicated `useEffect` with explicit deps. Do not coalesce these
   effects.
7. Double-submit guard: while `aiStream.state` is `streaming` or
   `paused-confirm`, the primary action handler is a no-op.
8. **No** "future slice", "coming soon", "wiring lands", or "would
   call POST" comments or placeholder strings in the shipped file.
   `aivet` Rule W1-A (added by slice 0065) backstops this; the
   final gate fails if any are present.

### User-prefs / units (cross-cutting, no per-slice work required)

User display preferences (Miles/Fahrenheit/PSI/Rated/decimal precision/
locale/currency) flow into every `/api/v1/ai/*` request automatically:

- `userPrefsMiddleware` (in `internal/api/ai_routes.go`) reads the
  user's Application settings once per request and seeds a
  `dispatch.UserPrefs` value into the request context.
- The dispatcher appends a second system message instructing the
  model to narrate in the user's display units, with explicit
  SI ΓåÆ display conversion formulas.

This slice MUST NOT duplicate that plumbing in its strategy or
handler. If this slice adds a new tool that surfaces a Celsius
value (or any other SI-canonical value where a display-unit
conversion is non-trivial), it MUST also emit the pre-computed
display-unit field alongside ΓÇö see `cToFPtr` in
`internal/ai/tools/drive_coaching.go` for the temperature
precedent (`outside_temp_avg_c` + `outside_temp_avg_f` emitted
together). Tools must NOT rely on the LLM to do arithmetic on
negative or fractional values.

### New on-mode wiring test (required)

Add `TestVehiclePaintPreviewAIOnWiredCallsRoute` (or the feature-specific variant implied by this
slice's existing test naming) proving:

- With `ai_mode='local'` and the `vehicle-paint-preview` toggle on, invoking
  the primary action enqueues **exactly one** POST against the
  registered backend route `POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft` and consumes the SSE
  stream (use the existing mock-provider harness from F6).
- The first `delta` event's text is rendered inside the AI panel
  via the `data-testid="ai-feature-vehicle-paint-preview-root"` marker.
- A second click while `aiStream.state === 'streaming'` is a no-op
  (double-submit guard).
- For proposal / suggestion render contracts: clicking "Apply to
  form" copies the typed draft into the baseline form's state, AND
  clicking the baseline Save button is what triggers the typed
  write handler (spy on the baseline mutation hook, not the AI
  stream).
- The existing off-mode test `TestVehiclePaintPreviewAIOffHidesPreviewTool` continues to pass
  unchanged ΓÇö wiring MUST NOT regress the off-mode absence
  invariant.

<!-- END: W1 INLINE WIRING ADDENDUM -->
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
   (`TestVehiclePaintPreviewAIOnWiredCallsRoute`)
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

1. In `=== PREFLIGHT ===`, verify every predecessor listed in Depends-on has a log ending in STATUS=DONE. If any predecessor is missing or blocked, stop after writing a BLOCKED log.
2. Survey the baseline route/page and write down the current non-AI behavior in `=== SURVEY ===` before editing.
3. Add the feature registry metadata, i18n toggle copy, and strategy goldens before wiring UI, so the final gate has coverage metadata from the start.
4. Implement the AI backend route(s) only under `/api/v1/ai/...` and wrap each one with `ai.GuardedHandler` for `vehicle-paint-preview`.
5. Implement frontend AI UI as a conditionally rendered wrapped component. Do not grey-disable it in off mode; it must be absent.
6. Implement or register only the tools listed for this feature: draft_paint_preview_prompt. Tools must call existing typed handlers or services; no duplicate write paths.
7. If this feature uses retrieval, call the single F7 retrieval entry point for source types: vehicle_config;user_theme. Do not write bespoke embedding SQL.
8. Add off-mode tests proving the AI route returns 404, the AI component test ID is absent, baseline behavior still works, and no AI job/push/storage artifacts remain.
9. Run the full verification commands and paste raw output into the log with EXIT markers.
10. Commit only if every gate is green. Use the commit message format in the Commit section.

## Tasks

1. Registry: add `vehicle-paint-preview` with display name, description, tier `GEN2`, `DefaultOn: false`, dependency flags, and populated route metadata.
2. Backend: add guarded route(s), handler/service interface, strategy registration, and tests.
3. Tools/RAG: add typed tools or retrieval calls only when required by this prompt; keep them reusable for later slices.
4. Frontend: add wrapped AI component(s), route/page integration, hidden-off behavior, and UI test IDs.
5. i18n: add settings toggle strings and any visible AI-copy strings in all locales.
6. Eval: add at least 3 goldens and deterministic mock-provider canned outputs.
7. Tests: add baseline parity and off-mode invariant tests named above.
8. Log: include the ADR-015 compliance footer with concrete evidence.
<!-- BEGIN: W1 INLINE TASK -->
9. SPA wiring: ship the AI component wired end-to-end to the backend route via `useAiStream`. No placeholder strings, no literal-disabled buttons. Add the on-mode wiring test alongside the existing off-mode test.
<!-- END: W1 INLINE TASK -->
<!-- BEGIN: HX (Helix UX) TASK -->
10. Helix UX scaffold: render the AI surface through `AIFeatureCard`. Pass the per-feature verb as `buttonLabel` (NOT "Ask Helix"). Use `HelixMark` for assistant-identity glyphs; use `AIThinkingDots` for any thinking affordance outside the card. User-visible i18n copy says "Helix" not "AI". Tests locating the CTA use unanchored regexes.
<!-- END: HX (Helix UX) TASK -->

## Allowed files

- `internal/ai/features/registry.go`
- `internal/ai/strategies/vehicle-paint-preview/**`
- `internal/ai/tools/**` only for reusable typed tools required by this slice
- `internal/api/**` only for guarded `/api/v1/ai/...` handlers and tests for this feature
- `internal/jobs/**` only for jobs listed in the Off-mode contract impact section
- `internal/ml/**` only for ML-tier slices or statistical model code explicitly required by this prompt
- `web/src/features/vehicles/**`
- `web/src/components/ai/**` only when adding shared AI UI primitives reused by later slices
- `web/src/i18n/en.json`, `web/src/i18n/ar.json`, `web/src/i18n/he.json`
- `web/src/**/__tests__/**` and `tests/**` only for tests proving this slice
- `.github/prompts/db-refactor/logs/phase-50-0061-vehicle-paint-preview.log`

Do not touch Phase-49 alert-engine files, telemetry ingestion paths, signal pipeline code, SI canonicalization code, or Helm structural files unless this prompt explicitly lists them.

## Verification

Run these commands and paste raw output into `=== GATE ===`:

~~~powershell
git --no-pager status --short
go test -race ./internal/ai/... ./internal/api/...
go run ./tools/aivet
go run ./tools/aigen --check
make ai-eval-fast --feature vehicle-paint-preview
cd web; npx tsc --noEmit; npm run lint; npm test -- --run TestVehiclePaintPreviewAIOffHidesPreviewTool
~~~

Also run a focused off-mode proof and paste evidence:

~~~powershell
# Expected: 404 for every backend route listed in registry for vehicle-paint-preview
# Expected: zero rendered elements for every UI test ID listed above when ai_mode='off'
# Expected: baseline route/page behavior still works with ai_mode='off'
~~~

<!-- BEGIN: W1 INLINE VERIFICATION -->
~~~powershell
# W1 inline self-check: this slice's shipped AI component MUST NOT
# carry any placeholder/deferral strings. Pre-W1 components may still
# show non-zero counts, but this slice's component MUST be 0.
Select-String -Path 'web/src/components/ai/AI*.tsx' -Pattern 'future slice|coming soon|wiring lands|would call POST' | Measure-Object | Select-Object -ExpandProperty Count
# Expected: 0 across this slice's allowed files. After slice 0065 lands, the project-wide count MUST stay at 0 forever.
~~~
<!-- END: W1 INLINE VERIFICATION -->

## Gate

The slice is DONE only if:

1. All verification commands exit 0.
2. The log contains `EXIT=0` and `STATUS=DONE` on their own lines.
3. `TestVehiclePaintPreviewAIOffHidesPreviewTool` proves baseline behavior is exercised when AI is off.
4. `features.CoverageOK()` and `tools/aivet` prove registry route coverage.
5. The strategy has at least 3 goldens and eval runs through the F6 harness.
6. `git status --short` contains only allowed files before commit.
<!-- BEGIN: W1 INLINE GATE -->
7. The slice's SPA component imports `useAiStream`, references the registered backend endpoint, has zero placeholder strings, and the on-mode wiring test passes.
<!-- END: W1 INLINE GATE -->
<!-- BEGIN: HX (Helix UX) GATE -->
8. The slice's SPA component imports `AIFeatureCard` from `@/components/ai/AIFeatureCard` and renders its primary AI surface through it; the per-feature verb is passed via `buttonLabel`; assistant-identity glyphs use `HelixMark` (not lucide `Bot`); on-mode wiring tests use unanchored role-name regexes; user-visible i18n copy added by this slice contains no `"AI "` prefix in a Helix-narrative position.
<!-- END: HX (Helix UX) GATE -->


Any failure means `STATUS=BLOCKED` and only the log may be committed.

## Commit

Commit message:

~~~text
feat(ai): add Vehicle paint preview

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
~~~

The commit MUST include this prompt's production/test changes and its log when DONE. When BLOCKED, commit only the log.

## Blocked Path

If a predecessor foundation layer is missing, a verification command cannot run, or files outside the allowed list are dirty, do not modify production code further. Write the log with:

~~~text
=== STATUS ===
EXIT=1
STATUS=BLOCKED
~~~

Include the precise blocker, the command output, and the next required slice or owner action.

## Deliverable

One commit for Prompt 0061 plus `.github/prompts/db-refactor/logs/phase-50-0061-vehicle-paint-preview.log`, containing the ADR-015 footer:

~~~text
=== AI-OFF CONTRACT ===
I1 default-off:     PASS|FAIL  (evidence)
I3 baseline intact: PASS|FAIL  (evidence)
I4 zero egress:     PASS|FAIL  (evidence)
I5 hidden UI:       PASS|FAIL  (evidence)
I6 404 routes:      PASS|FAIL  (evidence)
I7 per-feature:     PASS|FAIL  (evidence)
I10 type system:    PASS|FAIL  (evidence)
I12 client/bg:      PASS|FAIL  (evidence, when this slice adds chunks/jobs/push/storage)
=======================
~~~

## Forward dependency

The 9999 final gate reads this slice's registry metadata and goldens directly. Future slices may reuse tools, strategies, and UI primitives from this prompt only through shared packages; do not create feature-local duplicates.

