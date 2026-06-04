---
description: "P2-WINDOWS W7 — driving/DriveDetailPage at web parity (WinUI 3 / Fluent)"
---

# p2-windows · W7 · page:driving/DriveDetailPage — WinUI 3 / Fluent

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** windows
> Native WinUI 3 / Fluent implementation of the web page `DriveDetailPage` at full panel/state/string parity.
> If no .NET/Windows runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:driving/DriveDetailPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/driving/pages/DriveDetailPage.tsx` (219 LOC) |
| Output | `apps/windows/TeslaSync/Features/Driving/DriveDetailPage.xaml` (+ view-model) |
| Allowed files | `apps/windows/TeslaSync/Features/Driving/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/windows-page-driving-DriveDetailPage.log` |

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
  - `useDriveDetailData`
  - `useState`
  - `useCreateShareLink`
  - `useShareLinks`
  - `useRevokeShareLink`
  - `useSettings`
  - `useUnits`
  - `useFormatting`
  - `useMap`
  - `useSyncedCursor`
  - `useSyncedReferenceLineX`
  - `useDriveWhyEnded`

**Delegated feature components — open these too and port their panels:**
  - `<ShareDriveDialog />` → `web/src/features/driving/components/ShareDriveDialog.tsx` — titles: `Active Share Links`, `share.expiry7d`, `share.expiry30d`, `share.expiry90d`, `share.expiryNever`, `Never`
  - `<DriveDetailSkeleton />` → `web/src/features/driving/components/drive-detail/DriveDetailSkeleton.tsx` — titles: _(no titled panels in the delegate either)_
  - `<DriveDetailHeader />` → `web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx` — titles: `Drive Details`
  - `<HeroGauges />` → `web/src/features/driving/components/drive-detail/HeroGauges.tsx` — titles: _(no titled panels in the delegate either)_
  - `<DriveTimeline />` → `web/src/features/driving/components/drive-detail/DriveTimeline.tsx` — titles: _(no titled panels in the delegate either)_
  - `<DriveStatCards />` → `web/src/features/driving/components/drive-detail/DriveStatCards.tsx` — titles: _(no titled panels in the delegate either)_
  - `<MoreDetailsPanel />` → `web/src/features/driving/components/drive-detail/MoreDetailsPanel.tsx` — titles: `More Details`
  - `<EnergySummaryPanel />` → `web/src/features/driving/components/drive-detail/EnergySummaryPanel.tsx` — titles: `Energy Summary`
  - `<CostSavingsPanel />` → `web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx` — titles: `Cost & Savings`
  - `<RouteMapSection />` → `web/src/features/driving/components/drive-detail/RouteMapSection.tsx` — titles: `driveDetail.stationaryRouteTitle`, `Route`, `Start`, `End`, `Last known location`
  - `<JourneyDetailsPanel />` → `web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx` — titles: `Journey Details`
  - `<DriveOverviewChart />` → `web/src/features/driving/components/drive-detail/DriveOverviewChart.tsx` — titles: `driveDetail.driveChart`, `Speed`, `Range (ideal)`, `Range (est.)`, `SOC`, `Usable SOC`, `Power`
  - `<SocChart />` → `web/src/features/driving/components/drive-detail/SocChart.tsx` — titles: `driveDetail.socOverTime`
  - `<ElevationChart />` → `web/src/features/driving/components/drive-detail/ElevationChart.tsx` — titles: `driveDetail.elevProfile`
  - `<TemperatureSection />` → `web/src/features/driving/components/drive-detail/TemperatureSection.tsx` — titles: `driveDetail.temperatures`, `Avg`
  - `<SpeedHistogramChart />` → `web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx` — titles: `driveDetail.speedHistogram`, `driveDetail.col.range`, `driveDetail.col.pct`, `Speed range`
  - `<PowerProfileChart />` → `web/src/features/driving/components/drive-detail/PowerProfileChart.tsx` — titles: `driveDetail.powerProfile`
  - `<TirePressureSection />` → `web/src/features/driving/components/drive-detail/TirePressureSection.tsx` — titles: `driveDetail.tirePressure`, `Front Left`, `Front Right`, `Rear Left`, `Rear Right`
  - `<WhyEndedPanel />` → `web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx` — titles: `t(`, `Why did this drive end?`, `FSM transitions`, `Signal window`, `Retry`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `RadialGauge`
  - `ComposedChart`
  - `AreaChart`
  - `LineChart`
  - `BarChart`
  - Leaflet map composed via `@/components/maps`

**Named panels/sections — implement every one (62 title(s) extracted from page + delegates):**

  1. driveDetail.noTelemetryTitle
  2. drive-detail:header
  3. drive-detail:hero-gauges
  4. drive-detail:timeline
  5. drive-detail:stat-cards
  6. drive-detail:ai-coaching
  7. drive-detail:more-details
  8. drive-detail:energy-summary
  9. drive-detail:cost-savings
  10. drive-detail:route-map
  11. drive-detail:journey-details
  12. drive-detail:overview-chart
  13. drive-detail:soc-chart
  14. drive-detail:elevation-chart
  15. drive-detail:temperature
  16. drive-detail:speed-histogram
  17. drive-detail:ai-speed-profile-insights
  18. drive-detail:power-profile
  19. drive-detail:tire-pressure
  20. drive-detail:why-ended
  21. Active Share Links
  22. share.expiry7d
  23. share.expiry30d
  24. share.expiry90d
  25. share.expiryNever
  26. Never
  27. Drive Details
  28. More Details
  29. Energy Summary
  30. Cost & Savings
  31. driveDetail.stationaryRouteTitle
  32. Route
  33. Start
  34. End
  35. Last known location
  36. Journey Details
  37. driveDetail.driveChart
  38. Speed
  39. Range (ideal)
  40. Range (est.)
  41. SOC
  42. Usable SOC
  43. Power
  44. driveDetail.socOverTime
  45. driveDetail.elevProfile
  46. driveDetail.temperatures
  47. Avg
  48. driveDetail.speedHistogram
  49. driveDetail.col.range
  50. driveDetail.col.pct
  51. Speed range
  52. driveDetail.powerProfile
  53. driveDetail.tirePressure
  54. Front Left
  55. Front Right
  56. Rear Left
  57. Rear Right
  58. t(
  59. Why did this drive end?
  60. FSM transitions
  61. Signal window
  62. Retry

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=8` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=8`.

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
- [ ] All 8 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `windows` ledger row for `page:driving/DriveDetailPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/windows/TeslaSync/Features/Driving apps/parity/windows-ledger.json .github/prompts/monorepo/logs/windows-page-driving-DriveDetailPage.log
git commit -m "feat(apps/windows): DriveDetailPage at web parity (W7 driving)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
