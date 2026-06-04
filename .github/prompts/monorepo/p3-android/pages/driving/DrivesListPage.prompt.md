---
description: "P3-ANDROID A7 — driving/DrivesListPage at web parity (Compose / Material 3)"
---

# p3-android · A7 · page:driving/DrivesListPage — Compose / Material 3

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** android
> Native Compose / Material 3 implementation of the web page `DrivesListPage` at full panel/state/string parity.
> If no Android SDK / Gradle runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:driving/DrivesListPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/driving/pages/DrivesListPage.tsx` (994 LOC) |
| Output | `apps/android/app/src/main/kotlin/com/teslasync/driving/DrivesListPage.kt` (@Composable screen + ViewModel) |
| Allowed files | `apps/android/app/src/main/kotlin/com/teslasync/driving/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/android-page-driving-DrivesListPage.log` |

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
  - `useDrives`
  - `useTimezone`
  - `useUnits`
  - `useCallback`
  - `useFormatting`
  - `useUrlNumber`
  - `useUrlString`
  - `useMemo`
  - `useUrlBatch`
  - `useDeferredValue`
  - `useEffect`
  - `useBulkDeleteDrives`

**Delegated feature components — open these too and port their panels:**
  - `<NoVehicleSelected />` → `web/src/features/onboarding/components/NoVehicleSelected.tsx` — titles: `title`, `Set up TeslaSync`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - _(no charts)_
  - _(no map)_

**Named panels/sections — implement every one (32 title(s) extracted from page + delegates):**

  1. drives.overTime
  2. All Drives
  3. drives.metric.drives
  4. drives.metric.distance
  5. drives.metric.score
  6. drives.metric.efficiency
  7. drives.metric.cost
  8. bulk.actions.delete
  9. drives.coll.all
  10. drives.coll.anomalies
  11. drives.coll.notable
  12. drives.coll.commutes
  13. drives.coll.tagged
  14. drives.filterLabel.search
  15. drives.filterLabel.collection
  16. Drives
  17. Distance
  18. Score
  19. Efficiency
  20. Cost
  21. Delete
  22. View anomalies
  23. All
  24. Anomalies
  25. Notable
  26. Commutes
  27. Tagged
  28. Search
  29. View
  30. Reset filters
  31. title
  32. Set up TeslaSync

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=4` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=4`.

## Implementation spec (Google Material 3 + Android UX guidelines)

- Build a view-model that consumes a Kotlin Multiplatform shared client (KMP) + behavior port (ADR-004), bound via a Hilt-scoped ViewModel exposing StateFlow; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using Jetpack Compose @Composable and the design tokens (no hardcoded colors/typography; Google Material 3 + Android UX guidelines).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for android; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/android/app/src/main/kotlin/com/teslasync/driving -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p3-android/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 4 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `android` ledger row for `page:driving/DrivesListPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/android/app/src/main/kotlin/com/teslasync/driving apps/parity/android-ledger.json .github/prompts/monorepo/logs/android-page-driving-DrivesListPage.log
git commit -m "feat(apps/android): DrivesListPage at web parity (A7 driving)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
