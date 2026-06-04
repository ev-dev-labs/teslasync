---
description: "P3-ANDROID A7 — analytics/PeriodComparePage at web parity (Compose / Material 3)"
---

# p3-android · A7 · page:analytics/PeriodComparePage — Compose / Material 3

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** android
> Native Compose / Material 3 implementation of the web page `PeriodComparePage` at full panel/state/string parity.
> If no Android SDK / Gradle runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:analytics/PeriodComparePage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/analytics/pages/PeriodComparePage.tsx` (454 LOC) |
| Output | `apps/android/app/src/main/kotlin/com/teslasync/analytics/PeriodComparePage.kt` (@Composable screen + ViewModel) |
| Allowed files | `apps/android/app/src/main/kotlin/com/teslasync/analytics/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/android-page-analytics-PeriodComparePage.log` |

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
  - `useUrlString`
  - `useChartPalette`
  - `useVehicles`
  - `useQuery`
  - `useEffect`
  - `useMemo`

**Delegated feature components — open these too and port their panels:**
  _(this page implements its UI inline; nothing delegated)_

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `BarChart`
  - _(no map)_

**Named panels/sections — implement every one (24 title(s) extracted from page + delegates):**

  1. Side-by-Side Comparison
  2. Comparison Details
  3. Insights
  4. compare.last7
  5. compare.last30
  6. compare.last90
  7. compare.lastYear
  8. compare.allTime
  9. compare.totalDistance
  10. compare.totalDrives
  11. compare.energyUsed
  12. compare.avgEfficiency
  13. compare.totalCost
  14. compare.co2Saved
  15. Last 7 days
  16. Last 30 days
  17. Last 90 days
  18. Last year
  19. All time
  20. Total Distance
  21. Total Drives
  22. Energy Used
  23. Avg Efficiency
  24. Total Cost

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=3` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=3`.

## Implementation spec (Google Material 3 + Android UX guidelines)

- Build a view-model that consumes a Kotlin Multiplatform shared client (KMP) + behavior port (ADR-004), bound via a Hilt-scoped ViewModel exposing StateFlow; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using Jetpack Compose @Composable and the design tokens (no hardcoded colors/typography; Google Material 3 + Android UX guidelines).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for android; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/android/app/src/main/kotlin/com/teslasync/analytics -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p3-android/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 3 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `android` ledger row for `page:analytics/PeriodComparePage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/android/app/src/main/kotlin/com/teslasync/analytics apps/parity/android-ledger.json .github/prompts/monorepo/logs/android-page-analytics-PeriodComparePage.log
git commit -m "feat(apps/android): PeriodComparePage at web parity (A7 analytics)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
