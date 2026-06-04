---
description: "P1/S0-0002 — UI-prompt generator: emit one parity prompt per manifest unit per platform"
---

# P1 · S0-0002 — UI-prompt generator (the prompt factory)

> **Severity:** Foundational (produces the thousands of UI prompts) · **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/tools/gen-ui-prompts.ts` + generated prompt files under `p2-windows/pages/`, `p3-android/pages/`, `p4-apple/pages/` |
| Allowed files | `apps/tools/gen-ui-prompts.*`, `p2-windows/pages/**`, `p3-android/pages/**`, `p4-apple/pages/**`, the log file |
| Depends on | S0-0001 (manifest exists) |
| Blocks | all P2/P3/P4 page prompts |
| ADR refs | ADR-006 (parity), ADR-011 (DoD), ADR-005 (tokens), ADR-002 (native) |
| Log | `../logs/p1-s0-0002-ui-prompt-gen.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Generate **one fully-specified prompt per page-unit per platform** from the parity manifest,
so P2/P3/P4 are populated modularly (not hand-written). Each generated prompt embeds the
unit's exact panels/charts/maps/states/strings/data-sources + the platform template.

## Inputs

- `apps/parity/parity-manifest.json` (S0-0001).
- Three **platform templates** (authored as part of this prompt) under
  `apps/tools/templates/{windows,android,apple}.page.prompt.hbs` encoding the per-platform
  conventions (WinUI3/Fluent, Compose/Material3, SwiftUI/HIG), the shared-core binding, the
  design-token usage, the 3 data states, i18n, a11y, and the `=== PARITY ===` gate.

## Generator behavior

- For each `page` unit, for each platform, render the template into:
  `pNN-<platform>/pages/<area>/<PageId>.prompt.md`, filling:
  - the page's child `panel`/`chart`/`map` units (so the prompt lists every section),
  - `dataSources` (which shared-core state holder / generated client calls to bind),
  - `states` (loading/empty/error required),
  - `strings` (i18n keys to wire),
  - `requiredCount` → the prompt's `PARITY_REQUIRED`,
  - `Depends on`: the platform's shell/nav prompt + the shared-core modules the data needs.
- Emit a per-platform **index** (`pNN-<platform>/pages/INDEX.md`) listing all generated prompts
  in dependency order (foundational pages first: dashboard, vehicle list; detail pages after).
- Idempotent: re-running regenerates deterministically; `--check` mode fails on drift.

## Generated-prompt required sections (each must include)

1. Frontmatter + title + Severity + **inlined Honesty Covenant**.
2. Artifact Metadata (Allowed files scoped to that page's native source dir + the log).
3. The **exact parity unit** (panels/charts/maps/states/strings/data sources) copied in.
4. Platform implementation spec: navigation entry, screen scaffold, each panel as a native
   component bound to the shared core, all 3 states, tokens, i18n, a11y.
5. `=== PARITY ===` section with `PARITY_REQUIRED=<requiredCount>` and the per-item checklist.
6. Gate (platform triad: build + strict lint + test + placeholder gate).
7. Commit + `EXIT=`/`STATUS=` footer.

## Gate

```powershell
npx tsx apps/tools/gen-ui-prompts.ts
$win = (Get-ChildItem p2-windows/pages -Recurse -Filter *.prompt.md).Count
$and = (Get-ChildItem p3-android/pages -Recurse -Filter *.prompt.md).Count
$apl = (Get-ChildItem p4-apple/pages   -Recurse -Filter *.prompt.md).Count
$pages = ((Get-Content apps/parity/parity-manifest.json -Raw | ConvertFrom-Json) | ? kind -eq 'page').Count
"WIN=$win AND=$and APL=$apl PAGES=$pages" | Tee-Object $log -Append
if ($win -ne $pages -or $and -ne $pages -or $apl -ne $pages) { "[FAIL] prompt count != page count" | Tee-Object $log -Append; "EXIT=1" | Tee-Object $log -Append }
else { npx tsx apps/tools/gen-ui-prompts.ts --check; "EXIT=$LASTEXITCODE" | Tee-Object $log -Append }
```

## Acceptance Criteria

- [ ] One prompt per page-unit per platform; counts match the manifest page count exactly.
- [ ] Each generated prompt embeds the real unit data + the 7 required sections + covenant.
- [ ] Per-platform `INDEX.md` in dependency order.
- [ ] `--check` drift mode works.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope (reject)

- Don't implement any app code; this only emits prompts.
- Panel-level and component-level prompts (finer than page) are a later S0 prompt
  (`S0-0003-panel-prompt-generator`) if a page proves too large; default granularity = page.

## Commit

```powershell
git add apps/tools/gen-ui-prompts.ts apps/tools/templates p2-windows/pages p3-android/pages p4-apple/pages .github/prompts/monorepo/logs/p1-s0-0002-ui-prompt-gen.log
git commit -m "feat(apps/tools): per-page UI prompt generator from parity manifest (P1/S0-0002)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
