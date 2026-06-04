---
description: "P2-WINDOWS W7 — charging/ChargingListPage at web parity (WinUI 3 / Fluent)"
---

# p2-windows · W7 · page:charging/ChargingListPage — WinUI 3 / Fluent

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** windows
> Native WinUI 3 / Fluent implementation of the web page `ChargingListPage` at full panel/state/string parity.
> If no .NET/Windows runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:charging/ChargingListPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/charging/pages/ChargingListPage.tsx` (943 LOC) |
| Output | `apps/windows/TeslaSync/Features/Charging/ChargingListPage.xaml` (+ view-model) |
| Allowed files | `apps/windows/TeslaSync/Features/Charging/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/windows-page-charging-ChargingListPage.log` |

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
  - `useSelectedVehicle`
  - `useTimezone`
  - `useUnits`
  - `useCallback`
  - `useFormatting`
  - `useMemo`
  - `useUrlString`
  - `useUrlBoolean`
  - `useUrlNumber`
  - `useUrlBatch`
  - `useChargingSessionsPaginated`
  - `useChargingOptimizer`
  - `useDeferredValue`
  - `useEffect`
  - `useBulkDeleteCharging`

**Delegated feature components — open these too and port their panels:**
  - `<NoVehicleSelected />` → `web/src/features/onboarding/components/NoVehicleSelected.tsx` — titles: `title`, `Set up TeslaSync`
  - `<ChargingSessionCard />` → `web/src/features/charging/components/ChargingSessionCard.tsx` — titles: _(no titled panels in the delegate either)_
  - `<AcDcStatsPanel />` → `web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx` — titles: `Charging Stats by Type`, `AC Charging`, `DC Charging`
  - `<BatteryLevelChart />` → `web/src/features/charging/components/charging-list/BatteryLevelChart.tsx` — titles: `Battery Level at Charge Start`
  - `<EfficiencyPanel />` → `web/src/features/charging/components/charging-list/EfficiencyPanel.tsx` — titles: `Charging Efficiency`
  - `<ChargerSpecsPanel />` → `web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx` — titles: `Charger Specs Breakdown`
  - `<OptimizerSection />` → `web/src/features/charging/components/charging-list/OptimizerSection.tsx` — titles: `Charging Habits`, `Cost Analysis`, `Optimization Recommendations`, `Sessions/week`, `Home charging`, `Avg charge target`, `Common start hour`, `Most common`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `BarChart`
  - `RadialGauge`
  - _(no map)_

**Named panels/sections — implement every one (58 title(s) extracted from page + delegates):**

  1. charging.overTime
  2. All sessions
  3. charging.metric.sessions
  4. charging.metric.energy
  5. charging.metric.cost
  6. charging.metric.power
  7. bulk.actions.delete
  8. charging.coll.all
  9. charging.coll.home
  10. charging.coll.supercharger
  11. charging.coll.dc
  12. charging.coll.free
  13. charging.coll.anomalies
  14. charging.coll.notable
  15. charging.coll.tagged
  16. charging.sort.date
  17. charging.sort.energy
  18. charging.sort.cost
  19. charging.sort.duration
  20. charging.sort.power
  21. charging.filterLabel.search
  22. charging.filterLabel.collection
  23. Sessions
  24. Energy
  25. Cost
  26. Avg power
  27. Delete
  28. View anomalies
  29. All
  30. Home
  31. Supercharger
  32. DC Fast
  33. Free
  34. Anomalies
  35. Notable
  36. Tagged
  37. Date
  38. Duration
  39. Power
  40. Search
  41. View
  42. Reset filters
  43. title
  44. Set up TeslaSync
  45. Charging Stats by Type
  46. AC Charging
  47. DC Charging
  48. Battery Level at Charge Start
  49. Charging Efficiency
  50. Charger Specs Breakdown
  51. Charging Habits
  52. Cost Analysis
  53. Optimization Recommendations
  54. Sessions/week
  55. Home charging
  56. Avg charge target
  57. Common start hour
  58. Most common

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=7` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=7`.

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
- [ ] All 7 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `windows` ledger row for `page:charging/ChargingListPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/windows/TeslaSync/Features/Charging apps/parity/windows-ledger.json .github/prompts/monorepo/logs/windows-page-charging-ChargingListPage.log
git commit -m "feat(apps/windows): ChargingListPage at web parity (W7 charging)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
