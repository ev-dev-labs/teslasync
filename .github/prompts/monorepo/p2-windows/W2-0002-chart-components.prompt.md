---
description: "P2/W2-0002 — WinUI chart components"
---

# P2 · W2-0002 — Charts and visualization components

> **Severity:** Foundational component library · **Delegation:** FORBIDDEN
> **Capability note:** requires Windows + .NET 10 SDK + Windows App SDK 1.6+; if no runner exists, gate may end STATUS=BLOCKED with that reason only.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/windows/TeslaSync.App/Components/Charts/**` |
| Allowed files | `apps/windows/**`, the log file |
| Depends on | W0-0001 DONE, W1-0001 DONE, W2-0001 DONE |
| Blocks | W7 chart-heavy pages, W9 tests |
| ADR refs | ADR-002, ADR-005, ADR-010, ADR-011, ADR-012, ADR-015 |
| Instr refs | version lock `apps/versions.lock.md`; web source `web/src/components/charts/` |
| Log | `../logs/p2-w2-0002-chart-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Implement complete WinUI chart wrappers equivalent to the web `charts` category using the pinned Windows chart library (LiveCharts2/WinUI per ADR-012) and TeslaSync tokens.

## Spec

Implement these concrete components/features:
- `TsChartContainer` with title, subtitle, actions/export menu slot, loading/empty/error bodies, accessible summary, and tokenized grid/background.
- `TsRadialGauge`, `TsSparkline`, `TsMiniChart`, `TsSmallMultiplesChart`, `TsElevationProfile`.
- Cartesian wrappers for line, area, bar, composed, scatter, pie/donut, radar where required by generated W7 page prompts.
- `TsChartTooltip`, `TsChartLegend`, `TsChartBrush`, cursor synchronization, hidden-series toggles, annotation lines/list/popover, time markers, metric switcher.
- Chart palette binding to W1 `TsChart01..` brand brushes and semantic status colors.
- Export actions for PNG/SVG/CSV where supported by the chosen pinned chart package; if a package lacks a native feature, implement it with WinUI render target/CSV from the bound series rather than stubbing.
- Accessible alternatives: AutomationProperties summary plus a tabular data view for every chart.

## Implementation steps

1. Verify W0/W1/W2-0001 logs are DONE.
2. Survey `web/src/components/charts/index.ts` and identify the minimum chart primitives required by W7 generated page prompts.
3. Add LiveCharts2/WinUI package only if pinned in `apps/versions.lock.md`/central package management; do not float versions.
4. Implement chart components with typed series DTOs; never pass `object`/`dynamic` to hide type errors.
5. Add sample/unit tests for palette, empty/error/loading states, tooltip formatting, hidden-series state, and accessible summary text.
6. Run the full gate and log `CHART_COMPONENT_COUNT` plus accessible-alternative evidence.

## Gate

```powershell
$log = ".github/prompts/monorepo/logs/p2-w2-0002-chart-components.log"
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
$required = @('TsChartContainer','TsRadialGauge','TsSparkline','TsChartTooltip','TsChartLegend','TsChartBrush','TsMiniChart','TsSmallMultiplesChart')
$all = Get-ChildItem apps/windows -Recurse -Include *.cs,*.xaml | Select-String -Pattern ($required -join '|')
$missing = @($required | Where-Object { $all -notmatch $_ })
"MISSING_CHART_COMPONENTS=$($missing.Count)" | Tee-Object $log -Append
$exit = [int](($buildExit -ne 0) -or ($formatExit -ne 0) -or ($testExit -ne 0) -or ($placeholderExit -ne 0) -or ($missing.Count -ne 0))
"EXIT=$exit" | Tee-Object $log -Append
"STATUS=$(if ($exit -eq 0) { 'DONE' } else { 'BLOCKED' })" | Tee-Object $log -Append
# EXIT=0 only when every command above succeeds, the runner is Windows/.NET capable, and no placeholder/parity/fidelity check reports red.
```

## Acceptance Criteria

- [ ] Chart primitives listed above exist and use the pinned WinUI chart package.
- [ ] W1 chart palette and semantic status brushes drive all chart colors.
- [ ] Loading, empty, error, tooltip, legend, brush, sync, annotation, and export behaviors are real.
- [ ] Every chart exposes an accessible summary/table alternative.
- [ ] Build, format, test, placeholder, and component-inventory gates are green.

## Out of Scope

- No page-specific chart business logic.
- No direct Recharts/web code, WebView, or bitmap-only charts without data accessibility.
- No unpinned chart packages.

## Commit

```powershell
git add apps/windows .github/prompts/monorepo/logs/p2-w2-0002-chart-components.log
git commit -m "feat(apps/windows): add Fluent chart components (P2/W2-0002)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
