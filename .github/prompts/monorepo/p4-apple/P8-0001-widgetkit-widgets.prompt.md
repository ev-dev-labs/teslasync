---
description: "P4/P8 — Apple WidgetKit widgets"
---

# P4 · P8 · 0001 — WidgetKit widgets

> **Severity:** Platform polish · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode and signing for extensions; if the gate can't run → STATUS=BLOCKED.
> Implement HIG-native WidgetKit widgets for glanceable TeslaSync state on iOS/iPadOS/macOS.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSyncWidgets/`, shared widget models/assets |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P6 live/push, P4/P7 page state holders, P4/P2 tokens |
| Blocks | P99 Apple acceptance gate |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-009, ADR-010, ADR-011, ADR-013, ADR-014, ADR-015, ADR-016 |
| Log | `../logs/p4-p8-0001-widgetkit-widgets.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Deliver production WidgetKit extensions that show useful, cached TeslaSync data without pretending
to be live streams, with deep links into the app and native widget styling.

## Spec

- **Families:** small/medium/large/accessory where supported for iOS/iPadOS/macOS.
- **Widgets:** vehicle status (battery/range/location freshness), charging progress, recent drive summary,
  alert count, energy snapshot, and system health glance.
- **Data:** read cached summaries from shared facade/app group store; refresh timelines honestly; show
  `lastUpdated`/stale/offline indicators per ADR-013; no background SSE.
- **Deep links:** each widget opens the matching typed route in the app.
- **Styling:** use generated tokens and WidgetKit/HIG layout; localized; accessible labels; redacted PII.
- **Tests:** timeline provider tests, snapshot/light-dark Dynamic Type checks where supported.

## Implementation steps

1. Define widget extension targets and app group data access without duplicating networking in widgets.
2. Implement timeline providers and views for all widgets/families listed above.
3. Wire deep links to the P4 route registry and add localized strings/assets.
4. Add tests for timeline freshness, empty/offline/error states, and privacy redaction.
5. Run the full Apple gate on iOS Simulator and macOS.

## Gate

```powershell
xcodebuild -scheme TeslaSync -destination 'platform=iOS Simulator,name=iPhone 16' build test 2>&1 | Tee-Object $log -Append; "IOS_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
xcodebuild -scheme TeslaSync-macOS build test 2>&1 | Tee-Object $log -Append; "MAC_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftlint --strict 2>&1 | Tee-Object $log -Append; "LINT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
swiftformat --lint apps/apple 2>&1 | Tee-Object $log -Append; "FORMAT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/apple -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if IOS/MAC/LINT/FORMAT/PLACEHOLDER all 0
```

## Acceptance Criteria

- [ ] WidgetKit extension builds for iOS/iPadOS/macOS and covers all listed widgets/families.
- [ ] Widgets use cached data, show freshness honestly, and deep-link to correct routes.
- [ ] No token/precise-location leakage; localization and accessibility complete.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if signing/macOS/Xcode runner missing).

## Out of Scope

Backend notification changes, Live Activities already covered by P6-0002, and page implementation.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p8-0001-widgetkit-widgets.log
git commit -m "feat(apps/apple): add WidgetKit widgets (P4/P8)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
