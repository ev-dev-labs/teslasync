---
description: "P4-APPLE P7 — vehicles/VehicleDetailPage at web parity (SwiftUI / HIG)"
---

# p4-apple · P7 · page:vehicles/VehicleDetailPage — SwiftUI / HIG

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** apple
> Native SwiftUI / HIG implementation of the web page `VehicleDetailPage` at full panel/state/string parity.
> If no Xcode runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:vehicles/VehicleDetailPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/vehicles/pages/VehicleDetailPage.tsx` (269 LOC) |
| Output | `apps/apple/TeslaSync/Features/Vehicles/VehicleDetailPage.swift` (SwiftUI View + Observable model; adaptive macOS + iOS) |
| Allowed files | `apps/apple/TeslaSync/Features/Vehicles/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/apple-page-vehicles-VehicleDetailPage.log` |

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
  - `useQuery`
  - `useVehicleSettings`
  - `useToast`
  - `useMutation`
  - `useUnits`
  - `useDriveColumns`
  - `useChargeColumns`
  - `useFormatting`

**Delegated feature components — open these too and port their panels:**
  - `<StateResponse />` → `web/src/features/vehicles/components/vehicle-detail/helpers.ts` — titles: _(no titled panels in the delegate either)_
  - `<VehicleHeader />` → `web/src/features/vehicles/components/vehicle-detail/VehicleHeader.tsx` — titles: _(no titled panels in the delegate either)_
  - `<BatteryRangePanel />` → `web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx` — titles: _(no titled panels in the delegate either)_
  - `<LiveStateIndicators />` → `web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx` — titles: _(no titled panels in the delegate either)_
  - `<QuickStatsGrid />` → `web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx` — titles: _(no titled panels in the delegate either)_
  - `<MotorSection />` → `web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx` — titles: `Powertrain`
  - `<ClimateSection />` → `web/src/features/vehicles/components/vehicle-detail/ClimateSection.tsx` — titles: `Climate`
  - `<SecuritySection />` → `web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx` — titles: `Security`
  - `<TirePressureSection />` → `web/src/features/vehicles/components/vehicle-detail/TirePressureSection.tsx` — titles: `Tire Pressure`, `Front Left`, `Front Right`, `Rear Left`, `Rear Right`
  - `<ChargingTelemetrySection />` → `web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx` — titles: `Charging Telemetry`
  - `<BatteryRangeCharts />` → `web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx` — titles: `Battery Overview`, `Drive Distance Trend`
  - `<RecentDrivesSection />` → `web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx` — titles: `Recent Drives`
  - `<RecentChargesSection />` → `web/src/features/vehicles/components/vehicle-detail/RecentChargesSection.tsx` — titles: `Recent Charges`
  - `<VehicleConfigSection />` → `web/src/features/vehicles/components/vehicle-detail/VehicleConfigSection.tsx` — titles: `Vehicle Configuration`, `Car Type`, `Trim`, `Exterior Color`, `Wheels`, `Roof Color`, `Charge Port`, `Right-Hand Drive`, `Europe Vehicle`, `Offroad Lightbar`, `Rear Seat Heaters`, `Sunroof`, `Software`
  - `<QuickLinksSection />` → `web/src/features/vehicles/components/vehicle-detail/QuickLinksSection.tsx` — titles: `Quick Links`, `Drives`, `Charging`, `Battery`, `Climate`, `Efficiency`, `Settings`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `RadialGauge`
  - `BarChart`
  - `AreaChart`
  - _(no map)_

**Named panels/sections — implement every one (48 title(s) extracted from page + delegates):**

  1. vehicle-detail:header
  2. vehicle-detail:battery-range
  3. vehicle-detail:live-state
  4. vehicle-detail:quick-stats
  5. vehicle-detail:motor
  6. vehicle-detail:climate
  7. vehicle-detail:security
  8. vehicle-detail:tire-pressure
  9. vehicle-detail:charging-telemetry
  10. vehicle-detail:battery-charts
  11. vehicle-detail:recent-drives
  12. vehicle-detail:recent-charges
  13. vehicle-detail:vehicle-config
  14. vehicle-detail:ai-paint-preview
  15. vehicle-detail:quick-links
  16. vehicle-detail:settings
  17. Powertrain
  18. Climate
  19. Security
  20. Tire Pressure
  21. Front Left
  22. Front Right
  23. Rear Left
  24. Rear Right
  25. Charging Telemetry
  26. Battery Overview
  27. Drive Distance Trend
  28. Recent Drives
  29. Recent Charges
  30. Vehicle Configuration
  31. Car Type
  32. Trim
  33. Exterior Color
  34. Wheels
  35. Roof Color
  36. Charge Port
  37. Right-Hand Drive
  38. Europe Vehicle
  39. Offroad Lightbar
  40. Rear Seat Heaters
  41. Sunroof
  42. Software
  43. Quick Links
  44. Drives
  45. Charging
  46. Battery
  47. Efficiency
  48. Settings

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=5` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=5`.

## Implementation spec (Apple Human Interface Guidelines (macOS + iOS))

- Build a view-model that consumes a KMP shared client + behavior port (ADR-004), bound via an Observable model and AsyncSequence; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using SwiftUI declarative views and the design tokens (no hardcoded colors/typography; Apple Human Interface Guidelines (macOS + iOS)).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for apple; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/Features/Vehicles -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p4-apple/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 5 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `apple` ledger row for `page:vehicles/VehicleDetailPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/apple/TeslaSync/Features/Vehicles apps/parity/apple-ledger.json .github/prompts/monorepo/logs/apple-page-vehicles-VehicleDetailPage.log
git commit -m "feat(apps/apple): VehicleDetailPage at web parity (P7 vehicles)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
