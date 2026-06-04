---
description: "P4-APPLE P7 — driving/DrivingDynamicsPage at web parity (SwiftUI / HIG)"
---

# p4-apple · P7 · page:driving/DrivingDynamicsPage — SwiftUI / HIG

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** apple
> Native SwiftUI / HIG implementation of the web page `DrivingDynamicsPage` at full panel/state/string parity.
> If no Xcode runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:driving/DrivingDynamicsPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/driving/pages/DrivingDynamicsPage.tsx` (123 LOC) |
| Output | `apps/apple/TeslaSync/Features/Driving/DrivingDynamicsPage.swift` (SwiftUI View + Observable model; adaptive macOS + iOS) |
| Allowed files | `apps/apple/TeslaSync/Features/Driving/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/apple-page-driving-DrivingDynamicsPage.log` |

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
  - `useSelectedVehicle`
  - `useMotorLatest`
  - `useMotorHistory`
  - `useDrives`
  - `useDrivingCoach`
  - `useUnits`
  - `useState`
  - `useMemo`
  - `useDriveDynamicsLatest`
  - `useVehicleState`
  - `useSignalObservations`
  - `useDateFormat`
  - `useHiddenSeries`

**Delegated feature components — open these too and port their panels:**
  - `<LiveMotorStatus />` → `web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx` — titles: `Live Motor Status`
  - `<GForcePanel />` → `web/src/features/driving/components/driving-dynamics/GForcePanel.tsx` — titles: `Acceleration G-Force`
  - `<PedalUsage />` → `web/src/features/driving/components/driving-dynamics/PedalUsage.tsx` — titles: `Pedal Usage`
  - `<SpeedGearPanel />` → `web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx` — titles: `Speed & Gear`
  - `<AutopilotSection />` → `web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx` — titles: `Autopilot & Cruise`
  - `<MotorHistoryCharts />` → `web/src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx` — titles: `dynamics.powerOverTime`, `dynamics.torqueHistory`, `dynamics.rpmHistory`
  - `<MotorEfficiencyInsights />` → `web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx` — titles: `Torque Distribution`, `Throttle Behavior`, `Motor Thermal`
  - `<SummaryStats />` → `web/src/features/driving/components/driving-dynamics/SummaryStats.tsx` — titles: _(no titled panels in the delegate either)_
  - `<DrivingCoachSection />` → `web/src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx` — titles: `Driving Coach`, `Style Breakdown`, `Weekly Score Trend`, `Driving Patterns`, `Recommendations`, `Per-Drive Scores`, `Hard Acceleration`, `Hard Braking`, `Highway Driving`, `Cold Starts`
  - `<DriveAnalyticsSection />` → `web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx` — titles: `dynamics.speedDistribution`, `dynamics.accelPatterns`, `dynamics.powerProfile`, `Drive Analytics`, `dynamics.col.range`, `dynamics.col.drives`, `dynamics.col.drive`, `dynamics.col.maxKw`, `dynamics.col.regenKw`, `Speed range`, `Drives`, `Drive`, `Max kW`, `Regen kW`
  - `<DrivingTips />` → `web/src/features/driving/components/driving-dynamics/DrivingTips.tsx` — titles: `Driving Style Recommendations`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `RadialGauge`
  - `AreaChart`
  - `LineChart`
  - `BarChart`
  - `ScatterChart`
  - _(no map)_

**Named panels/sections — implement every one (36 title(s) extracted from page + delegates):**

  1. Live Motor Status
  2. Acceleration G-Force
  3. Pedal Usage
  4. Speed & Gear
  5. Autopilot & Cruise
  6. dynamics.powerOverTime
  7. dynamics.torqueHistory
  8. dynamics.rpmHistory
  9. Torque Distribution
  10. Throttle Behavior
  11. Motor Thermal
  12. Driving Coach
  13. Style Breakdown
  14. Weekly Score Trend
  15. Driving Patterns
  16. Recommendations
  17. Per-Drive Scores
  18. Hard Acceleration
  19. Hard Braking
  20. Highway Driving
  21. Cold Starts
  22. dynamics.speedDistribution
  23. dynamics.accelPatterns
  24. dynamics.powerProfile
  25. Drive Analytics
  26. dynamics.col.range
  27. dynamics.col.drives
  28. dynamics.col.drive
  29. dynamics.col.maxKw
  30. dynamics.col.regenKw
  31. Speed range
  32. Drives
  33. Drive
  34. Max kW
  35. Regen kW
  36. Driving Style Recommendations

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=12` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=12`.

## Implementation spec (Apple Human Interface Guidelines (macOS + iOS))

- Build a view-model that consumes a KMP shared client + behavior port (ADR-004), bound via an Observable model and AsyncSequence; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using SwiftUI declarative views and the design tokens (no hardcoded colors/typography; Apple Human Interface Guidelines (macOS + iOS)).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for apple; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/Features/Driving -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p4-apple/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 12 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `apple` ledger row for `page:driving/DrivingDynamicsPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/apple/TeslaSync/Features/Driving apps/parity/apple-ledger.json .github/prompts/monorepo/logs/apple-page-driving-DrivingDynamicsPage.log
git commit -m "feat(apps/apple): DrivingDynamicsPage at web parity (P7 driving)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
