---
description: "P3/A2 — Android chart component library via Vico"
---

# P3 · A2 · 0002 — Compose chart components (Vico)

> **Severity:** Foundation visualization (blocks chart-heavy pages) · **Delegation:** FORBIDDEN
> Build Vico-backed chart wrappers mirroring the web `components/charts` category with accessible summaries and export/legend interactions.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/android/**/components/charts/**` |
| Allowed files | `apps/android/**`, the log file |
| Depends on | P3/A1, P3/A2-0001 |
| Blocks | all Android page prompts with charts |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-010, ADR-011, ADR-015 |
| Log | `../logs/p3-a2-0002-chart-components.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Create a complete, reusable Compose chart layer based on Vico and TeslaSync tokens so pages never import chart libraries directly.

## Spec

Map the web chart category to Android-native Vico/Compose wrappers:
- Containers and chrome: `ChartContainer`, `ChartLegend`, `ChartTooltip`, `ChartExportMenu`, `ChartBrush`, `ChartAnnotationLayer`, `AnnotationList`, `AddAnnotationPopover`, `TimeMarker`, `ChartGradient` token mapping.
- Chart types: `AreaChartWrapper`, line chart wrapper, bar chart wrapper, composed/combined chart wrapper, `MetricSwitcherChart`, `MiniChart`, `Sparkline`, `SmallMultiplesChart`, `ElevationProfile`, `RadialGauge`.
- Shared behavior: hidden-series state, time-range state, cursor sync, accessible data summary/table alternative, empty/error/loading chart states.
Use Vico from the version catalog; do not float versions or use direct page-level chart imports.

## Implementation steps

1. Survey `web/src/components/charts` and log every wrapper mapped to Vico or a custom Compose Canvas primitive.
2. Implement chart model adapters that accept SI-domain data and formatted labels from shared core/presentation state.
3. Implement legends, tooltips, annotation layers, brushes/ranges, chart export hooks, and accessible summary content.
4. Add screenshot-appropriate previews and tests for empty/loading/error/data states, legend toggles, and a11y summaries.
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

- [ ] All listed chart components are implemented as reusable wrappers under the Android component library.
- [ ] Pages can consume charts without importing Vico directly.
- [ ] Accessible summaries exist for every chart type; empty/error/loading states are real.
- [ ] Gate green; placeholder scanner clean.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

Page-specific chart data transformations, backend changes, and non-chart components outside dependencies.

## Commit

```powershell
git add apps/android .github/prompts/monorepo/logs/p3-a2-0002-chart-components.log
git commit -m "feat(apps/android): add Vico chart component wrappers (P3/A2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
