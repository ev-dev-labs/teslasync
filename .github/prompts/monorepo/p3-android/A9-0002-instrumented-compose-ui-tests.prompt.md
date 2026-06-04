---
description: "P3/A9 — Android instrumented and Compose UI tests for component/page states"
---

# P3 · A9 · 0002 — Instrumented + Compose UI tests

> **Severity:** Quality gate · **Delegation:** FORBIDDEN
> Add Android instrumented/Compose UI tests covering reusable components, navigation, auth gates, live states, widgets, and generated page state contracts.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**/src/androidTest/**` plus minimal test tags/seams under `apps/android/**` |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A9-0001, P3/A1..A8, generated A7 page prompts |
| Blocks | P3/A99 acceptance |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a9-0002-instrumented-compose-ui-tests.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Verify the Android UI actually renders all infrastructure and page state variants on device/emulator with Compose semantics and accessibility-friendly assertions.

## Spec

Cover at minimum:
- Component golden/state tests: UI primitives, charts accessible summaries, metrics/badges/timelines, feedback/forms, maps controls faked, motion reduced-motion.
- Navigation shell tests: compact/rail/drawer selection, deep links/aliases, not-found, predictive back basics, route announcements.
- Auth/onboarding tests: signed-out, authorizing, authenticated, expired, reauth-required, secure sign-out screen transitions.
- Live/push/settings widgets: stale/live banners, notification permission/settings, shortcut/deep-link intents, Glance widget rendering where testable.
- Page-state smoke tests for each generated A7 page: loading, empty, error, cached/stale, data; use fake shared state holders and parity ledger IDs.
Use Compose test APIs, test tags only where necessary, and AndroidX test rules from the version lock.

## Implementation steps

1. Survey existing androidTest coverage and A7 generated page ledger; write a state coverage matrix.
2. Add shared fake app harness for auth/shared-state/nav/deep-link injection.
3. Implement component, shell, auth, live, widget, and page-state UI tests.
4. Run connected Compose tests on an emulator/device; if no device is available, mark BLOCKED per covenant.
5. Run standard lint/placeholder gates.

## Gate

```powershell
Push-Location apps/android
./gradlew :android:testDebugUnitTest 2>&1 | Tee-Object $log -Append; "UNIT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:connectedDebugAndroidTest 2>&1 | Tee-Object $log -Append; "ANDROID_TEST_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:assembleDebug 2>&1 | Tee-Object $log -Append; "ASM_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
./gradlew :android:lintDebug ktlintCheck detekt 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Pop-Location
& ./apps/tools/check-placeholders.ps1 -Path apps/android -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if all *_EXIT values are 0 and the placeholder scanner is clean
```

## Acceptance Criteria

- [ ] Instrumented tests cover component families and all generated page state contracts.
- [ ] Deep links, auth gates, stale/error/loading/empty/data states are asserted via Compose semantics.
- [ ] A device/emulator gate was actually run; missing device means BLOCKED, not DONE.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Manual QA, store release tasks, backend test suites, and changing page parity scope.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a9-0002-instrumented-compose-ui-tests.log
git commit -m "test(apps/android): add Compose UI and instrumented state tests (P3/A9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
