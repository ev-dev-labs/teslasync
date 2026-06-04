---
description: "P3/A8 — Android Wear OS companion for watch parity"
---

# P3 · A8 · 0003 — Wear OS companion

> **Severity:** Platform polish (conditional on watch feature parity) · **Delegation:** FORBIDDEN
> Implement a Wear OS companion app if the Android project supports the web `watch` feature, matching the standalone watch-face route with native wearable UX.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**` Wear module/source set, watch UI, data sync |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1, P3/A3, P3/A5, P3/A6-0001, relevant A7 watch page prompt |
| Blocks | Android platform polish acceptance when watch parity is in scope |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-009, ADR-010, ADR-011, ADR-013, ADR-015, ADR-016 |
| Log | `../logs/p3-a8-0003-wear-os-companion.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Provide a real Wear OS companion experience for TeslaSync watch status rather than leaving the web watch route unsupported on Android.

## Spec

- Survey `web/src/features/watch/pages/WatchFacePage` and implement native wearable parity where applicable: battery/range, vehicle state, charging state, live/stale indicator, alerts, refresh, and tap-through actions.
- Use Wear Compose / Horologist where locked in the catalog; do not float versions. Use Material for Wear OS patterns, round/square layout support, ambient mode, tiles/complications if in project scope.
- Sync with the phone/shared cache via shared-core state and Data Layer APIs where appropriate; do not perform insecure token sharing or background SSE on the watch.
- Implement loading/empty/error/stale/offline/auth-required states and accessible text for small screens.
- If product leadership has explicitly marked Wear out of scope in the parity ledger, the prompt may mark BLOCKED/NOT-APPLICABLE in the log with evidence; do not create a fake shell.

## Implementation steps

1. Verify whether the Android parity ledger includes watch/Wear; record decision evidence.
2. If in scope, create/wire the Wear module or source set using locked versions and shared-core-compatible data flow.
3. Implement native watch screens, tile/complication hooks if scoped, deep links to phone, and refresh/stale behavior.
4. Add unit and wearable Compose tests/previews for round/square/loading/empty/error/stale states.
5. Run the gate or mark BLOCKED if required Wear SDK/device support is unavailable.

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

- [ ] Wear support is either fully implemented with watch-feature parity or explicitly BLOCKED/NOT-APPLICABLE with ledger evidence.
- [ ] No fake watch shell, TODO, or placeholder route exists.
- [ ] Wear UI uses Material/Wear patterns, shared cache/state, no background SSE, and accessible small-screen layouts.
- [ ] Gate green when SDK available; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE` or honest `STATUS=BLOCKED` with log evidence.

## Out of Scope

iOS/watchOS, backend changes, store screenshots, and phone-only page parity outside watch support.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a8-0003-wear-os-companion.log
git commit -m "feat(apps/android): add Wear OS companion parity (P3/A8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
