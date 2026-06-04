---
description: "P3-ANDROID A7 — battery/BatteryCellsPage at web parity (Compose / Material 3)"
---

# p3-android · A7 · page:battery/BatteryCellsPage — Compose / Material 3

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** android
> Native Compose / Material 3 implementation of the web page `BatteryCellsPage` at full panel/state/string parity.
> If no Android SDK / Gradle runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:battery/BatteryCellsPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/battery/pages/BatteryCellsPage.tsx` (889 LOC) |
| Output | `apps/android/app/src/main/kotlin/com/teslasync/battery/BatteryCellsPage.kt` (@Composable screen + ViewModel) |
| Allowed files | `apps/android/app/src/main/kotlin/com/teslasync/battery/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/android-page-battery-BatteryCellsPage.log` |

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
  - `useState`
  - `useSelectedVehicle`
  - `useMemo`
  - `useSortToggle`

**Delegated feature components — open these too and port their panels:**
  _(this page implements its UI inline; nothing delegated)_

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - `BarChart`
  - `LineChart`
  - `AreaChart`
  - _(no map)_

**Named panels/sections — implement every one (16 title(s) extracted from page + delegates):**

  1. Cell
  2. battery.cells.chart.spreadTrend
  3. Temperature Summary
  4. Health Recommendations
  5. Cell Voltage Heatmap
  6. Cell Voltage Bar Chart
  7. Voltage Distribution
  8. Imbalance Trend
  9. Cell Voltage Over Time
  10. Cell Details
  11. Total Cells
  12. Pack Voltage
  13. Avg Cell V
  14. V Spread
  15. Temp Spread
  16. Normal Cells

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=5` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=5`.

## Implementation spec (Google Material 3 + Android UX guidelines)

- Build a view-model that consumes a Kotlin Multiplatform shared client (KMP) + behavior port (ADR-004), bound via a Hilt-scoped ViewModel exposing StateFlow; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using Jetpack Compose @Composable and the design tokens (no hardcoded colors/typography; Google Material 3 + Android UX guidelines).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for android; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/android/app/src/main/kotlin/com/teslasync/battery -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p3-android/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 5 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `android` ledger row for `page:battery/BatteryCellsPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/android/app/src/main/kotlin/com/teslasync/battery apps/parity/android-ledger.json .github/prompts/monorepo/logs/android-page-battery-BatteryCellsPage.log
git commit -m "feat(apps/android): BatteryCellsPage at web parity (A7 battery)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
