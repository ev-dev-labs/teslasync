---
description: "P2-WINDOWS W7 — driving/DrivetrainHealthPage at web parity (WinUI 3 / Fluent)"
---

# p2-windows · W7 · page:driving/DrivetrainHealthPage — WinUI 3 / Fluent

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** windows
> Native WinUI 3 / Fluent implementation of the web page `DrivetrainHealthPage` at full panel/state/string parity.
> If no .NET/Windows runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:driving/DrivetrainHealthPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/driving/pages/DrivetrainHealthPage.tsx` (176 LOC) |
| Output | `apps/windows/TeslaSync/Features/Driving/DrivetrainHealthPage.xaml` (+ view-model) |
| Allowed files | `apps/windows/TeslaSync/Features/Driving/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/windows-page-driving-DrivetrainHealthPage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Parity unit — implement ALL (extracted from the real web source)

**Data sources / hooks the page (and any delegated component) uses:**
  - `useTranslation`
  - `useDateFormat`
  - `usePageTitle`
  - `useSelectedVehicle`
  - `useMemo`
  - `useUrlString`
  - `useUrlBatch`
  - `useDrivetrainHealth`
  - `useDrives`
  - `useDrivingStats`
  - `useMotorLatest`
  - `useMotorHistory`
  - `useVehicleLive`
  - `useUnits`
  - `useHiddenSeries`

**Delegated feature components — open these too and port their panels:**
  - `<HealthOverview />` → `web/src/features/driving/components/drivetrain-health/HealthOverview.tsx` — titles: `Drivetrain Healthy`
  - `<HealthGaugeGrid />` → `web/src/features/driving/components/drivetrain-health/HealthGaugeGrid.tsx` — titles: `Motor Details`, `Drive Statistics`, `Motor Status`, `Overall Health`, `Health Score`, `Active Sensors`, `Total Drives`, `Total Distance`, `Avg Speed`, `Top Speed`
  - `<TemperatureGauges />` → `web/src/features/driving/components/drivetrain-health/TemperatureGauges.tsx` — titles: `Temperature Gauges`
  - `<TemperatureMetricCards />` → `web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx` — titles: _(no titled panels in the delegate either)_
  - `<ThermalLoadPanel />` → `web/src/features/driving/components/drivetrain-health/ThermalLoadPanel.tsx` — titles: `Thermal Load Indicators`
  - `<LiveMotorStatus />` → `web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx` — titles: `Live Motor Status`, `Shift State`, `Power`, `Regen`, `Source`
  - `<StatorTempChart />` → `web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx` — titles: `drivetrain.statorTempHistory`, `drivetrain.col.time`, `drivetrain.col.stator`, `drivetrain.col.statorRel`, `drivetrain.col.statorRer`, `Time`
  - `<TorqueHistoryChart />` → `web/src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx` — titles: `drivetrain.torqueHistory`, `drivetrain.col.time`, `drivetrain.col.torque`, `Time`, `Torque (Nm)`
  - `<TemperatureTrendChart />` → `web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx` — titles: `drivetrain.tempHistory`, `drivetrain.col.date`, `drivetrain.col.outside`, `Date`
  - `<PowerOutputChart />` → `web/src/features/driving/components/drivetrain-health/PowerOutputChart.tsx` — titles: `drivetrain.powerOutput`, `drivetrain.col.date`, `drivetrain.col.powerMax`, `drivetrain.col.powerMin`, `Date`, `Peak (kW)`, `Regen (kW)`
  - `<HealthRecommendations />` → `web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx` — titles: `Health Recommendations`
  - `<DetailCards />` → `web/src/features/driving/components/drivetrain-health/DetailCards.tsx` — titles: `Front Motor Temp`, `Rear Motor Temp`, `Inverter Temp`, `Battery Temp`, `Peak Power`, `Avg Peak Power`, `Max Regen`, `Total Regen`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `RadialGauge`
  - `LineChart`
  - `AreaChart`
  - _(no map)_

**Named panels/sections — implement every one (45 title(s) extracted from page + delegates):**

  1. Drivetrain Healthy
  2. Motor Details
  3. Drive Statistics
  4. Motor Status
  5. Overall Health
  6. Health Score
  7. Active Sensors
  8. Total Drives
  9. Total Distance
  10. Avg Speed
  11. Top Speed
  12. Temperature Gauges
  13. Thermal Load Indicators
  14. Live Motor Status
  15. Shift State
  16. Power
  17. Regen
  18. Source
  19. drivetrain.statorTempHistory
  20. drivetrain.col.time
  21. drivetrain.col.stator
  22. drivetrain.col.statorRel
  23. drivetrain.col.statorRer
  24. Time
  25. drivetrain.torqueHistory
  26. drivetrain.col.torque
  27. Torque (Nm)
  28. drivetrain.tempHistory
  29. drivetrain.col.date
  30. drivetrain.col.outside
  31. Date
  32. drivetrain.powerOutput
  33. drivetrain.col.powerMax
  34. drivetrain.col.powerMin
  35. Peak (kW)
  36. Regen (kW)
  37. Health Recommendations
  38. Front Motor Temp
  39. Rear Motor Temp
  40. Inverter Temp
  41. Battery Temp
  42. Peak Power
  43. Avg Peak Power
  44. Max Regen
  45. Total Regen

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=9` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=9`.

## Implementation spec (Microsoft Fluent Design + WinUI guidelines)

- Build a view-model that consumes a generated C# client + C# behavior port (ADR-004), bound via an ObservableObject ViewModel; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using XAML + C# and the design tokens (no hardcoded colors/typography; Microsoft Fluent Design + WinUI guidelines).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for windows; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/windows/TeslaSync/Features/Driving -Language csharp *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p2-windows/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 9 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `windows` ledger row for `page:driving/DrivetrainHealthPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/windows/TeslaSync/Features/Driving apps/parity/windows-ledger.json .github/prompts/monorepo/logs/windows-page-driving-DrivetrainHealthPage.log
git commit -m "feat(apps/windows): DrivetrainHealthPage at web parity (W7 driving)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
