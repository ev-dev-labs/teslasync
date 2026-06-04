---
description: "P2/W2-0003 — WinUI data-display components"
---

# P2 · W2-0003 — Data-display and metric components

> **Severity:** Foundational component library · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Components/DataDisplay/**` |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE, W2-0001 DONE |
| Blocks | W7 pages, W9 tests |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-011, ADR-015 |
| Instr refs | version lock `apps/versions.lock.md`; web source `web/src/components/data-display/` |
| Log | `../logs/p2-w2-0003-data-display-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement complete native WinUI equivalents for the web `data-display` category, including SI-aware formatted values and freshness/status primitives.

## Spec

Implement these concrete components:
- `TsStatCard`, `TsMetricCard`, `TsInlineMetric`, `TsMetricBar`, `TsAnimatedNumber`, `TsKVList`.
- `TsStatusBadge`, `TsSeverityBadge`, `TsStatusDot`, `TsFSMBadge`, `TsSourceLayerBadge`, `TsLiveIndicator`, `TsFreshnessIndicator`, `TsDataFreshness`.
- `TsTimeline`, `TsTimelineItem`, `TsRecentActivityFeed`, `TsDateGroupedList`.
- `TsAvatar`, `TsUserCell`, `TsUsageCard`, `TsKpiOverviewCard`, `TsComparisonHeader`, `TsDelta`.
- History/list atoms: `TsHistoryListRow`, `TsScoreBadge`, `TsBatteryDelta`, `TsRouteDisplay`.
- Playback atoms: `TsPlaybackControls`, `TsPlaybackSpeedMenu`, `TsTimelineScrubber`.
- Formatted SI value controls: DateTime, Distance, Speed, Temperature, Pressure, Energy, Power, Voltage, Current, Currency, Percentage, Number, Duration, Range.
All formatted value controls must use the C# behavior port/golden-vector formatting from ADR-004; never duplicate ad-hoc conversion math in UI controls.

## Implementation steps

1. Verify W0/W1/W2-0001 logs are DONE.
2. Survey `web/src/components/data-display/index.ts` and `format/index.ts`.
3. Implement controls with dependency properties and bindable view models; style via W1 tokens.
4. Connect formatted SI controls to the C# behavior port and golden-vector fixtures; no legacy imperial storage or unit-suffixed DTO fields.
5. Add tests for stale/fresh thresholds, status/severity mappings, animated-number reduced-motion behavior, and every formatter.
6. Run gate and log the component inventory.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w2-0003-data-display-components.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object $log -Append
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { "EXIT=1" | Tee-Object $log -Append; "STATUS=BLOCKED" | Tee-Object $log -Append; return }
dotnet build apps/windows/TeslaSync.sln -c Release 2>&1 | Tee-Object $log -Append
$buildExit = $LASTEXITCODE; "BUILD_EXIT=$buildExit" | Tee-Object $log -Append
dotnet format apps/windows/TeslaSync.sln --verify-no-changes 2>&1 | Tee-Object $log -Append
$formatExit = $LASTEXITCODE; "FORMAT_EXIT=$formatExit" | Tee-Object $log -Append
dotnet test apps/windows/TeslaSync.sln -c Release --no-build 2>&1 | Tee-Object $log -Append
$testExit = $LASTEXITCODE; "TEST_EXIT=$testExit" | Tee-Object $log -Append
& ./apps/tools/check-placeholders.ps1 -Path apps/windows -Language csharp 2>&1 | Tee-Object $log -Append
$placeholderExit = $LASTEXITCODE; "PLACEHOLDER_EXIT=$placeholderExit" | Tee-Object $log -Append
$required = @('TsStatCard','TsMetricCard','TsMetricBar','TsAnimatedNumber','TsKVList','TsStatusBadge','TsTimeline','TsFreshnessIndicator','TsLiveIndicator','TsDistance','TsEnergy')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_DATA_DISPLAY_COMPONENTS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Every listed data-display component exists and is tokenized.
- [ ] SI formatted controls use the C# behavior port and golden vectors.
- [ ] Freshness/stale/live indicators follow the two-minute contract.
- [ ] Reduced-motion and Narrator/high-contrast behavior are implemented.
- [ ] Build, format, test, placeholder, and inventory gates are green.

## Out of Scope

- No page implementations.
- No direct API calls from controls.
- No ad-hoc unit conversion or non-SI storage fields.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w2-0003-data-display-components.log
git commit -m "feat(apps/windows): add data display components (P2/W2-0003)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
