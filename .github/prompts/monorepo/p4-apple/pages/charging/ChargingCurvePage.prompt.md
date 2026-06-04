---
description: "P4-APPLE P7 — charging/ChargingCurvePage at web parity (SwiftUI / HIG)"
---

# p4-apple · P7 · page:charging/ChargingCurvePage — SwiftUI / HIG

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** apple
> Native SwiftUI / HIG implementation of the web page `ChargingCurvePage` at full panel/state/string parity.
> If no Xcode runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:charging/ChargingCurvePage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/charging/pages/ChargingCurvePage.tsx` (261 LOC) |
| Output | `apps/apple/TeslaSync/Features/Charging/ChargingCurvePage.swift` (SwiftUI View + Observable model; adaptive macOS + iOS) |
| Allowed files | `apps/apple/TeslaSync/Features/Charging/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/apple-page-charging-ChargingCurvePage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Parity unit — implement ALL (extracted from the real web source)

**Data sources / hooks the page (and any delegated component) uses:**
  - `useTranslation`
  - `useSettings`
  - `usePageTitle`
  - `useSelectedVehicle`
  - `useRangeState`
  - `useChargingSessionsPaginated`
  - `useMemo`
  - `useFormatting`
  - `useChartPalette`

**Delegated feature components — open these too and port their panels:**
  - `<SummaryStatsGrid />` → `web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx` — titles: _(no titled panels in the delegate either)_
  - `<SessionCurveChart />` → `web/src/features/charging/components/charging-curve/SessionCurveChart.tsx` — titles: `charging.curve.powerVsSoc`, `charging.curve.col.soc`, `charging.curve.col.power`, `Power (kW)`
  - `<SessionDetailPanel />` → `web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx` — titles: `Session Details`
  - `<SessionComparisonChart />` → `web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx` — titles: `charging.curve.sessionComparison`
  - `<ChargerTypeChart />` → `web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx` — titles: `charging.curve.chargerType`, `charging.curve.col.charger`, `charging.curve.col.sessions`, `charging.curve.col.avgKw`, `charging.curve.col.avgKwh`, `charging.curve.col.avgMin`, `Charger Type`, `Sessions`, `Avg kW`, `Avg kWh`, `Avg minutes`
  - `<SpeedTrendChart />` → `web/src/features/charging/components/charging-curve/SpeedTrendChart.tsx` — titles: `charging.curve.speedTrend`, `charging.curve.col.month`, `charging.curve.col.dcAvgKw`, `charging.curve.col.acAvgKw`, `Month`, `DC Avg kW`, `AC Avg kW`
  - `<TimeToChargeSection />` → `web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx` — titles: `Time-to-Charge Analysis`
  - `<LoadingSkeleton />` → `web/src/features/charging/components/charging-curve/LoadingSkeleton.tsx` — titles: _(no titled panels in the delegate either)_

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `AreaChart`
  - `LineChart`
  - `ComposedChart`
  - _(no map)_

**Named panels/sections — implement every one (28 title(s) extracted from page + delegates):**

  1. charging.curve.title
  2. Charging Curve
  3. No charging sessions to plot a curve.
  4. charging.curve.powerVsSoc
  5. charging.curve.col.soc
  6. charging.curve.col.power
  7. Power (kW)
  8. Session Details
  9. charging.curve.sessionComparison
  10. charging.curve.chargerType
  11. charging.curve.col.charger
  12. charging.curve.col.sessions
  13. charging.curve.col.avgKw
  14. charging.curve.col.avgKwh
  15. charging.curve.col.avgMin
  16. Charger Type
  17. Sessions
  18. Avg kW
  19. Avg kWh
  20. Avg minutes
  21. charging.curve.speedTrend
  22. charging.curve.col.month
  23. charging.curve.col.dcAvgKw
  24. charging.curve.col.acAvgKw
  25. Month
  26. DC Avg kW
  27. AC Avg kW
  28. Time-to-Charge Analysis

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=7` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=7`.

## Implementation spec (Apple Human Interface Guidelines (macOS + iOS))

- Build a view-model that consumes a KMP shared client + behavior port (ADR-004), bound via an Observable model and AsyncSequence; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using SwiftUI declarative views and the design tokens (no hardcoded colors/typography; Apple Human Interface Guidelines (macOS + iOS)).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for apple; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/Features/Charging -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p4-apple/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 7 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `apple` ledger row for `page:charging/ChargingCurvePage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/apple/TeslaSync/Features/Charging apps/parity/apple-ledger.json .github/prompts/monorepo/logs/apple-page-charging-ChargingCurvePage.log
git commit -m "feat(apps/apple): ChargingCurvePage at web parity (P7 charging)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
