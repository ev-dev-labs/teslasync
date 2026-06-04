---
description: "P4-APPLE P7 — battery/BatteryHealthPage at web parity (SwiftUI / HIG)"
---

# p4-apple · P7 · page:battery/BatteryHealthPage — SwiftUI / HIG

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** apple
> Native SwiftUI / HIG implementation of the web page `BatteryHealthPage` at full panel/state/string parity.
> If no Xcode runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:battery/BatteryHealthPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/battery/pages/BatteryHealthPage.tsx` (1030 LOC) |
| Output | `apps/apple/TeslaSync/Features/Battery/BatteryHealthPage.swift` (SwiftUI View + Observable model; adaptive macOS + iOS) |
| Allowed files | `apps/apple/TeslaSync/Features/Battery/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/apple-page-battery-BatteryHealthPage.log` |

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
  - `useUnits`
  - `useCallback`
  - `useAlertContext`
  - `useSelectedVehicle`
  - `useMemo`
  - `useBatteryHealthAnalytics`
  - `useBatteryDegradation`
  - `useChargingSessionsPaginated`
  - `useChargingTelemetryLatest`

**Delegated feature components — open these too and port their panels:**
  - `<NoVehicleSelected />` → `web/src/features/onboarding/components/NoVehicleSelected.tsx` — titles: `title`, `Set up TeslaSync`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `RadialGauge`
  - `ComposedChart`
  - `AreaChart`
  - `BarChart`
  - `PieChart`
  - _(no map)_

**Named panels/sections — implement every one (30 title(s) extracted from page + delegates):**

  1. battery.chart.capacityTrend
  2. battery.chart.rangeTrend
  3. battery.chart.acdc
  4. battery:health-hero
  5. battery:metric-bars
  6. battery:summary-cards
  7. battery:thermal
  8. battery:insights
  9. battery:charge-level-dist
  10. battery:capacity-range
  11. battery:acdc-breakdown
  12. battery:quick-links
  13. battery:recommendations
  14. Thermal Monitoring
  15. Smart Insights
  16. Charge Level Distribution
  17. Capacity & Range: New vs Now
  18. Charging Statistics
  19. Years to 80%
  20. Capacity When New
  21. Capacity Now
  22. Range When New
  23. Range Now
  24. Total Sessions
  25. AC Sessions
  26. DC / Supercharger
  27. Total Energy Added
  28. Charge Cycles
  29. title
  30. Set up TeslaSync

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=11` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=11`.

## Implementation spec (Apple Human Interface Guidelines (macOS + iOS))

- Build a view-model that consumes a KMP shared client + behavior port (ADR-004), bound via an Observable model and AsyncSequence; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using SwiftUI declarative views and the design tokens (no hardcoded colors/typography; Apple Human Interface Guidelines (macOS + iOS)).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for apple; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/Features/Battery -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p4-apple/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 11 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `apple` ledger row for `page:battery/BatteryHealthPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/apple/TeslaSync/Features/Battery apps/parity/apple-ledger.json .github/prompts/monorepo/logs/apple-page-battery-BatteryHealthPage.log
git commit -m "feat(apps/apple): BatteryHealthPage at web parity (P7 battery)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
