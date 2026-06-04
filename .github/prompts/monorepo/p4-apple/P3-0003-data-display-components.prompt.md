---
description: "P4/P3 — Apple data-display and vehicle components"
---

# P4 · P3 · 0003 — Data-display and vehicle components

> **Severity:** Foundation (blocks Apple parity pages) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Implement SwiftUI equivalents for web `components/data-display`, `components/vehicles`,
> and formatting primitives, all SI-aware and accessibility-ready.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Components/DataDisplay/`, `apps/apple/TeslaSync/Components/Vehicles/` |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P3-0001 UI, P4/P3-0002 charts, P4/P1 shared facade |
| Blocks | every Apple page with metrics/lists/vehicle cards; P9 tests |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-010, ADR-011, ADR-013, ADR-015 |
| Log | `../logs/p4-p3-0003-data-display-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create the TeslaSync SwiftUI data-display component library so pages render metrics, status,
freshness, timelines, replay controls, and vehicle visuals consistently without page-local widgets.

## Spec

Implement concrete components:

- **Metric/status:** `TSStatCard`, `TSUsageCard`, `TSKVList`, `TSStatusBadge`, `TSProgressRing`,
  `TSAnimatedNumber`, `TSMetricCard`, `TSInlineMetric`, `TSMetricBar`, `TSFSMBadge`,
  `TSTransitionArrow`, `TSFreshnessIndicator`, `TSDataFreshness`, `TSLiveIndicator`, `TSDelta`,
  `TSComparisonHeader`, `TSKpiOverviewCard`, `TSSeverityBadge`, `TSStatusDot`, `TSSourceLayerBadge`,
  `TSScoreBadge`, `TSBatteryDelta`, `TSRouteDisplay`.
- **Lists/timelines:** `TSTimeline`, `TSTimelineItem`, `TSRecentActivityFeed`, `TSDateGroupedList`,
  `TSBulkActionsToolbar`, `TSSavedViewMenu`, `TSHistoryListRow`.
- **Playback:** `TSPlaybackControls`, `TSPlaybackSpeedMenu`, `TSTimelineScrubber` with keyboard
  shortcuts on macOS/iPad and touch controls on iPhone.
- **People/vehicles:** `TSAvatar`, `TSUserCell`, `TSVehicleHeroCard`, `TSVehicleTwin`, `TSVehiclePaintPicker`.
- **Formatting:** `TSDateTime`, `TSDistance`, `TSSpeed`, `TSTemperature`, `TSPressure`, `TSEnergy`,
  `TSPower`, `TSVoltage`, `TSCurrent`, `TSCurrency`, `TSPercentage`, `TSFormattedNumber`,
  `TSDuration`, `TSRange`; all call shared SI/unit formatting through the Swift facade.

## Implementation steps

1. Survey `web/src/components/data-display/index.ts` and `vehicles/index.ts`; log mappings.
2. Implement components with tokens, SwiftUI animation respecting Reduce Motion, and real state props.
3. Bind formatting components to shared SI converters; add golden-vector tests for unit display.
4. Add previews and XCTest coverage for loading/stale/error displays, playback, timelines, and vehicle visuals.
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

- [ ] Every data-display/vehicle/format export listed above has a native SwiftUI equivalent.
- [ ] SI formatting is delegated to shared facade; freshness/stale semantics use the 2-minute contract.
- [ ] Timelines, playback, status badges, and vehicle cards are functional and accessible.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Form inputs, maps, app navigation, and page-specific state holders.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p3-0003-data-display-components.log
git commit -m "feat(apps/apple): add data-display component library (P4/P3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
