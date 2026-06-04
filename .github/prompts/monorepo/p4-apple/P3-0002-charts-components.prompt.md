---
description: "P4/P3 — Apple Swift Charts component library"
---

# P4 · P3 · 0002 — Swift Charts component library

> **Severity:** Foundation (blocks chart-heavy Apple pages) · **Delegation:** FORBIDDEN
> **Capability:** requires macOS + Xcode; if the gate can't run → STATUS=BLOCKED.
> Implement Swift Charts wrappers that mirror the web `components/charts` category with
> TeslaSync tokens, interactivity, exports, a11y summaries, and adaptive layouts.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/apple/TeslaSync/Components/Charts/` |
| Allowed files | `apps/apple/**`, the log file |
| Depends on | P4/P3-0001 UI components, P4/P2-0001 design tokens |
| Blocks | every Apple page with charts; P9 tests |
| ADR refs | ADR-002, ADR-005, ADR-010, ADR-011, ADR-015 |
| Log | `../logs/p4-p3-0002-charts-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create a complete Swift Charts component set that pages can use instead of ad-hoc charts,
with accessible summaries and parity with web chart semantics.

## Spec

Implement concrete chart components and utilities:

- `TSChartContainer`, `TSRadialGauge`, `TSMiniChart`, `TSSmallMultiplesChart`, `TSSparkline`,
  `TSAreaChart`, `TSLineChart`, `TSBarChart`, `TSPieChart`, `TSComposedChart`, `TSScatterChart`,
  `TSRadarChart`, `TSElevationProfile`, `TSMetricSwitcherChart`.
- `TSChartTooltip`, `TSChartLegend`, `TSChartBrush`/time-window selector, `TSChartGradient`,
  `TSTimeMarker`, `TSAnnotationLines`, `TSAddAnnotationPopover`, `TSAnnotationList`.
- Shared chart palette from `TSChartPalette`, grid/axis styling, safe numeric formatting,
  series visibility, cursor sync, and export menu for image/data where platform-supported.
- Accessibility: every chart exposes VoiceOver label/value, a concise summary, and a table/list
  alternative for dense data per ADR-015.
- Performance: downsample large series responsibly, animate only when Reduce Motion allows.

## Implementation steps

1. Survey `web/src/components/charts/index.ts` and record one-to-one mappings in the log.
2. Implement reusable generic Swift Charts wrappers under `Components/Charts` with typed data models.
3. Add chart previews with realistic fixtures for light/dark, compact/regular, empty/error overlays.
4. Add XCTest coverage for formatter safety, palette mapping, legend toggling, selection, brush ranges,
   and accessible summary text.
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

- [ ] Every chart export listed above has a native Swift Charts wrapper or documented native equivalent.
- [ ] Tooltips, legends, annotations, selection/brush, export, and accessible alternatives work.
- [ ] Empty/error/loading overlays compose with feedback components and never hide panels.
- [ ] SwiftLint/SwiftFormat + placeholder gates clean; iOS + macOS builds/tests green.
- [ ] `EXIT=0` / `STATUS=DONE` (or `STATUS=BLOCKED` if no macOS/Xcode runner).

## Out of Scope

Page-specific chart data binding and maps.

## Commit

```powershell
git add apps/apple .github/prompts/monorepo/logs/p4-p3-0002-charts-components.log
git commit -m "feat(apps/apple): add Swift Charts component library (P4/P3)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
