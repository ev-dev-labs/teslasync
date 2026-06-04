---
description: "P3/A8 — Android home-screen widgets via Glance"
---

# P3 · A8 · 0001 — App widgets (Glance)

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> Implement complete Android home-screen widgets using Jetpack Glance for key TeslaSync at-a-glance states.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` Glance widgets, widget data adapters, previews/tests |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1, P3/A5, P3/A6-0001 |
| Blocks | Android platform polish acceptance |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a8-0001-app-widgets-glance.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Ship useful, non-placeholder Android widgets that show cached/current TeslaSync state honestly and deep-link into the app.

## Spec

Implement Glance widgets for:
- Vehicle status compact/medium: battery SOC, range, charge/drive/park state, freshness/stale label, last updated.
- Charging widget: plugged state, charge limit, power, ETA/session summary, stale/offline/error state.
- Energy/quick-stats widget: daily energy, cost, drive distance, efficiency summary.
- Alerts widget: latest critical alerts/notifications count with quiet-hour indication.
Widgets must use cached shared-core data, schedule refresh responsibly via WorkManager/Glance update APIs, never rely on background SSE, and deep-link to exact Navigation-Compose routes.

## Implementation steps

1. Survey dashboard/glance/notification web concepts and log widget parity targets.
2. Implement Glance UI, sizes, previews, dynamic color/token mapping, and accessible content descriptions.
3. Bind widgets to cache/freshness adapters and WorkManager refresh without secrets in widget storage.
4. Implement deep links, empty/error/offline/stale states, and tests for each widget size/state.
5. Run the gate.

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

- [ ] All listed widgets render real cached/shared state with loading/empty/error/stale/offline variants.
- [ ] Widgets update through Glance/WorkManager and do not hold SSE streams.
- [ ] Deep links open correct app routes; a11y labels are present.
- [ ] Gate green; placeholder scanner clean; `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Wear OS companion, shortcuts, notification plumbing beyond existing FCM integration, backend widget endpoints.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a8-0001-app-widgets-glance.log
git commit -m "feat(apps/android): add Glance home-screen widgets (P3/A8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
