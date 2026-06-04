---
description: "P3/feature-views/0216 — Feature view: TeslaAccountSection"
---

# P3 · Feature view · 0216 — `TeslaAccountSection` (Android)

> **Severity:** Per-surface parity · **Delegation:** FORBIDDEN
> **Capability:** requires Jetpack Compose + Material 3, Kotlin 2.2.x. If unavailable on the runner → STATUS=BLOCKED with API evidence.
> **Web source:** `features/settings/components/TeslaAccountSection.tsx` — this is THE specification; native must reproduce its data, composition, states, and i18n keys.

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
| Web source | `features/settings/components/TeslaAccountSection.tsx` |
| Native output | `apps/android/app/src/main/java/com/teslasync/feature-views/TeslaAccountSection.* ` |
| Allowed files | `apps/android/app/src/main/java/com/teslasync/feature-views/TeslaAccountSection.*`, the log file |
| Depends on | P3 core (theme, nav, live, cache, state-holders), P1/S8 state holders, P1/S9 tokens, P1/S10 i18n |
| Blocks | P3 acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-009 |
| Log | `../logs/p3-android-feature-views-0216-TeslaAccountSection.log` |

## Single Goal

Ship a production-polished, native Android-idiomatic version of `TeslaAccountSection` at parity with the web source. No stubs, no placeholder, no skeleton-only.

## Data sources (from web source — bind via shared P1/S8 state holders)

- `useSettings`
- `useTranslation`
- `useToast`
- `useAuthStatus`
- `useAuthURL`
- `useDisconnectAuth`
- `useSyncVehicles`
- `useConfirm`

## Shared components used (from web source — must map to native counterparts)

- `@/components/ui`
- `@/components/motion`
- `@/components/feedback/Toast`

## Charts / maps used (from web source — native chart + map per Android guidelines)

- _(none)_

> Map: web Recharts → compose Vico / Material charts.
> Map: web Leaflet → Maps SDK for Android (Compose).

## Titles / labels / i18n keys extracted from source

- `Tesla Account`
- `Disconnect Tesla Account?`
- `Disconnect`
- `Cancel`
- `Tesla account disconnected`
- `Disconnect failed`
- `Connect your Tesla account to sync vehicles and data`
- `Connected`
- `Expires in {{days}}d`
- `Token expires`
- `Disconnected`
- `Not connected`
- `Reconnect to resume live data and commands.`
- `Connect Tesla Account`
- `Token refreshed`
- `Token refresh failed`
- `Refresh Token`
- `Vehicle sync failed`
- `Sync Vehicles`
- `Re-authorize`
- `Synced {{count}} vehicle(s).`

> All listed strings MUST resolve through the P1/S10 i18n facade. No English literals in native code.

## States (every state MUST render — no hidden surfaces)

- `loading` — initial fetch, skeleton chrome
- `empty` — data resolved, no rows / no value → friendly empty state, never a blank box
- `error` — fetch failed → `QueryError` equivalent with retry affordance
- `stale` — query data is older than freshness window → stale chip + auto-refresh
- `offline` — no connectivity → cached value + offline chip
- _(plus any state-specific branches that exist in the web source — read it and reproduce them all)_

## Implementation spec

1. **Read the web source** at `features/settings/components/TeslaAccountSection.tsx` end-to-end before writing native code. Note every conditional render branch and every `t()` call.
2. **Bind data** via the shared state-holder for each hook listed above (P1/S8). No direct HTTP from the view.
3. **Compose layout** with native primitives per Android HIG (Jetpack Compose + Material 3, Kotlin 2.2.x). Do not port web Tailwind classes — use platform tokens (P1/S9).
4. **States**: render every state listed above. Test all branches.
5. **i18n**: every string from P1/S10 keys; no hardcoded English.
6. **Accessibility**: TalkBack labels, font scale, reduce-motion respect; API 26+ (Android 8) target, latest stable minimums.
7. **Tests**: unit test the data adapter (cached → projection), snapshot test the view in each state, accessibility test for label presence.
8. **Telemetry**: emit a `view.opened` event with the surface slug `TeslaAccountSection` per P1/S11 diagnostics contract.

## Out of Scope

- Other surfaces in the same feature (each has its own prompt)
- Backend / API changes
- Atomic shared components (covered by P3 component-library bundle prompt)

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p3-android-feature-views-0216-TeslaAccountSection.log"
"=== P3 Feature view 0216 TeslaAccountSection (Android) ===" | Tee-Object $log
Push-Location apps/android
./gradlew :app:assembleRelease 2>&1 | Tee-Object $log -Append; "BUILD_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :app:testReleaseUnitTest 2>&1 | Tee-Object $log -Append; "TEST_EXIT=$LASTEXITCODE"  | Tee-Object $log -Append
./gradlew ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE"  | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android/app/src/main/java/com/teslasync/feature-views/TeslaAccountSection *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only when every step above is 0
```

## Acceptance Criteria

- [ ] Surface renders on Android with all states from the web source reproduced.
- [ ] Hooks bind to the shared P1/S8 state-holder layer; no direct HTTP from the view.
- [ ] Every i18n key from source has a matching key in P1/S10 catalog.
- [ ] Accessibility labels present on every interactive element.
- [ ] Tests: adapter unit test + per-state snapshot/UI test + a11y label test.
- [ ] No `TODO` / `stub` / `mock` / `placeholder` / `Lorem` in shipped code.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` with platform-capability evidence in the log).

## Commit

```powershell
git add apps/android/app/src/main/java/com/teslasync/feature-views/TeslaAccountSection .github/prompts/monorepo/logs/p3-android-feature-views-0216-TeslaAccountSection.log
git commit -m "feat(apps/android/feature-views): add TeslaAccountSection surface (P3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
