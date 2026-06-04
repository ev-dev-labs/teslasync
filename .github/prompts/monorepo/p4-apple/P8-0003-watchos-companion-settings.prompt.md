---
description: "P4/P8 — watchOS companion and settings polish"
---

# P4 · P8 · 0003 — watchOS companion and settings polish

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode and watchOS SDK; if the gate can't run → STATUS=BLOCKED.
> Build a watchOS companion where applicable because the web app has a standalone watch face route,
> plus final Apple settings polish aligned with HIG.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSyncWatch/`, watch extension, settings refinements |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P6 live/push, P4/P7 WatchFace parity source, P8-0002 settings/commands |
| Blocks | P99 Apple acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-009, ADR-010, ADR-011, ADR-013, ADR-014, ADR-015, ADR-016 |
| Log | `../logs/p4-p8-0003-watchos-companion-settings.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Deliver a real watchOS companion/watch face experience for glanceable vehicle status and quick
safe actions, plus final settings polish across Apple platforms.

## Spec

- **Watch source:** mirror the web standalone `/watch` route intent: glanceable battery/range,
  vehicle state, charging state, climate/security status, stale/offline indicators.
- **watchOS UI:** SwiftUI watch app with complications/widgets where supported; small-screen HIG,
  Digital Crown-friendly lists, large tap targets, no dense web layouts.
- **Data:** use cached summaries and foreground refresh through shared facade; no long background SSE;
  push/WidgetKit timelines handle background updates honestly.
- **Actions:** safe, confirmed quick actions only where backend permissions exist (refresh, open app,
  maybe climate/command status); auth-required states clear.
- **Settings polish:** synchronize core preferences across app/watch where appropriate; privacy, analytics,
  units, notifications, biometrics, cache/offline, developer diagnostics.
- **Tests:** watch target build/tests, snapshot/accessibility checks where supported, iOS host integration.

## Implementation steps

1. Survey `web/src/App.tsx` `/watch` route and watch page source; log data, states, and actions.
2. Add watchOS targets/extension, shared cached data access, settings sync, and complication/widget entries.
3. Implement watch views for all states (loading/empty/error/stale/offline/auth) and safe action confirmations.
4. Add tests for watch data mapping, stale indicators, settings sync, and host-app deep links.
5. Run the full Apple gate on iOS Simulator and macOS (and watchOS build/test if the runner supports it).

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSyncWatch -destination 'platform=watchOS Simulator,name=Apple Watch Series 10 (46mm)' build test 2>&1 | Tee-Object $log -Append; "WATCH_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/WATCH/LINT/FORMAT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] watchOS companion/watch face covers `/watch` intent with real cached data and all states.
- [ ] No background SSE; stale/offline/auth states are honest and localized.
- [ ] Settings sync and safe quick actions are complete and accessible.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS + watchOS builds/tests green where supported.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no watchOS/macOS/Xcode runner).

## Out of Scope

New backend command endpoints and App Store submission assets.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p8-0003-watchos-companion-settings.log
git commit -m "feat(apps/apple): add watchOS companion and settings polish (P4/P8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
