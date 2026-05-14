---
description: "Phase-50 / Prompt 0003 — F2: Settings UI for AI"
---

# Phase-50 / Prompt 0003 — F2: Settings UI for AI

## Artifact Metadata

| Field | Value |
|---|---|
| Log path | .github/prompts/db-refactor/logs/phase-50-0003-F2-settings-ui.log |
| Depends-on | See this prompt header and Phase-50 methodology. |
| Allowed files to change | See the **Allowed files** section below; methodology-only edits may change only Phase-50 prompt/ADR artifacts. |

## Honesty Covenant

1. No red-as-green - EXIT != 0 -> STATUS=BLOCKED, no exceptions
2. No scope narrowing - run the exact gate command, no subsets
3. No skip-and-assume - can't run gate -> BLOCKED, never DONE
4. No field resurrection - don't add back deleted fields to "fix" things
5. No stubs - no eturn nil, // TODO, panic("not impl")
6. No delegation - NO sub-agents, NO parallel, NO background tasks
7. No predecessor bypass - verify predecessor STATUS=DONE first
8. No commit on red - commit only the log when BLOCKED
9. No silent drift - git status outside allowed files -> BLOCKED
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on own lines

## Logging Requirements

The slice log MUST include these sections, in order:

| Section | Purpose |
|---|---|
| === PREFLIGHT === | Branch, predecessor logs, and dirty-tree check. |
| === SURVEY === | Files, routes, DTOs, hooks, registry entries, and baseline behavior inspected before edits. |
| === REASONING === | Why the selected design preserves ADR-015 and the Phase-50 methodology. |
| === CHANGES === | Summary of production, test, registry, i18n, prompt, and golden changes. |
| === GATE === | Full command transcripts with EXIT markers. |
| === COMMIT === | git add/commit transcript, or blocked-log-only commit transcript. |
| === AI-OFF CONTRACT === | ADR-015 footer with evidence for every invariant this slice touches. |
| === STATUS === | Final EXIT=<int> and STATUS=<DONE|BLOCKED> markers on their own lines. |

## Problem

This Phase-50 foundation or gate prompt must preserve ADR-015: AI is additive, default-off, and every non-AI baseline remains available. Execute the slice without adding unguarded AI surfaces, duplicate provider logic, raw SQL mutation paths, or hidden egress.

## Action Steps

1. Read ADR-015 and this prompt before making any changes.
2. Verify predecessor logs and branch state in === PREFLIGHT ===.
3. Survey the current code and document the baseline in === SURVEY === before editing.
4. Make only the changes allowed by this prompt and preserve the non-AI baseline.
5. Run every verification command exactly as written and paste raw output into === GATE ===.
6. If any gate fails, stop with STATUS=BLOCKED and commit only the log.

## Gate

The prompt is DONE only if every required verification command exits 0, the log contains EXIT=0 and STATUS=DONE on their own lines, the ADR-015 footer is present with evidence, and git status --short contains only allowed files before commit.

## Commit

Use a conventional commit for this slice and include the required trailer:

~~~text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
~~~

## Blocked Path

If a predecessor is missing, verification cannot run, or any gate fails, write the log with:

~~~text
=== STATUS ===
EXIT=1
STATUS=BLOCKED
~~~

Commit only the blocked log and include the command output that proves the blocker.

> **Depends on:** F0 (registry, guard, hook), F1 (provider list)
> **Reads:** ADR-015 §I7 (per-feature opt-in), §I9 (key never displayed in off mode)

## Why

Users need a single place to enable AI, pick their provider, manage
keys, and toggle individual features. Per ADR-015, this UI is the
**only** place AI ever turns on; the backend never silently
auto-enables anything.

## Design

### D3.1 Settings panel layout

```
┌ Settings → AI ─────────────────────────────────────────┐
│ Mode: ( ) Off (default)   ( ) Local-only   ( ) Cloud   │
│                                                         │
│  When OFF (default):                                    │
│    "AI features are off. Your app works fully           │
│     without them. Enable a mode above to opt in."       │
│                                                         │
│  When LOCAL or CLOUD:                                   │
│    Provider: [Ollama ▾]   Base URL: [____________]      │
│    Model:   [llama3.1:8b ▾]                             │
│    API key: [••••••••••] (cloud only)                  │
│    Daily cost cap: [$5.00] (cloud only)                 │
│                                                         │
│    Per-feature opt-in (all default off):                │
│    [ ] LLM Chatbot                                      │
│    [ ] Weekly digest narration                          │
│    [ ] Year-in-review narration                         │
│    [ ] Anomaly explanations                             │
│    [ ] NL alert builder                                 │
│    ...                                                  │
│                                                         │
│  Usage today: 1,243 in / 587 out tokens   $0.0024       │
└─────────────────────────────────────────────────────────┘
```

### D3.2 Components (DRY: generated from registry P9)

`web/src/features/settings/components/AISettings.tsx`:

- Mode picker (radio, 3 options, default 'off').
- Provider section (visible only when mode != off).
- Per-feature checkbox list **generated by mapping over
  `AI_FEATURES`** — never hand-listed. Adding a feature in F0's
  registry automatically adds the toggle here.
- Live usage card (consumes `useAiUsage()` from F3).

### D3.3 Form behaviour

- API-key input is `type="password"` and never receives initial
  value when `ai_mode='off'` (ADR-015 §I9). Settings response DTO
  in F0 already redacts; the form must not request it either.
- Mode change to 'off' clears all per-feature toggles client-side
  (visual confirmation) AND **archives the prior per-feature map** to
  `ai_features_archived` server-side. **Restoring on re-enable is a
  manual review screen, NEVER a silent restore** (per ADR-015 §I7,
  enabling a mode does not auto-enable any feature). On the next
  switch back to local/cloud, the user sees the archived choices as
  pre-checked _suggestions_ in a "Restore previous selection?" panel
  with explicit Confirm/Decline buttons; nothing is enabled until
  Confirm is pressed.
- Mode change to 'local' validates `base_url` against
  `ValidateLocal` via a new endpoint `/api/v1/ai/_internal/validate-config`.
- Settings save is atomic — either everything or nothing. PUT to
  `/api/v1/settings` (existing).

### D3.4 i18n keys

All under `ai.settings.*`:
- `ai.settings.mode.off`, `.local`, `.cloud`
- `ai.settings.bannerOff`
- `ai.settings.provider.label`
- `ai.settings.feature.<feature-id>.label` and `.description` —
  generated from registry; missing translations fall back to
  `Feature.Name` / `Feature.Description`.

### D3.5 Discoverability

- Settings sidebar shows "AI" entry with a small dot indicator when
  mode is off (subtle invitation, NOT nag).
- Onboarding wizard skips AI step entirely; AI is opt-in **after**
  onboarding only.

## Tasks

1. Build `AISettings.tsx`, sub-components.
2. Build `useAiSettings` mutation hook.
3. Build provider-config validate endpoint
   `internal/api/ai_settings_validate_handler.go` (admin-only? no —
   user-only since each user has their own settings). Guarded by
   F0's `guard.Wrap("__settings__")`? No — validation endpoint must
   work in OFF mode too (so user can set things). Use a separate
   `guard.WrapValidating()` that requires authenticated user but
   not feature flag.
4. Settings handler: when mode flips off → cleanly clear per-feature
   `ai_features` JSON (preserve to a sidecar `ai_features_archived`
   so re-enable restores).
5. i18n keys + EN translations.
6. Tests: form behaviour, off-mode redaction, local-mode validator
   integration.

## Allowed files

- `web/src/features/settings/components/AISettings.tsx` and
  sub-components under same dir
- `web/src/features/settings/components/__tests__/AISettings.test.tsx`
- `web/src/features/settings/pages/SettingsPage.tsx` (add nav entry)
- `web/src/i18n/en.json` (add `ai.settings.*` keys)
- `web/src/api/hooks/useAiSettings.ts` (+ test)
- `internal/api/ai_settings_validate_handler.go` (+ test)
- `internal/api/router.go` (register route)
- `internal/api/settings_handler.go` (archive logic on mode flip)
- `internal/database/settings_repo.go` (add archive column +
  migration `000197_ai_features_archive.up.sql`)

## Verification

```
go test ./internal/api/... -run AISettings
cd web && npm test -- --run AISettings
cd web && npx tsc --noEmit

# Manual:
# 1. Mode=off → no API key visible in DevTools network tab
# 2. Mode=cloud → enter key → Save → mode=off → key NOT in response
# 3. Mode=local → base_url=http://1.2.3.4:11434 → validate fails
# 4. Mode=local → base_url=http://localhost:11434 → validate passes
```

## Deliverable

Log includes ADR-015 footer (I1, I7, I9 PASS).

## Forward dependency

Every feature slice references `ai.settings.feature.<id>.label` for
its toggle copy.

