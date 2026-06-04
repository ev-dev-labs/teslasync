---
description: "P4/dashboard-widgets/0080 — Dashboard widget: RecentlyUnlockedAchievements"
---

# P4 · Dashboard widget · 0080 — `RecentlyUnlockedAchievements` (Apple)

> **Severity:** Per-surface parity · **Delegation:** FORBIDDEN
> **Capability:** requires SwiftUI + Swift Charts + MapKit, iOS 18 / iPadOS 18 / macOS 15 HIG. If unavailable on the runner → STATUS=BLOCKED with API evidence.
> **Web source:** `features/dashboard/widgets/RecentlyUnlockedAchievements.tsx` — this is THE specification; native must reproduce its data, composition, states, and i18n keys.

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Artifact Metadata

| Field | Value |
|---|---|
| Tier | Dashboard widget (composable dashboard panel (user-draggable)) |
| Web source | `features/dashboard/widgets/RecentlyUnlockedAchievements.tsx` |
| Native output | `apps/apple/TeslaSync/dashboard-widgets/RecentlyUnlockedAchievements.* ` |
| Allowed files | `apps/apple/TeslaSync/dashboard-widgets/RecentlyUnlockedAchievements.*`, the log file |
| Depends on | P4 core (theme, nav, live, cache, state-holders), P1/S8 state holders, P1/S9 tokens, P1/S10 i18n |
| Blocks | P4 acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-009, ADR-013 |
| Log | `../logs/p4-apple-dashboard-widgets-0080-RecentlyUnlockedAchievements.log` |

## Registry metadata (canonical — from web/src/features/dashboard/widgets/registry/analytics.ts)

| Field | Value |
|---|---|
| Registry ID | `recently-unlocked-achievements` |
| Display name | Recently Unlocked |
| Description | Most recently unlocked achievements — click to view in Lifetime Stats |
| Category | `analytics` |
| Default size | 2×2 (cols × rows) |
| Min size | 1×2 |
| Max size | 4×4 |

The native implementation MUST register this surface with the same ID and respect the same size constraints in the dashboard grid system.

## Single Goal

Ship a production-polished, native Apple-idiomatic version of `RecentlyUnlockedAchievements` at parity with the web source. No stubs, no placeholder, no skeleton-only.

## Data sources (from web source — bind via shared P1/S8 state holders)

- `useAnalytics`
- `useVehicles`
- `useTranslation`
- `useNavigate`
- `useAchievementCelebrationPrefs`
- `useLifetimeStats`

## Shared components used (from web source — must map to native counterparts)

- `@/components/feedback`

## Charts / maps used (from web source — native chart + map per Apple guidelines)

- _(none)_

> Map: web Recharts → Swift Charts.
> Map: web Leaflet → MapKit.

## Titles / labels / i18n keys extracted from source

- `Recently Unlocked`
- `Recently unlocked achievements are hidden in your settings.`
- `View achievement: {{name}}`

> All listed strings MUST resolve through the P1/S10 i18n facade. No English literals in native code.

## States (every state MUST render — no hidden surfaces)

- `loading` — initial fetch, skeleton chrome
- `empty` — data resolved, no rows / no value → friendly empty state, never a blank box
- `error` — fetch failed → `QueryError` equivalent with retry affordance
- `stale` — query data is older than freshness window → stale chip + auto-refresh
- `offline` — no connectivity → cached value + offline chip
- _(plus any state-specific branches that exist in the web source — read it and reproduce them all)_

## Implementation spec

1. **Read the web source** at `features/dashboard/widgets/RecentlyUnlockedAchievements.tsx` end-to-end before writing native code. Note every conditional render branch and every `t()` call.
2. **Bind data** via the shared state-holder for each hook listed above (P1/S8). No direct HTTP from the view.
3. **Compose layout** with native primitives per Apple HIG (SwiftUI + Swift Charts + MapKit, iOS 18 / iPadOS 18 / macOS 15 HIG). Do not port web Tailwind classes — use platform tokens (P1/S9).
4. **States**: render every state listed above. Test all branches.
5. **i18n**: every string from P1/S10 keys; no hardcoded English.
6. **Accessibility**: VoiceOver labels, Dynamic Type, reduce-motion respect; iOS 18 / iPadOS 18 / macOS 15 minimums.
7. **Tests**: unit test the data adapter (cached → projection), snapshot test the view in each state, accessibility test for label presence.
8. **Telemetry**: emit a `view.opened` event with the surface slug `RecentlyUnlockedAchievements` per P1/S11 diagnostics contract.

## Out of Scope

- Other surfaces in the same feature (each has its own prompt)
- Backend / API changes
- Atomic shared components (covered by P4 component-library bundle prompt)

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p4-apple-dashboard-widgets-0080-RecentlyUnlockedAchievements.log"
"=== P4 Dashboard widget 0080 RecentlyUnlockedAchievements (Apple) ===" | Tee-Object $log
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/dashboard-widgets/RecentlyUnlockedAchievements *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only when every step above is 0
```

## Acceptance Criteria

- [ ] Surface renders on Apple with all states from the web source reproduced.
- [ ] Hooks bind to the shared P1/S8 state-holder layer; no direct HTTP from the view.
- [ ] Every i18n key from source has a matching key in P1/S10 catalog.
- [ ] Accessibility labels present on every interactive element.
- [ ] Tests: adapter unit test + per-state snapshot/UI test + a11y label test.
- [ ] No `TODO` / `stub` / `mock` / `placeholder` / `Lorem` in shipped code.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` with platform-capability evidence in the log).

## Commit

```powershell
git add apps/apple/TeslaSync/dashboard-widgets/RecentlyUnlockedAchievements .github/prompts/monorepo/logs/p4-apple-dashboard-widgets-0080-RecentlyUnlockedAchievements.log
git commit -m "feat(apps/apple/dashboard-widgets): add RecentlyUnlockedAchievements surface (P4)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
