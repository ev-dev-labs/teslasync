---
description: "Phase-50 Prompt 0031 - T1 Preheat and precool recommender"
---

# Phase-50 / Prompt 0031 - T1: Preheat and precool recommender

> **Severity:** Feature | **Delegation:** FORBIDDEN
> **Depends on:** 0001-0010 F0-F9 plus 0005 F4
> **Feature ID:** `preheat-precool-recommender`
> **ADR:** [ADR-015 - AI-Off Contract](../adrs/ADR-015-ai-off-contract.md)

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | `.github/prompts/db-refactor/logs/phase-50-0031-preheat-precool-recommender.log` |
| Depends-on | 0001-0010 F0-F9 plus 0005 F4 |
| Registry tier | T1 |
| Backend routes | POST /api/v1/ai/climate/schedule/draft |
| Frontend routes | /climate |
| UI test IDs | ai-feature-preheat-precool-recommender-root |
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

Suggest preheat or precool schedules while requiring confirmation before creating any schedule.

The current non-AI behavior must remain the canonical baseline for users with `settings.ai_mode='off'`. This slice may add an AI surface only through the Phase-50 foundation: feature registry (P9), backend guard (P6), frontend `withAiFeature`/`useAiEnabled` (P6), provider port (P1), strategy/dispatcher loop (P4), decorator chain (P5), and eval goldens (P8).

## Evidence

- Baseline implementation to preserve: Manual climate schedule controls and deterministic departure heuristics
- AI implementation to add: internal/ai/strategies/preheat-precool-recommender Strategy proposing climate schedule DTOs
- Existing route/page must keep working when AI is off: /climate
- New AI backend surface must return 404 when `ai_mode='off'`: POST /api/v1/ai/climate/schedule/draft
- Registry metadata must be complete so the final gate can prove absence in off mode.

## Design

1. Register feature `preheat-precool-recommender` in `internal/ai/features/registry.go` with `DefaultOn: false` and explicit `Routes` metadata. Empty arrays must be explicit, not omitted.
2. Implement the AI path as a strategy under `internal/ai/strategies/preheat-precool-recommender/**`; do not import provider adapters directly from feature code.
3. Preserve the baseline implementation and select between baseline and AI through an interface at construction or page composition time; do not branch inside business logic.
4. Route every provider call through the decorator chain in the locked order from the methodology: redaction, rate limit, cost cap, audit, trace.
5. Route every mutation proposal through F4 tools and existing typed DTO validation. The LLM never writes raw SQL and never bypasses existing handlers.
6. Add at least 3 deterministic goldens in `internal/ai/strategies/preheat-precool-recommender/goldens.yaml`, plus canned mock-provider responses when required by F6.
7. Add i18n toggle copy in `web/src/i18n/en.json`, `web/src/i18n/ar.json`, and `web/src/i18n/he.json`.
8. Add the `data-testid` root marker(s) listed below and wrap AI-only React components with `withAiFeature('preheat-precool-recommender', Component)`.

## Baseline coexistence (P10)

- Baseline impl:        Manual climate schedule controls and deterministic departure heuristics
- AI impl:              internal/ai/strategies/preheat-precool-recommender Strategy proposing climate schedule DTOs
- Selection mechanism:  ClimateScheduleAdvisor is selected by ai_mode plus preheat-precool-recommender toggle; manual schedule remains baseline
- Off-mode test:        TestPreheatPrecoolAIOffManualClimateWorks

## Redaction policy (F8)

- Policy:              PolicyDigest from `internal/ai/redact/policies.go`
- Allowed classes:     ClassVehicleName only; departure places remain tagged
- Round-trip required: yes

## Off-mode contract impact

- Backend routes added:     POST /api/v1/ai/climate/schedule/draft
- Frontend routes affected: /climate
- UI test IDs:             ai-feature-preheat-precool-recommender-root
- New background jobs:      none
- New push kinds:           none
- Service worker chunks:    ai-preheat-precool-recommender
- Client storage keys:      ai.preheatPrecool.draft

## Registry metadata contribution

Add or extend the `preheat-precool-recommender` registry entry with all fields populated:

~~~go
Routes: features.RouteSet{
    Backend:   []string{"POST /api/v1/ai/climate/schedule/draft"},
    Frontend:  []string{"/climate"},
    UITestIDs: []string{"ai-feature-preheat-precool-recommender-root"},
    JobNames:  []string{},
    PushKinds: []string{},
}
~~~

If a surface is truly absent, use `[]string{}` in the implementation instead of omitting the field.

## Action Steps

1. In `=== PREFLIGHT ===`, verify every predecessor listed in Depends-on has a log ending in STATUS=DONE. If any predecessor is missing or blocked, stop after writing a BLOCKED log.
2. Survey the baseline route/page and write down the current non-AI behavior in `=== SURVEY ===` before editing.
3. Add the feature registry metadata, i18n toggle copy, and strategy goldens before wiring UI, so the final gate has coverage metadata from the start.
4. Implement the AI backend route(s) only under `/api/v1/ai/...` and wrap each one with `ai.GuardedHandler` for `preheat-precool-recommender`.
5. Implement frontend AI UI as a conditionally rendered wrapped component. Do not grey-disable it in off mode; it must be absent.
6. Implement or register only the tools listed for this feature: draft_climate_schedule;validate_climate_schedule. Tools must call existing typed handlers or services; no duplicate write paths.
7. If this feature uses retrieval, call the single F7 retrieval entry point for source types: climate_state;departure_history;weather_context. Do not write bespoke embedding SQL.
8. Add off-mode tests proving the AI route returns 404, the AI component test ID is absent, baseline behavior still works, and no AI job/push/storage artifacts remain.
9. Run the full verification commands and paste raw output into the log with EXIT markers.
10. Commit only if every gate is green. Use the commit message format in the Commit section.

## Tasks

1. Registry: add `preheat-precool-recommender` with display name, description, tier `T1`, `DefaultOn: false`, dependency flags, and populated route metadata.
2. Backend: add guarded route(s), handler/service interface, strategy registration, and tests.
3. Tools/RAG: add typed tools or retrieval calls only when required by this prompt; keep them reusable for later slices.
4. Frontend: add wrapped AI component(s), route/page integration, hidden-off behavior, and UI test IDs.
5. i18n: add settings toggle strings and any visible AI-copy strings in all locales.
6. Eval: add at least 3 goldens and deterministic mock-provider canned outputs.
7. Tests: add baseline parity and off-mode invariant tests named above.
8. Log: include the ADR-015 compliance footer with concrete evidence.

## Allowed files

- `internal/ai/features/registry.go`
- `internal/ai/strategies/preheat-precool-recommender/**`
- `internal/ai/tools/**` only for reusable typed tools required by this slice
- `internal/api/**` only for guarded `/api/v1/ai/...` handlers and tests for this feature
- `internal/jobs/**` only for jobs listed in the Off-mode contract impact section
- `internal/ml/**` only for ML-tier slices or statistical model code explicitly required by this prompt
- `web/src/features/climate/**`
- `web/src/components/ai/**` only when adding shared AI UI primitives reused by later slices
- `web/src/i18n/en.json`, `web/src/i18n/ar.json`, `web/src/i18n/he.json`
- `web/src/**/__tests__/**` and `tests/**` only for tests proving this slice
- `.github/prompts/db-refactor/logs/phase-50-0031-preheat-precool-recommender.log`

Do not touch Phase-49 alert-engine files, telemetry ingestion paths, signal pipeline code, SI canonicalization code, or Helm structural files unless this prompt explicitly lists them.

## Verification

Run these commands and paste raw output into `=== GATE ===`:

~~~powershell
git --no-pager status --short
go test -race ./internal/ai/... ./internal/api/...
go run ./tools/aivet
go run ./tools/aigen --check
make ai-eval-fast --feature preheat-precool-recommender
cd web; npx tsc --noEmit; npm run lint; npm test -- --run TestPreheatPrecoolAIOffManualClimateWorks
~~~

Also run a focused off-mode proof and paste evidence:

~~~powershell
# Expected: 404 for every backend route listed in registry for preheat-precool-recommender
# Expected: zero rendered elements for every UI test ID listed above when ai_mode='off'
# Expected: baseline route/page behavior still works with ai_mode='off'
~~~

## Gate

The slice is DONE only if:

1. All verification commands exit 0.
2. The log contains `EXIT=0` and `STATUS=DONE` on their own lines.
3. `TestPreheatPrecoolAIOffManualClimateWorks` proves baseline behavior is exercised when AI is off.
4. `features.CoverageOK()` and `tools/aivet` prove registry route coverage.
5. The strategy has at least 3 goldens and eval runs through the F6 harness.
6. `git status --short` contains only allowed files before commit.

Any failure means `STATUS=BLOCKED` and only the log may be committed.

## Commit

Commit message:

~~~text
feat(ai): add Preheat and precool recommender

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

One commit for Prompt 0031 plus `.github/prompts/db-refactor/logs/phase-50-0031-preheat-precool-recommender.log`, containing the ADR-015 footer:

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

