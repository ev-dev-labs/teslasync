---
description: "P4-APPLE P7 — dashboard/DashboardPage at web parity (SwiftUI / HIG)"
---

# p4-apple · P7 · page:dashboard/DashboardPage — SwiftUI / HIG

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** apple
> Native SwiftUI / HIG implementation of the web page `DashboardPage` at full panel/state/string parity.
> If no Xcode runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:dashboard/DashboardPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/dashboard/pages/DashboardPage.tsx` (746 LOC) |
| Output | `apps/apple/TeslaSync/Features/Dashboard/DashboardPage.swift` (SwiftUI View + Observable model; adaptive macOS + iOS) |
| Allowed files | `apps/apple/TeslaSync/Features/Dashboard/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/apple-page-dashboard-DashboardPage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Parity unit — implement ALL (extracted from the real web source)

**Data sources / hooks the page (and any delegated component) uses:**
  - `useTranslation`
  - `useTheme`
  - `usePageTitle`
  - `useQueryClient`
  - `useDashboardLayout`
  - `useState`
  - `useLayoutKeyboard`
  - `useEffect`
  - `useKioskMode`
  - `useAuthStatus`
  - `useSyncVehicles`
  - `useRealtimeEvents`
  - `useQuery`
  - `useContainerWidth`
  - `useVehicles`
  - `useConfirm`
  - `useSelectedVehicle`
  - `useCategoryIcons`
  - `useDateFormat`
  - `useRecentPages`

**Delegated feature components — open these too and port their panels:**
  - `<DashboardGrid />` → `web/src/features/dashboard/components/DashboardGrid.tsx` — titles: _(no titled panels in the delegate either)_
  - `<WidgetPicker />` → `web/src/features/dashboard/components/WidgetPicker.tsx` — titles: `Recently Added`, `Layout Presets`
  - `<WidgetSettingsModal />` → `web/src/features/dashboard/components/WidgetSettingsModal.tsx` — titles: `dashboard.settings.vehicle`, `dashboard.settings.refreshInterval`, `dashboard.settings.timeRange`, `dashboard.settings.appearance`, `dashboard.settings.allVehicles`, `dashboard.settings.default`, `dashboard.settings.5s`, `dashboard.settings.15s`, `dashboard.settings.30s`, `dashboard.settings.60s`, `dashboard.settings.24h`, `dashboard.settings.7d`, `dashboard.settings.30d`, `dashboard.settings.90d`, `All Vehicles (first)`, `Default`, `Last 24 hours`, `Last 7 days`, `Last 30 days`, `Last 90 days`
  - `<LayoutManager />` → `web/src/features/dashboard/components/LayoutManager.tsx` — titles: _(no titled panels in the delegate either)_
  - `<LayoutSwitcher />` → `web/src/features/dashboard/components/LayoutSwitcher.tsx` — titles: `Layout`, `Manage layouts in the tab strip below`
  - `<TemplateGallery />` → `web/src/features/dashboard/components/TemplateGallery.tsx` — titles: `Blank Dashboard`
  - `<ExportModal />` → `web/src/features/dashboard/components/ExportModal.tsx` — titles: _(no titled panels in the delegate either)_
  - `<ImportPreviewModal />` → `web/src/features/dashboard/components/ImportPreviewModal.tsx` — titles: `Widgets`, `import.fromFile`, `import.fromClipboard`, `import.fromUrl`, `From File`, `Paste JSON`, `From URL`
  - `<DashboardSettingsModal />` → `web/src/features/dashboard/components/DashboardSettingsModal.tsx` — titles: `Identity`, `Vehicle Filter`, `Auto-Refresh`, `Display`, `Default (per widget)`, `Every 5 seconds`, `Every 10 seconds`, `Every 30 seconds`, `Every minute`, `Every 5 minutes`, `All Vehicles`
  - `<KioskOverlay />` → `web/src/features/dashboard/components/KioskOverlay.tsx` — titles: _(no titled panels in the delegate either)_
  - `<KioskSettingsModal />` → `web/src/features/dashboard/components/KioskSettingsModal.tsx` — titles: `kiosk.rotation`, `kiosk.display`, `kiosk.transparency`, `Off`, `10s`, `15s`, `30s`, `1 min`, `2 min`, `5 min`, `3s`, `5s`, `Never`, `10 min`, `15 min`, `30 min`, `60 min`, `Top Left`, `Top Right`, `Bottom Left`, `Bottom Right`
  - `<AddWidgetButton />` → `web/src/features/dashboard/components/AddWidgetButton.tsx` — titles: _(no titled panels in the delegate either)_
  - `<WidgetCatalogueDialog />` → `web/src/features/dashboard/components/WidgetCatalogueDialog.tsx` — titles: `No widgets match your search`
  - `<RecentlyViewedWidget />` → `web/src/features/dashboard/components/RecentlyViewedWidget.tsx` — titles: `Recently Viewed`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - _(no charts)_
  - _(no map)_

**Named panels/sections — implement every one (71 title(s) extracted from page + delegates):**

  1. Sync Your Vehicles
  2. Real-time Tracking
  3. Drive History
  4. Charge Analytics
  5. Vehicle Control
  6. Recently Added
  7. Layout Presets
  8. dashboard.settings.vehicle
  9. dashboard.settings.refreshInterval
  10. dashboard.settings.timeRange
  11. dashboard.settings.appearance
  12. dashboard.settings.allVehicles
  13. dashboard.settings.default
  14. dashboard.settings.5s
  15. dashboard.settings.15s
  16. dashboard.settings.30s
  17. dashboard.settings.60s
  18. dashboard.settings.24h
  19. dashboard.settings.7d
  20. dashboard.settings.30d
  21. dashboard.settings.90d
  22. All Vehicles (first)
  23. Default
  24. Last 24 hours
  25. Last 7 days
  26. Last 30 days
  27. Last 90 days
  28. Layout
  29. Manage layouts in the tab strip below
  30. Blank Dashboard
  31. Widgets
  32. import.fromFile
  33. import.fromClipboard
  34. import.fromUrl
  35. From File
  36. Paste JSON
  37. From URL
  38. Identity
  39. Vehicle Filter
  40. Auto-Refresh
  41. Display
  42. Default (per widget)
  43. Every 5 seconds
  44. Every 10 seconds
  45. Every 30 seconds
  46. Every minute
  47. Every 5 minutes
  48. All Vehicles
  49. kiosk.rotation
  50. kiosk.display
  51. kiosk.transparency
  52. Off
  53. 10s
  54. 15s
  55. 30s
  56. 1 min
  57. 2 min
  58. 5 min
  59. 3s
  60. 5s
  61. Never
  62. 10 min
  63. 15 min
  64. 30 min
  65. 60 min
  66. Top Left
  67. Top Right
  68. Bottom Left
  69. Bottom Right
  70. No widgets match your search
  71. Recently Viewed

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
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/Features/Dashboard -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p4-apple/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 5 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `apple` ledger row for `page:dashboard/DashboardPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/apple/TeslaSync/Features/Dashboard apps/parity/apple-ledger.json .github/prompts/monorepo/logs/apple-page-dashboard-DashboardPage.log
git commit -m "feat(apps/apple): DashboardPage at web parity (P7 dashboard)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
