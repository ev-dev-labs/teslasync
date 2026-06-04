---
description: "P3/A9 — Android unit tests for components, ViewModels, auth, live, widgets"
---

# P3 · A9 · 0001 — Unit test completion gate

> **Severity:** Quality gate · **Delegation:** FORBIDDEN
> Author comprehensive JVM/unit tests for Android infrastructure and component state behavior per ADR-010 without changing production behavior except to improve testability.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**/src/test/**` plus minimal testability seams under `apps/android/**` |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1..A8 infrastructure prompts |
| Blocks | P3/A9-0002 and A99 acceptance |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-008, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a9-0001-unit-tests.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Reach the Android unit-test coverage bar for infrastructure and reusable components with deterministic, non-networked tests.

## Spec

Cover at minimum:
- Theme/token mapping: color roles, typography, shapes, dynamic-color fallback flags.
- Component state models and pure helpers for ui, charts adapters, data-display, feedback/forms, maps/motion reduced-motion decisions.
- Navigation route registry, aliases, deep link parsing, auth-guard decisions.
- Auth secure storage fakes, AppAuth callback handling, token refresh decisions.
- ViewModel state collection from fake KMP `StateFlow`s: loading, cached, refreshing, empty, stale/offline, error, retry, selected vehicle.
- SSE lifecycle state reducers and FCM registration/channel/payload routing fakes.
- Widget data adapters and settings persistence.
Use fake clocks, fake dispatchers, fake stores, MockK/Kotlin test libs from the version lock; no real network, Firebase, Authentik, Google Maps, or device.

## Implementation steps

1. Survey existing test coverage and write a gap matrix in the log.
2. Add deterministic fakes/test utilities under allowed Android test sources.
3. Implement missing tests by domain; add minimal dependency injection seams only when required.
4. Run coverage/report command if configured, plus the standard gate.
5. Record coverage and any intentionally deferred device-only cases in the log.

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

- [ ] Unit tests cover every infrastructure prompt A1..A8 at meaningful behavior level.
- [ ] No real network/device/provider dependency is used in JVM tests.
- [ ] Coverage meets the project threshold if configured (≥80% per ADR-010) or logs exact current coverage and blockers.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Compose UI/instrumented tests, production feature rewrites not needed for testability, backend tests.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a9-0001-unit-tests.log
git commit -m "test(apps/android): complete Android unit test coverage (P3/A9)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
