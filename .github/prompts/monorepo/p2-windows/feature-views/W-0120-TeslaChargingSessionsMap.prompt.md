---
description: "P2/feature-views/0120 — Feature view: TeslaChargingSessionsMap"
---

# P2 · Feature view · 0120 — `TeslaChargingSessionsMap` (Windows)

> **Severity:** Per-surface parity · **Delegation:** FORBIDDEN
> **Capability:** requires WinUI 3 (Windows App SDK 1.6+) + .NET 10, Fluent Design System. If unavailable on the runner → STATUS=BLOCKED with API evidence.
> **Web source:** `features/charging/pages/TeslaChargingSessionsMap.tsx` — this is THE specification; native must reproduce its data, composition, states, and i18n keys.

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Artifact Metadata

| Field | Value |
|---|---|
| Tier | Feature view (composed feature component below page level) |
| Web source | `features/charging/pages/TeslaChargingSessionsMap.tsx` |
| Native output | `apps/windows/TeslaSync.App/feature-views/TeslaChargingSessionsMap.* ` |
| Allowed files | `apps/windows/TeslaSync.App/feature-views/TeslaChargingSessionsMap.*`, the log file |
| Depends on | P2 core (theme, nav, live, cache, state-holders), P1/S8 state holders, P1/S9 tokens, P1/S10 i18n |
| Blocks | P2 acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-009 |
| Log | `../logs/p2-windows-feature-views-0120-TeslaChargingSessionsMap.log` |

## Single Goal

Ship a production-polished, native Windows-idiomatic version of `TeslaChargingSessionsMap` at parity with the web source. No stubs, no placeholder, no skeleton-only.

## Data sources (from web source — bind via shared P1/S8 state holders)

- `useCharging`
- `useTranslation`
- `useFormatting`

## Shared components used (from web source — must map to native counterparts)

- `@/components/maps`

## Charts / maps used (from web source — native chart + map per Windows guidelines)

- _(none)_

> Map: web Recharts → WinUI Community Toolkit charts / CommunityToolkit.Labs.WinUI.Charts.
> Map: web Leaflet → WinUI Map control (MapControl).

## Titles / labels / i18n keys extracted from source

- `Unknown`
- `{{name}} charging session`
- `Charging sessions map`

> All listed strings MUST resolve through the P1/S10 i18n facade. No English literals in native code.

## States (every state MUST render — no hidden surfaces)

- `loading` — initial fetch, skeleton chrome
- `empty` — data resolved, no rows / no value → friendly empty state, never a blank box
- `error` — fetch failed → `QueryError` equivalent with retry affordance
- `stale` — query data is older than freshness window → stale chip + auto-refresh
- `offline` — no connectivity → cached value + offline chip
- _(plus any state-specific branches that exist in the web source — read it and reproduce them all)_

## Implementation spec

1. **Read the web source** at `features/charging/pages/TeslaChargingSessionsMap.tsx` end-to-end before writing native code. Note every conditional render branch and every `t()` call.
2. **Bind data** via the shared state-holder for each hook listed above (P1/S8). No direct HTTP from the view.
3. **Compose layout** with native primitives per Windows HIG (WinUI 3 (Windows App SDK 1.6+) + .NET 10, Fluent Design System). Do not port web Tailwind classes — use platform tokens (P1/S9).
4. **States**: render every state listed above. Test all branches.
5. **i18n**: every string from P1/S10 keys; no hardcoded English.
6. **Accessibility**: Narrator labels, system font scale, reduced-motion media query; Windows 11 minimums.
7. **Tests**: unit test the data adapter (cached → projection), snapshot test the view in each state, accessibility test for label presence.
8. **Telemetry**: emit a `view.opened` event with the surface slug `TeslaChargingSessionsMap` per P1/S11 diagnostics contract.

## Out of Scope

- Other surfaces in the same feature (each has its own prompt)
- Backend / API changes
- Atomic shared components (covered by P2 component-library bundle prompt)

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-windows-feature-views-0120-TeslaChargingSessionsMap.log"
"=== P2 Feature view 0120 TeslaChargingSessionsMap (Windows) ===" | Tee-Object $log
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append; "BUILD_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
dotnet test  apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append; "TEST_EXIT=$LASTEXITCODE"  | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE"| Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows/TeslaSync.App/feature-views/TeslaChargingSessionsMap *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only when every step above is 0
```

## Acceptance Criteria

- [ ] Surface renders on Windows with all states from the web source reproduced.
- [ ] Hooks bind to the shared P1/S8 state-holder layer; no direct HTTP from the view.
- [ ] Every i18n key from source has a matching key in P1/S10 catalog.
- [ ] Accessibility labels present on every interactive element.
- [ ] Tests: adapter unit test + per-state snapshot/UI test + a11y label test.
- [ ] No `TODO` / `stub` / `mock` / `placeholder` / `Lorem` in shipped code.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` with platform-capability evidence in the log).

## Commit

```powershell
git add apps/windows/TeslaSync.App/feature-views/TeslaChargingSessionsMap .github/prompts/monorepo/logs/p2-windows-feature-views-0120-TeslaChargingSessionsMap.log
git commit -m "feat(apps/windows/feature-views): add TeslaChargingSessionsMap surface (P2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
