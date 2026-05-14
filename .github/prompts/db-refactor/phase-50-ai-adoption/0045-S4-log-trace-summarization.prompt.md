---
description: "Phase-50 Prompt 0045 - S4 Log and trace summarization"
---

# Phase-50 / Prompt 0045 - S4: Log and trace summarization

> **Severity:** Feature | **Delegation:** FORBIDDEN
> **Depends on:** 0001-0010 F0-F9 plus 0008 F7
> **Feature ID:** `log-trace-summarization`
> **ADR:** [ADR-015 - AI-Off Contract](../adrs/ADR-015-ai-off-contract.md)

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | `.github/prompts/db-refactor/logs/phase-50-0045-log-trace-summarization.log` |
| Depends-on | 0001-0010 F0-F9 plus 0008 F7 |
| Registry tier | S4 |
| Backend routes | POST /api/v1/ai/system/logs/summarize |
| Frontend routes | /system/logs |
| UI test IDs | ai-feature-log-trace-summarization-root |
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

Summarize redacted logs and traces while preserving raw log inspection.

The current non-AI behavior must remain the canonical baseline for users with `settings.ai_mode='off'`. This slice may add an AI surface only through the Phase-50 foundation: feature registry (P9), backend guard (P6), frontend `withAiFeature`/`useAiEnabled` (P6), provider port (P1), strategy/dispatcher loop (P4), decorator chain (P5), and eval goldens (P8).

## Evidence

- Baseline implementation to preserve: Existing logs/traces tables and manual filtering
- AI implementation to add: internal/ai/strategies/log-trace-summarization Strategy summarizing redacted log windows
- Existing route/page must keep working when AI is off: /system/logs
- New AI backend surface must return 404 when `ai_mode='off'`: POST /api/v1/ai/system/logs/summarize
- Registry metadata must be complete so the final gate can prove absence in off mode.

## Design

1. Register feature `log-trace-summarization` in `internal/ai/features/registry.go` with `DefaultOn: false` and explicit `Routes` metadata. Empty arrays must be explicit, not omitted.
2. Implement the AI path as a strategy under `internal/ai/strategies/log-trace-summarization/**`; do not import provider adapters directly from feature code.
3. Preserve the baseline implementation and select between baseline and AI through an interface at construction or page composition time; do not branch inside business logic.
4. Route every provider call through the decorator chain in the locked order from the methodology: redaction, rate limit, cost cap, audit, trace.
5. Route every mutation proposal through F4 tools and existing typed DTO validation. The LLM never writes raw SQL and never bypasses existing handlers.
6. Add at least 3 deterministic goldens in `internal/ai/strategies/log-trace-summarization/goldens.yaml`, plus canned mock-provider responses when required by F6.
7. Add i18n toggle copy in `web/src/i18n/en.json`, `web/src/i18n/ar.json`, and `web/src/i18n/he.json`.
8. Add the `data-testid` root marker(s) listed below and wrap AI-only React components with `withAiFeature('log-trace-summarization', Component)`.

## Baseline coexistence (P10)

- Baseline impl:        Existing logs/traces tables and manual filtering
- AI impl:              internal/ai/strategies/log-trace-summarization Strategy summarizing redacted log windows
- Selection mechanism:  LogTraceSummarizer is selected by ai_mode plus log-trace-summarization toggle; raw logs remain baseline
- Off-mode test:        TestLogTraceSummarizationAIOffShowsRawLogsOnly

## Redaction policy (F8)

- Policy:              PolicyChatbot from `internal/ai/redact/policies.go`
- Allowed classes:     none; logs are structurally redacted before any provider call
- Round-trip required: yes

## Off-mode contract impact

- Backend routes added:     POST /api/v1/ai/system/logs/summarize
- Frontend routes affected: /system/logs
- UI test IDs:             ai-feature-log-trace-summarization-root
- New background jobs:      ai_log_trace_indexer
- New push kinds:           none
- Service worker chunks:    ai-log-trace-summarization
- Client storage keys:      none

## Registry metadata contribution

Add or extend the `log-trace-summarization` registry entry with all fields populated:

~~~go
Routes: features.RouteSet{
    Backend:   []string{"POST /api/v1/ai/system/logs/summarize"},
    Frontend:  []string{"/system/logs"},
    UITestIDs: []string{"ai-feature-log-trace-summarization-root"},
    JobNames:  []string{"ai_log_trace_indexer"},
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
   **`POST /api/v1/ai/system/logs/summarize`**, so the SPA `url` is **`/ai/system/logs/summarize`**
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
6. On unmount, on `useAiEnabled('log-trace-summarization')` flip to `false`, on
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

Add `TestLogTraceSummarizationAIOnWiredCallsRoute` (or the feature-specific variant implied by this
slice's existing test naming) proving:

- With `ai_mode='local'` and the `log-trace-summarization` toggle on, invoking
  the primary action enqueues **exactly one** POST against the
  registered backend route `POST /api/v1/ai/system/logs/summarize` and consumes the SSE
  stream (use the existing mock-provider harness from F6).
- The first `delta` event's text is rendered inside the AI panel
  via the `data-testid="ai-feature-log-trace-summarization-root"` marker.
- A second click while `aiStream.state === 'streaming'` is a no-op
  (double-submit guard).
- For proposal / suggestion render contracts: clicking "Apply to
  form" copies the typed draft into the baseline form's state, AND
  clicking the baseline Save button is what triggers the typed
  write handler (spy on the baseline mutation hook, not the AI
  stream).
- The existing off-mode test `TestLogTraceSummarizationAIOffShowsRawLogsOnly` continues to pass
  unchanged ΓÇö wiring MUST NOT regress the off-mode absence
  invariant.

<!-- END: W1 INLINE WIRING ADDENDUM -->

## Action Steps

1. In `=== PREFLIGHT ===`, verify every predecessor listed in Depends-on has a log ending in STATUS=DONE. If any predecessor is missing or blocked, stop after writing a BLOCKED log.
2. Survey the baseline route/page and write down the current non-AI behavior in `=== SURVEY ===` before editing.
3. Add the feature registry metadata, i18n toggle copy, and strategy goldens before wiring UI, so the final gate has coverage metadata from the start.
4. Implement the AI backend route(s) only under `/api/v1/ai/...` and wrap each one with `ai.GuardedHandler` for `log-trace-summarization`.
5. Implement frontend AI UI as a conditionally rendered wrapped component. Do not grey-disable it in off mode; it must be absent.
6. Implement or register only the tools listed for this feature: retrieve_log_chunks;query_trace_window. Tools must call existing typed handlers or services; no duplicate write paths.
7. If this feature uses retrieval, call the single F7 retrieval entry point for source types: log_event;trace_span. Do not write bespoke embedding SQL.
8. Add off-mode tests proving the AI route returns 404, the AI component test ID is absent, baseline behavior still works, and no AI job/push/storage artifacts remain.
9. Run the full verification commands and paste raw output into the log with EXIT markers.
10. Commit only if every gate is green. Use the commit message format in the Commit section.

## Tasks

1. Registry: add `log-trace-summarization` with display name, description, tier `S4`, `DefaultOn: false`, dependency flags, and populated route metadata.
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

## Allowed files

- `internal/ai/features/registry.go`
- `internal/ai/strategies/log-trace-summarization/**`
- `internal/ai/tools/**` only for reusable typed tools required by this slice
- `internal/api/**` only for guarded `/api/v1/ai/...` handlers and tests for this feature
- `internal/jobs/**` only for jobs listed in the Off-mode contract impact section
- `internal/ml/**` only for ML-tier slices or statistical model code explicitly required by this prompt
- `web/src/features/system/**`
- `web/src/components/ai/**` only when adding shared AI UI primitives reused by later slices
- `web/src/i18n/en.json`, `web/src/i18n/ar.json`, `web/src/i18n/he.json`
- `web/src/**/__tests__/**` and `tests/**` only for tests proving this slice
- `.github/prompts/db-refactor/logs/phase-50-0045-log-trace-summarization.log`

Do not touch Phase-49 alert-engine files, telemetry ingestion paths, signal pipeline code, SI canonicalization code, or Helm structural files unless this prompt explicitly lists them.

## Verification

Run these commands and paste raw output into `=== GATE ===`:

~~~powershell
git --no-pager status --short
go test -race ./internal/ai/... ./internal/api/...
go run ./tools/aivet
go run ./tools/aigen --check
make ai-eval-fast --feature log-trace-summarization
cd web; npx tsc --noEmit; npm run lint; npm test -- --run TestLogTraceSummarizationAIOffShowsRawLogsOnly
~~~

Also run a focused off-mode proof and paste evidence:

~~~powershell
# Expected: 404 for every backend route listed in registry for log-trace-summarization
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
3. `TestLogTraceSummarizationAIOffShowsRawLogsOnly` proves baseline behavior is exercised when AI is off.
4. `features.CoverageOK()` and `tools/aivet` prove registry route coverage.
5. The strategy has at least 3 goldens and eval runs through the F6 harness.
6. `git status --short` contains only allowed files before commit.
<!-- BEGIN: W1 INLINE GATE -->
7. The slice's SPA component imports `useAiStream`, references the registered backend endpoint, has zero placeholder strings, and the on-mode wiring test passes.
<!-- END: W1 INLINE GATE -->


Any failure means `STATUS=BLOCKED` and only the log may be committed.

## Commit

Commit message:

~~~text
feat(ai): add Log and trace summarization

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

One commit for Prompt 0045 plus `.github/prompts/db-refactor/logs/phase-50-0045-log-trace-summarization.log`, containing the ADR-015 footer:

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

