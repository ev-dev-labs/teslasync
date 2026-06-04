---
description: "P3/A3 — Android app scaffold, navigation graph, adaptive layout, deep links"
---

# P3 · A3 · 0001 — Navigation shell matching web App.tsx

> **Severity:** Foundation shell (blocks Android pages) · **Delegation:** FORBIDDEN
> Create the Material 3 app scaffold and Navigation-Compose graph matching `web/src/App.tsx` route groups, with adaptive tablet layout, deep links, and predictive back.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` navigation, scaffold, route registry, adaptive shell |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1, P3/A2-0001, P3/A2-0004 |
| Blocks | P3/A4 auth shell integration, P3/A7 page registration, A8 shortcuts/settings |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-010, ADR-011, ADR-015 |
| Log | `../logs/p3-a3-0001-navigation-shell.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement a complete Android app shell and route graph that can host every generated page prompt while matching the web navigation taxonomy natively.

## Spec

- Use Navigation-Compose with a typed route registry covering web route groups from `App.tsx`: dashboard/glance/quick-stats, vehicles/detail/access/digital-twin, charging, trips/drives, battery/energy, analytics/statistics, maps/location/geofences/navigation, vehicle systems, automations, notifications, telemetry/signals, diagnostics, admin/devtools, power user, system/ops, settings/account/integrations, onboarding, search, sharing, watch, and not-found.
- Implement Material 3 `Scaffold` with `NavigationBar` on compact width, `NavigationRail` on medium, permanent/navigation drawer on expanded, and list/detail adaptive patterns via `WindowSizeClass` for tablets/foldables.
- Support deep links for all web paths and aliases, safe handling of unknown routes, saved back stack state, predictive back, scroll restoration where page state supports it, and route announcements for accessibility.
- Page destinations may use real placeholder-free host lambdas only when the corresponding A7 page file exists; otherwise register route metadata without rendering fake screens.

## Implementation steps

1. Survey `web/src/App.tsx` and log the route groups and aliases implemented.
2. Define typed destination metadata, route paths, deep link patterns, titles, icons, auth requirements, and nav grouping.
3. Implement adaptive shell with Material 3 top app bar, nav bar/rail/drawer, snackbar host, content padding, and edge-to-edge.
4. Integrate route announcements, not-found, onboarding gate hook points, and predictive back callbacks.
5. Add navigation tests for routes, aliases, deep links, tablet layout selection, and back behavior; run gate.

## Gate

```powershell
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug 2>&1 | Tee-Object $log -Append; "ASM_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:lintDebug ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if all *_EXIT values are 0 and the placeholder scanner is clean
```

## Acceptance Criteria

- [ ] Navigation graph covers every `App.tsx` route/alias and records any page not yet implemented as metadata, not as a fake screen.
- [ ] Compact/medium/expanded navigation uses Material 3 and `WindowSizeClass` correctly.
- [ ] Deep links, unknown routes, saved state, predictive back, and a11y announcements are tested.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Implementing individual A7 page content, auth token flow, live SSE, push, widgets, and Wear.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a3-0001-navigation-shell.log
git commit -m "feat(apps/android): add adaptive Navigation-Compose shell (P3/A3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
