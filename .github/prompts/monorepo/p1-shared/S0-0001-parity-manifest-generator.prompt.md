---
description: "P1/S0-0001 — Parity manifest generator: scan web/src into apps/parity/parity-manifest.json"
---

# P1 · S0-0001 — Parity manifest generator

> **Severity:** Foundational (spine of parity) · **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/tools/gen-parity-manifest.ts` (+ runner) and `apps/parity/parity-manifest.json` |
| Allowed files | `apps/tools/gen-parity-manifest.*`, `apps/parity/parity-manifest.json`, the log file |
| Depends on | P0/0008 (parity schema), P0/0099 (gate DONE) |
| Blocks | S0-0002 (prompt generator), every P2/P3/P4 UI prompt |
| ADR refs | ADR-006 (parity methodology), ADR-011 (DoD) |
| Log | `../logs/p1-s0-0001-manifest-gen.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Logging

`=== PREFLIGHT ===` · `=== SURVEY ===` (counts of routes/features/hooks found) ·
`=== REASONING ===` · `=== CHANGES ===` · `=== GATE ===` · `=== COMMIT ===`.

## Single Goal

Build a generator that statically scans `web/src` and emits `parity-manifest.json`
conforming to `apps/parity/manifest.schema.json` — one unit per route, page, panel,
chart, map, API call, and i18n string-group — so parity becomes data, not opinion.

## What to scan (exact sources in this repo)

1. **Routes** — the router (e.g. `web/src/App.tsx` / route config / `react-router` routes):
   map each path → its lazy-loaded page component.
2. **Pages** — `web/src/features/<area>/pages/*.tsx` (21 areas, ~162 files). One `page` unit each.
3. **Panels/sections** — within each page, every `<GlassPanel>`, `<ChartContainer>`,
   `<Card>`, `<StatCard>`/section heading → one `panel` unit, parented to the page.
4. **Charts** — every `@/components/charts` usage (LineChart, RadialGauge, Sparkline…) → `chart` unit.
5. **Maps** — every `@/components/maps` usage → `map` unit.
6. **API calls** — every `@/api/hooks/use*` referenced by the page → `api` unit with the
   hook name, resolved endpoint path, and query params (read from the hook source).
7. **States** — detect loading/empty/error handling per data source → `states` array.
8. **Strings** — every `t('key', 'default')` call → collect keys into a `string-group` unit per page.

For each unit compute `requiredCount = panels + charts + maps + states + strings`.

## Implementation

- Language: TypeScript run via `npx tsx` (web toolchain already present). Use the TS compiler
  API or `ts-morph` for robust AST parsing (NOT regex) to find components, hooks, and `t()` calls.
- Resolve hook→endpoint by parsing each `use*.ts` for the `request('/...')` path + params.
- Output stable, sorted JSON; ids like `page:charging/ChargingDetail`, `panel:charging/ChargingDetail#SessionSummary`.
- Provide `--check` mode: regenerate to a temp file and diff against committed manifest; non-zero on drift (for CI).

## Gate

```powershell
npx tsx apps/tools/gen-parity-manifest.ts            # writes apps/parity/parity-manifest.json
$man = Get-Content apps/parity/parity-manifest.json -Raw | ConvertFrom-Json
"UNIT_COUNT=$($man.Count)" | Tee-Object $log -Append
$pages = ($man | Where-Object kind -eq 'page').Count
"PAGE_COUNT=$pages" | Tee-Object $log -Append
# Must find a page unit for every feature page file on disk
$diskPages = (Get-ChildItem web/src/features -Recurse -Filter *.tsx | Where-Object FullName -match '\\pages\\').Count
"DISK_PAGE_FILES=$diskPages" | Tee-Object $log -Append
if ($pages -lt [math]::Floor($diskPages * 0.95)) { "[FAIL] manifest missed pages" | Tee-Object $log -Append; "EXIT=1" | Tee-Object $log -Append }
else { npx tsx apps/tools/gen-parity-manifest.ts --check; "EXIT=$LASTEXITCODE" | Tee-Object $log -Append }
```

## Acceptance Criteria

- [ ] Generator uses AST parsing (not regex) and resolves hooks→endpoints.
- [ ] `parity-manifest.json` validates against `manifest.schema.json`.
- [ ] `PAGE_COUNT` ≥ 95% of page files on disk; panels/charts/apis/strings populated.
- [ ] `--check` drift mode works (exit non-zero on drift) — wired into `apps-shared.yml` later.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope (reject)

- No native code. No editing `web/**` (read-only scan).
- Don't hand-write manifest entries — they MUST come from the scanner.

## Commit

```powershell
git add apps/tools/gen-parity-manifest.ts apps/parity/parity-manifest.json .github/prompts/monorepo/logs/p1-s0-0001-manifest-gen.log
git commit -m "feat(apps/parity): web parity manifest generator + manifest (P1/S0-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
