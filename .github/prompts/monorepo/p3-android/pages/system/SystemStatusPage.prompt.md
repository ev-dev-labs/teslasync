---
description: "P3-ANDROID A7 — system/SystemStatusPage at web parity (Compose / Material 3)"
---

# p3-android · A7 · page:system/SystemStatusPage — Compose / Material 3

> **Severity:** Parity page · **Delegation:** FORBIDDEN · **Target(s):** android
> Native Compose / Material 3 implementation of the web page `SystemStatusPage` at full panel/state/string parity.
> If no Android SDK / Gradle runner, gate → STATUS=BLOCKED. No placeholders (ADR-011).

## Artifact Metadata

| Field | Value |
|---|---|
| Parity unit | `page:system/SystemStatusPage` |
| Web route | `(unrouted)` |
| Route source | unrouted (reachable by direct import) |
| Web source | `web/src/features/system/pages/SystemStatusPage.tsx` (1055 LOC) |
| Output | `apps/android/app/src/main/kotlin/com/teslasync/system/SystemStatusPage.kt` (@Composable screen + ViewModel) |
| Allowed files | `apps/android/app/src/main/kotlin/com/teslasync/system/**`, nav registration, the platform string catalog, the log file |
| Depends on | platform shell/nav, component library, design tokens, shared state holders (P1/S8), live (P1/S4) |
| ADR refs | ADR-002, ADR-004, ADR-005, ADR-006, ADR-011, ADR-015 |
| Log | `../../logs/android-page-system-SystemStatusPage.log` |

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
  - `useQueryClient`
  - `useDateFormat`
  - `useFormatting`
  - `useSystemHealth`
  - `useStatusLiveSSE`
  - `useQuery`
  - `useAuthStatus`
  - `useBackupRuns`
  - `useBackupConfigs`
  - `useMaintenanceState`
  - `useNotificationStats`
  - `useVehicles`
  - `useMemo`
  - `useState`
  - `useEffect`
  - `useCallback`
  - `useToast`
  - `useMutation`
  - `useApiLogStats`
  - `useMQTTStatus`
  - `useIncidents`
  - `useUpdateMaintenance`
  - `useId`
  - `useWebErrorsSummary`

**Delegated feature components — open these too and port their panels:**
  - `<AccordionSection />` → `web/src/features/system/components/status/AccordionSection.tsx` — titles: _(no titled panels in the delegate either)_
  - `<AnomalyInlineRow />` → `web/src/features/system/components/status/AnomalyInlineRow.tsx` — titles: _(no titled panels in the delegate either)_
  - `<BackgroundWorkersCard />` → `web/src/features/system/components/status/BackgroundWorkersCard.tsx` — titles: _(no titled panels in the delegate either)_
  - `<BackupActionsCard />` → `web/src/features/system/components/status/BackupActionsCard.tsx` — titles: _(no titled panels in the delegate either)_
  - `<TeslaAuthCard />` → `web/src/features/system/components/status/TeslaAuthCard.tsx` — titles: `Tesla account`
  - `<TeslaApiUsageCard />` → `web/src/features/system/components/status/TeslaApiUsageCard.tsx` — titles: `Open API Logs`, `Tesla account`, `Top services`, `By method`
  - `<TelemetryPipelineCard />` → `web/src/features/system/components/status/TelemetryPipelineCard.tsx` — titles: _(no titled panels in the delegate either)_
  - `<UpdateAvailableCallout />` → `web/src/features/system/components/status/UpdateAvailableCallout.tsx` — titles: _(no titled panels in the delegate either)_
  - `<StatusPageSkeleton />` → `web/src/features/system/components/status/StatusPageSkeleton.tsx` — titles: _(no titled panels in the delegate either)_
  - `<LiveStatusPill />` → `web/src/features/system/components/status/LiveStatusPill.tsx` — titles: _(no titled panels in the delegate either)_
  - `<IncidentsCard />` → `web/src/features/system/components/status/IncidentsCard.tsx` — titles: _(no titled panels in the delegate either)_
  - `<ScheduledMaintenanceCard />` → `web/src/features/system/components/status/ScheduledMaintenanceCard.tsx` — titles: `Scheduled maintenance`
  - `<SubscribeCard />` → `web/src/features/system/components/status/SubscribeCard.tsx` — titles: `Get notified about incidents`
  - `<SLOTrackingCard />` → `web/src/features/system/components/status/SLOTrackingCard.tsx` — titles: `Target uptime percentage`
  - `<FrontendErrorsCard />` → `web/src/features/system/components/status/FrontendErrorsCard.tsx` — titles: _(no titled panels in the delegate either)_

**Shared UI composed (map each to its native equivalent from the component library):**
  - _(none — likely pure-delegation; see delegates above)_

**Visualization:**
  - _(no charts)_
  - _(no map)_

**Named panels/sections — implement every one (26 title(s) extracted from page + delegates):**

  1. t('Needs
  2. Operator action items
  3. Health
  4. Action items
  5. Resources
  6. Services
  7. Database
  8. Telemetry
  9. Tesla auth
  10. Notifications
  11. Workers
  12. Backups
  13. Tesla API
  14. Errors
  15. System
  16. Uptime
  17. SLO
  18. Maintenance
  19. Subscribe
  20. Tesla account
  21. Open API Logs
  22. Top services
  23. By method
  24. Scheduled maintenance
  25. Get notified about incidents
  26. Target uptime percentage

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
& ./apps/tools/check-placeholders.ps1 -Path apps/android/app/src/main/kotlin/com/teslasync/system -Language kotlin *>$null; "PLACEHOLDER_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# (platform build/test/lint commands per p3-android/README.md gate contract)
```

## Acceptance Criteria

- [ ] Every named panel above implemented; every anonymous region from the web source + every delegated component reproduced.
- [ ] All 3 parity regions render from the bound state holder.
- [ ] loading/empty/error implemented for every data source listed above.
- [ ] All visible strings sourced from the catalog; zero hardcoded literals; key names match web.
- [ ] Dark mode + accessibility + SI units honored; native components only (no web pixel-cloning).
- [ ] build + test + lint + placeholder gates green; `PARITY_COVERED==PARITY_REQUIRED`.
- [ ] `EXIT=0` / `STATUS=DONE`; `android` ledger row for `page:system/SystemStatusPage` set covered.

## Out of Scope

Other pages; backend changes; new product features. Parity only.

## Commit

```powershell
git add apps/android/app/src/main/kotlin/com/teslasync/system apps/parity/android-ledger.json .github/prompts/monorepo/logs/android-page-system-SystemStatusPage.log
git commit -m "feat(apps/android): SystemStatusPage at web parity (A7 system)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
