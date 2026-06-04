---
description: "P2-WINDOWS W7 — charging/CostAnalysisPage at web parity (WinUI 3 / Fluent)"
---

# p2-windows · W7 · page:charging/CostAnalysisPage — WinUI 3 / Fluent

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** windows
> Native WinUI 3 / Fluent implementation of the web page `CostAnalysisPage` at full panel/state/string parity.
> If no .NET/Windows runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:charging/CostAnalysisPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/charging/pages/CostAnalysisPage.tsx` (168 LOC) |
| Output | `apps/windows/TeslaSync/Features/Charging/CostAnalysisPage.xaml` (+ view-model) |
| Allowed files | `apps/windows/TeslaSync/Features/Charging/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/windows-page-charging-CostAnalysisPage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Parity unit — implement ALL (extracted from the real web source)

**Data sources / hooks the page (and any delegated component) uses:**
  - `useTranslation`
  - `usePageTitle`
  - `useSavedViewUrl`
  - `useSettings`
  - `useUnits`
  - `useSelectedVehicle`
  - `useMemo`
  - `useUrlString`
  - `useUrlBatch`
  - `useState`
  - `useChargingSessionsPaginated`
  - `useCostForecast`
  - `useCostAnalysisData`
  - `useFormatting`
  - `useChartPalette`

**Delegated feature components — open these too and port their panels:**
  - `<CostSummaryCards />` → `web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx` — titles: _(no titled panels in the delegate either)_
  - `<MonthlyCostChart />` → `web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx` — titles: `costAnalysis.charts.monthlyCost`, `costAnalysis.charts.col.month`, `costAnalysis.charts.col.cost`, `Month`
  - `<CostPerKwhChart />` → `web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx` — titles: `Cost per kWh Trend`
  - `<ChargerTypeBreakdown />` → `web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx` — titles: `Cost by Charger Type`
  - `<SavingsCalculator />` → `web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx` — titles: `Gas vs Electric Savings Calculator`, `Your Assumptions`, `Comparison`
  - `<MonthlyCostTable />` → `web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx` — titles: `Monthly Cost Breakdown`
  - `<TimeOfUseAnalysis />` → `web/src/features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx` — titles: `Electricity Rate Analysis (Time-of-Use)`, `Insights`
  - `<CostForecastSection />` → `web/src/features/charging/components/cost-analysis/CostForecastSection.tsx` — titles: `Cost Forecast`, `Cost per kWh Trend`
  - `<LifetimeSummary />` → `web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx` — titles: `Lifetime Summary`
  - `<EnvironmentalImpact />` → `web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx` — titles: `Environmental Impact`
  - `<LoadingSkeleton />` → `web/src/features/charging/components/cost-analysis/LoadingSkeleton.tsx` — titles: _(no titled panels in the delegate either)_

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `AreaChart`
  - `LineChart`
  - `PieChart`
  - `BarChart`
  - `ComposedChart`
  - _(no map)_

**Named panels/sections — implement every one (15 title(s) extracted from page + delegates):**

  1. costAnalysis.charts.monthlyCost
  2. costAnalysis.charts.col.month
  3. costAnalysis.charts.col.cost
  4. Month
  5. Cost per kWh Trend
  6. Cost by Charger Type
  7. Gas vs Electric Savings Calculator
  8. Your Assumptions
  9. Comparison
  10. Monthly Cost Breakdown
  11. Electricity Rate Analysis (Time-of-Use)
  12. Insights
  13. Cost Forecast
  14. Lifetime Summary
  15. Environmental Impact

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
& ./apps/tools/check-placeholders.ps1 -Path apps/windows/TeslaSync/Features/Charging -Language csharp *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p2-windows/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 9 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `windows` ledger row for `page:charging/CostAnalysisPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/windows/TeslaSync/Features/Charging apps/parity/windows-ledger.json .github/prompts/monorepo/logs/windows-page-charging-CostAnalysisPage.log
git commit -m "feat(apps/windows): CostAnalysisPage at web parity (W7 charging)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
