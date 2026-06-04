---
description: "P4-APPLE P7 — system/DataExportPage at web parity (SwiftUI / HIG)"
---

# p4-apple · P7 · page:system/DataExportPage — SwiftUI / HIG

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** apple
> Native SwiftUI / HIG implementation of the web page `DataExportPage` at full panel/state/string parity.
> If no Xcode runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:system/DataExportPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/system/pages/DataExportPage.tsx` (1269 LOC) |
| Output | `apps/apple/TeslaSync/Features/System/DataExportPage.swift` (SwiftUI View + Observable model; adaptive macOS + iOS) |
| Allowed files | `apps/apple/TeslaSync/Features/System/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/apple-page-system-DataExportPage.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Parity unit — implement ALL (extracted from the real web source)

**Data sources / hooks the page (and any delegated component) uses:**
  - `useTranslation`
  - `useMemo`
  - `useState`
  - `useCallback`
  - `useExportColumns`
  - `useCreateAccountExport`
  - `useQueryClient`
  - `useToast`
  - `usePageTitle`
  - `useMutation`
  - `useScheduledExports`
  - `useCreateScheduledExport`
  - `useUpdateScheduledExport`
  - `useDeleteScheduledExport`
  - `useRunScheduledExportNow`

**Delegated feature components — open these too and port their panels:**
  - `<ScheduledExportsPanel />` → `web/src/features/system/pages/ScheduledExportsPanel.tsx` — titles: `dataExport.scheduled.empty`, `Scheduled exports`, `Name`, `Cron expression`, `Export type`, `Format`, `Range window`, `Delivery kind`, `Delivery target`

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - _(no charts)_
  - _(no map)_

**Named panels/sections — implement every one (35 title(s) extracted from page + delegates):**

  1. row.error_message
  2. dataExport.noExports
  3. dataExport.title
  4. New Export
  5. Export History
  6. Download my data
  7. CSV Preview
  8. JSON Preview
  9. Data Overview
  10. STEP 1 — Select Data Type
  11. STEP 2 — Choose Format
  12. STEP 3 — Select Vehicle
  13. STEP 4 — Date Range
  14. STEP 2½ — Columns
  15. Required
  16. Drives
  17. Charging
  18. Trips
  19. Analytics
  20. Full Backup
  21. Maintenance
  22. Energy
  23. CSV
  24. JSON
  25. dataExport.account.allVehicles
  26. All vehicles
  27. dataExport.scheduled.empty
  28. Scheduled exports
  29. Name
  30. Cron expression
  31. Export type
  32. Format
  33. Range window
  34. Delivery kind
  35. Delivery target

> If the count of extracted titles is less than the total region count in the web source,
> the difference is anonymous `<GlassPanel>` regions (containers grouping content with a sibling heading
> or none). Open the web source AND every delegated component listed above and reproduce **every** region
> in the same data + grouping + order.

**States (for EACH data source):** loading → native skeleton/redacted; empty → EmptyState/ContentUnavailable; error → error + Retry. Never blank.

**Strings:** Every visible string resolves from the platform string catalog — zero hardcoded literals. Source the i18n keys used by the web page (and its delegated components) and port the same key names.

`PARITY_REQUIRED=8` (named sections + charts + map + data-source states). The `=== PARITY ===`
log section must enumerate each with binding evidence and reach `PARITY_COVERED=8`.

## Implementation spec (Apple Human Interface Guidelines (macOS + iOS))

- Build a view-model that consumes a KMP shared client + behavior port (ADR-004), bound via an Observable model and AsyncSequence; expose typed state + `load()`/`refresh()` and (if any live hook above) an SSE subscription tied to the view lifecycle with >2 min staleness indication (ADR-013).
- Lay out every panel above using SwiftUI declarative views and the design tokens (no hardcoded colors/typography; Apple Human Interface Guidelines (macOS + iOS)).
- Implement loading/empty/error for each source; honor dark mode, theme resources, pointer + keyboard, and accessibility (labels/traits on panels + charts, ≥ touch target sizes) per ADR-015.
- Units/formatting MUST use the shared SI converters (P1/S5) at the display boundary — never store/compute non-SI.

## Gate

```powershell
# Build + test + lint + placeholder-scan for apple; EXIT=0 only if all pass AND PARITY_COVERED==PARITY_REQUIRED.
& ./apps/tools/check-placeholders.ps1 -Path apps/apple/TeslaSync/Features/System -Language swift *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p4-apple/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 8 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `apple` ledger row for `page:system/DataExportPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/apple/TeslaSync/Features/System apps/parity/apple-ledger.json .github/prompts/monorepo/logs/apple-page-system-DataExportPage.log
git commit -m "feat(apps/apple): DataExportPage at web parity (P7 system)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
