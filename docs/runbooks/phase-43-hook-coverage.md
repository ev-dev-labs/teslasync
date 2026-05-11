# Phase-43 Hook Coverage Audit

> **Audit-only**. Per the Honesty Covenant rule 11 and ADR-005 #1, this report
> NEVER deletes or un-exports hooks. Findings are surfaced for human review.
>
> **Generated:** 2026-05-06 05:24:40 -07:00 by phase-43 prompt 0080
>
> **Gate verdict:** **BLOCKED** — orphan hooks and missing-route hooks detected.
> Per ADR-005 #1, no UI deletions are permitted. A human must triage each
> finding and either restore the missing backend route, repoint the hook at
> a replacement endpoint, or accept the deprecation status (hook stays
> in-tree, marked `@deprecated`, and the underlying 404 surfaces gracefully).

## Summary

| Bucket | Count |
|---|---|
| OK | 44 |
| ORPHAN (no production consumers) | 2 |
| MISSING_ROUTE (URL not in router.go) | 6 |
| ORPHAN + MISSING_ROUTE (both) | 1 |
| **Total hook files audited** | 53 |

## Methodology

1. **Inventory**: Every `.ts` file in `web/src/api/hooks/` (excluding test files and the
   `_toastHelpers.ts` private helper). 53 hook files in scope.
2. **Exports**: Every `export {…}` block, `export function`, `export const`, and
   `export {a as b} from` re-export was extracted. Only `use*` symbols are reported in
   the per-hook table (these are the public hooks). 362 unique `use*` exports across
   the inventory.
3. **Consumers**: For each hook file, `git grep` looks for `from '@/api/hooks/<base>'`
   and relative-path equivalents (`./<base>`, `../<base>`, `../hooks/<base>`). Self-
   imports are excluded. Test files in `__tests__/` are counted separately so
   production-only orphans surface clearly.
4. **URL extraction**: Every `request<T>(…)`, `watchRequest<T>(…)`, `fetch(…)`,
   `apiUrl(…)`, and string-literal path constant inside each hook is captured. 262
   URL call-sites in scope.
5. **Route resolution**: `internal/api/router.go` is parsed by tracking nested
   `r.Route("…")` blocks (chi sub-routers) plus the multi-line `r.With(…).\nGet("…")`
   chain pattern. The 7 routes registered via `v1Handler.Register(r)` calls are
   added manually (those handlers live under `internal/handler/v1/`). 422 unique
   `(method, full-path)` pairs.
6. **Match**: Each hook URL is normalised (query string stripped, `${id}` →
   `{P}`, `${qs ? '?…' : ''}` ternary suffix detected and stripped, `/api/v1`
   prefix prepended) and checked against the router route table for exact
   match OR prefix match (route may extend with sub-paths).

## Findings — Hooks needing human review (status ≠ OK)

Each row below MUST be triaged by a human. Per ADR-005 #1, no auto-deletion
is permitted. Acceptable outcomes are:

- **Keep as-is** — hook is still imported by an out-of-scope dashboard widget
  or kept for SDK stability; mark `@deprecated` if the route is gone.
- **Restore route** — re-add the backend handler if the deletion was
  premature.
- **Repoint hook** — change the URL to a new replacement endpoint if one
  has been built in another phase.

| Hook file | Exported `use*` symbols | Prod consumers | Test consumers | URLs | Unmatched URLs | Status |
|---|---|---|---|---|---|---|
| `useAdmin.ts` | useApiKeys, useApiLogs, useApiLogStats, useAuditLogs, useBackupConfigs, useBackupRuns, useConnectionPool, useCreateApiKey, useCreateExport, useDBStats, useDeleteApiKey, useExportJobs, useMaintenanceState, useMigrations, useRevokeApiKey, useSecurityEvents, useStateTimeline, useSystemHealth, useUpdateMaintenance, useVehicleStateMachine, useWebErrorsSummary | 16 | 0 | 19 | 1 | **MISSING_ROUTE** |
| `useAlerts.ts` | useAcknowledgeAlert, useAlertDetail, useAlertMetrics, useAlertRules, useAlerts, useBulkDisableRules, useBulkEnableRules, useCommentAlert, useDeleteAlertRule, useMarkAlertRead, usePreviewComputedMetric, useReopenAlert, useSaveAlertRule, useSnoozeAlertRule, useTestAlertRule, useToggleAlertRule | 0 | 0 | 0 | 0 | **ORPHAN** |
| `useAnalytics.ts` | useAnalyticsSummary, useCostBreakdown, useFleetAnalytics, useLifetimeStats, useMileageStats, useMonthlyMileage, useStateSummary, useTimeline, useWeeklyDigest, useYearReview | 21 | 0 | 10 | 4 | **MISSING_ROUTE** |
| `useDashboardLayouts.ts` | useApplyDashboardLayout, useCreateDashboardLayout, useDeleteDashboardLayout, useNamedDashboardLayouts, useUpdateDashboardLayout | 0 | 0 | 4 | 0 | **ORPHAN** |
| `useEnergy.ts` | useBatteryCells, useBatteryDegradation, useBatteryHealth, useBatteryHealthAnalytics, useEnergyFlow, useEnergyStats, useProjectedRange, useRefreshTeslaBackupHistory, useRefreshTeslaEnergyHistory, useRefreshTeslaEnergyLiveStatus, useRefreshTeslaEnergySiteInfo, useRefreshTeslaEnergySites, useRefreshTeslaWCChargingHistory, useSleepEfficiency, useTeslaBackupHistory, useTeslaEnergyHistory, useTeslaEnergyLiveStatus, useTeslaEnergyLiveStatusHistory, useTeslaEnergySiteInfo, useTeslaEnergySites, useTeslaWCChargingHistory, useUpdateTOUSettings, useVampireDrainEvents, useVampireDrainStats | 23 | 0 | 23 | 2 | **MISSING_ROUTE** |
| `useFleetTelemetry.ts` | useFleetTelemetryCoverage | 0 | 1 | 1 | 1 | **ORPHAN+MISSING_ROUTE** |
| `useGuard.ts` | useAcknowledgeGuardEvent, useGuardConfig, useGuardEvents, useGuardPanic, useSetGuardConfig | 2 | 0 | 4 | 4 | **MISSING_ROUTE** |
| `useTelemetry.ts` | useFleetTelemetryErrors, useFleetTelemetryErrorVINs, useMQTTStatus, useRefreshFleetTelemetryErrors, useRefreshFleetTelemetryErrorVINs, useSignalCatalog, useSignalDiff, useSignalDiffServer, useSignalGaps, useSignalHistory, useSignalLog, useSignalObservations, useSignals, useSignalSnapshot, useSignalStats, useVehicleLiveSignals | 20 | 0 | 15 | 2 | **MISSING_ROUTE** |
| `useTrips.ts` | useTrip, useTrips | 3 | 0 | 1 | 1 | **MISSING_ROUTE** |

### Per-finding detail

#### `useAdmin.ts` — MISSING_ROUTE

**Exports**: useApiKeys, useApiLogs, useApiLogStats, useAuditLogs, useBackupConfigs, useBackupRuns, useConnectionPool, useCreateApiKey, useCreateExport, useDBStats, useDeleteApiKey, useExportJobs, useMaintenanceState, useMigrations, useRevokeApiKey, useSecurityEvents, useStateTimeline, useSystemHealth, useUpdateMaintenance, useVehicleStateMachine, useWebErrorsSummary

**Production consumers**: 16  
**Test-only consumers**: 0

**URLs that did not resolve to any route in `internal/api/router.go`:**

- `/vehicle-states/timeline?vehicle_id=${vehicleId}&days=${days}`

**Suggested action**: Hook is consumed in production but its URL is gone. The
hook should already be `@deprecated` per the locked-policy precedent set by
Phase-43 prompts 0023, 0024, 0025, 0026, 0027, 0029, 0030. Verify the
`@deprecated` JSDoc tag is present and the call site surfaces the 404
gracefully (`PageContainer.error` or empty-state).

#### `useAlerts.ts` — ORPHAN

**Exports**: useAcknowledgeAlert, useAlertDetail, useAlertMetrics, useAlertRules, useAlerts, useBulkDisableRules, useBulkEnableRules, useCommentAlert, useDeleteAlertRule, useMarkAlertRead, usePreviewComputedMetric, useReopenAlert, useSaveAlertRule, useSnoozeAlertRule, useTestAlertRule, useToggleAlertRule

**Production consumers**: 0  
**Test-only consumers**: 0

**Suggested action**: Hook has no production consumers. If it is a re-export
shim (e.g. `useAlerts` re-exports from `useNotifications`), keep for SDK
stability. Otherwise mark `@deprecated`. Do **not** delete.

#### `useAnalytics.ts` — MISSING_ROUTE

**Exports**: useAnalyticsSummary, useCostBreakdown, useFleetAnalytics, useLifetimeStats, useMileageStats, useMonthlyMileage, useStateSummary, useTimeline, useWeeklyDigest, useYearReview

**Production consumers**: 21  
**Test-only consumers**: 0

**URLs that did not resolve to any route in `internal/api/router.go`:**

- `/mileage/monthly?vehicle_id=${vehicleId}`
- `/mileage/stats?vehicle_id=${vehicleId}`
- `/vehicle-states/summary?vehicle_id=${vehicleId}`
- `/vehicle-states/timeline?vehicle_id=${vehicleId}`

**Suggested action**: Hook is consumed in production but its URL is gone. The
hook should already be `@deprecated` per the locked-policy precedent set by
Phase-43 prompts 0023, 0024, 0025, 0026, 0027, 0029, 0030. Verify the
`@deprecated` JSDoc tag is present and the call site surfaces the 404
gracefully (`PageContainer.error` or empty-state).

#### `useDashboardLayouts.ts` — ORPHAN

**Exports**: useApplyDashboardLayout, useCreateDashboardLayout, useDeleteDashboardLayout, useNamedDashboardLayouts, useUpdateDashboardLayout

**Production consumers**: 0  
**Test-only consumers**: 0

**Suggested action**: Hook has no production consumers. If it is a re-export
shim (e.g. `useAlerts` re-exports from `useNotifications`), keep for SDK
stability. Otherwise mark `@deprecated`. Do **not** delete.

#### `useEnergy.ts` — MISSING_ROUTE

**Exports**: useBatteryCells, useBatteryDegradation, useBatteryHealth, useBatteryHealthAnalytics, useEnergyFlow, useEnergyStats, useProjectedRange, useRefreshTeslaBackupHistory, useRefreshTeslaEnergyHistory, useRefreshTeslaEnergyLiveStatus, useRefreshTeslaEnergySiteInfo, useRefreshTeslaEnergySites, useRefreshTeslaWCChargingHistory, useSleepEfficiency, useTeslaBackupHistory, useTeslaEnergyHistory, useTeslaEnergyLiveStatus, useTeslaEnergyLiveStatusHistory, useTeslaEnergySiteInfo, useTeslaEnergySites, useTeslaWCChargingHistory, useUpdateTOUSettings, useVampireDrainEvents, useVampireDrainStats

**Production consumers**: 23  
**Test-only consumers**: 0

**URLs that did not resolve to any route in `internal/api/router.go`:**

- `/vampire-drain?vehicle_id=${vehicleId}&limit=${limit}`
- `/vampire-drain/stats?vehicle_id=${vehicleId}`

**Suggested action**: Hook is consumed in production but its URL is gone. The
hook should already be `@deprecated` per the locked-policy precedent set by
Phase-43 prompts 0023, 0024, 0025, 0026, 0027, 0029, 0030. Verify the
`@deprecated` JSDoc tag is present and the call site surfaces the 404
gracefully (`PageContainer.error` or empty-state).

#### `useFleetTelemetry.ts` — ORPHAN+MISSING_ROUTE

**Exports**: useFleetTelemetryCoverage

**Production consumers**: 0  
**Test-only consumers**: 1

**URLs that did not resolve to any route in `internal/api/router.go`:**

- `/tesla/fleet-telemetry/coverage`

**Suggested action**: Hook has neither production consumers nor a live backend
route. Strong candidate for `@deprecated` annotation. Do **not** delete; a future
feature may re-import.

#### `useGuard.ts` — MISSING_ROUTE

**Exports**: useAcknowledgeGuardEvent, useGuardConfig, useGuardEvents, useGuardPanic, useSetGuardConfig

**Production consumers**: 2  
**Test-only consumers**: 0

**URLs that did not resolve to any route in `internal/api/router.go`:**

- `/vehicles/${vehicleId}/guard`
- `/vehicles/${vehicleId}/guard/events`
- `/vehicles/${vehicleId}/guard/events/${eventId}/acknowledge`
- `/vehicles/${vehicleId}/guard/panic`

**Suggested action**: Hook is consumed in production but its URL is gone. The
hook should already be `@deprecated` per the locked-policy precedent set by
Phase-43 prompts 0023, 0024, 0025, 0026, 0027, 0029, 0030. Verify the
`@deprecated` JSDoc tag is present and the call site surfaces the 404
gracefully (`PageContainer.error` or empty-state).

#### `useTelemetry.ts` — MISSING_ROUTE

**Exports**: useFleetTelemetryErrors, useFleetTelemetryErrorVINs, useMQTTStatus, useRefreshFleetTelemetryErrors, useRefreshFleetTelemetryErrorVINs, useSignalCatalog, useSignalDiff, useSignalDiffServer, useSignalGaps, useSignalHistory, useSignalLog, useSignalObservations, useSignals, useSignalSnapshot, useSignalStats, useVehicleLiveSignals

**Production consumers**: 20  
**Test-only consumers**: 0

**URLs that did not resolve to any route in `internal/api/router.go`:**

- `/signals/catalog`
- `/signals/observations?${params}`

**Suggested action**: Hook is consumed in production but its URL is gone. The
hook should already be `@deprecated` per the locked-policy precedent set by
Phase-43 prompts 0023, 0024, 0025, 0026, 0027, 0029, 0030. Verify the
`@deprecated` JSDoc tag is present and the call site surfaces the 404
gracefully (`PageContainer.error` or empty-state).

#### `useTrips.ts` — MISSING_ROUTE

**Exports**: useTrip, useTrips

**Production consumers**: 3  
**Test-only consumers**: 0

**URLs that did not resolve to any route in `internal/api/router.go`:**

- `/trips/${id}`

**Suggested action**: Hook is consumed in production but its URL is gone. The
hook should already be `@deprecated` per the locked-policy precedent set by
Phase-43 prompts 0023, 0024, 0025, 0026, 0027, 0029, 0030. Verify the
`@deprecated` JSDoc tag is present and the call site surfaces the 404
gracefully (`PageContainer.error` or empty-state).

## OK hooks (44)

The following hook files are fully covered: every `use*` export has at least one
production consumer and every URL resolves to a live route in `internal/api/router.go`.
Listed alphabetically for completeness.

| Hook file | Prod consumers | URLs |
|---|---|---|
| `useAchievementUnlocks.ts` | 2 | 0 |
| `useAnnotations.ts` | 1 | 3 |
| `useAnomalies.ts` | 2 | 1 |
| `useApiHealth.ts` | 1 | 0 |
| `useAuthMode.ts` | 4 | 1 |
| `useAutomations.ts` | 6 | 9 |
| `useCharging.ts` | 17 | 13 |
| `useChat.ts` | 1 | 0 |
| `useCommands.ts` | 2 | 2 |
| `useDashboard.ts` | 1 | 1 |
| `useDriving.ts` | 23 | 8 |
| `useExports.ts` | 7 | 10 |
| `useFeedback.ts` | 2 | 3 |
| `useFSM.ts` | 2 | 2 |
| `useImpersonation.ts` | 3 | 3 |
| `useLocations.ts` | 6 | 2 |
| `useLogStream.ts` | 2 | 1 |
| `useNotificationChannels.ts` | 2 | 2 |
| `useNotifications.ts` | 18 | 27 |
| `useOnboarding.ts` | 3 | 1 |
| `useOptimisticMutation.ts` | 3 | 0 |
| `usePinned.ts` | 7 | 4 |
| `usePush.ts` | 2 | 2 |
| `useRbacMatrix.ts` | 1 | 1 |
| `useSavedViews.ts` | 1 | 3 |
| `useSearch.ts` | 2 | 1 |
| `useSessions.ts` | 1 | 3 |
| `useSettings.ts` | 19 | 17 |
| `useSettingsBackup.ts` | 1 | 2 |
| `useSettingsReset.ts` | 1 | 1 |
| `useSharing.ts` | 3 | 4 |
| `useSignals.ts` | 1 | 3 |
| `useSystem.ts` | 1 | 1 |
| `useSystemDiagnostic.ts` | 1 | 0 |
| `useSystemQueues.ts` | 2 | 2 |
| `useTOTP.ts` | 2 | 5 |
| `useUser.ts` | 5 | 8 |
| `useVehicleAccess.ts` | 2 | 5 |
| `useVehicleCommand.ts` | 3 | 1 |
| `useVehiclePhoto.ts` | 1 | 1 |
| `useVehicles.ts` | 155 | 16 |
| `useVehicleSettings.ts` | 2 | 2 |
| `useVehicleSystems.ts` | 8 | 11 |
| `useWatch.ts` | 2 | 3 |

## What "MISSING_ROUTE" means in this audit

All 7 hooks flagged with `MISSING_ROUTE` point at endpoints that were intentionally
deleted by Phase-42 prompt 0077 (the legacy-table cleanup) or by analogous
refactors. The deleted route patterns observed in this audit are:

- ``/vehicle-states/timeline`` and ``/vehicle-states/summary`` — `vehicle_states` table dropped (router.go L1280-1283).
- ``/mileage/monthly`` and ``/mileage/stats`` — `daily_mileage` table dropped (router.go L1273-1275).
- ``/vampire-drain`` and ``/vampire-drain/stats`` — `vampire_drain_events` table dropped (router.go L1267-1268).
- ``/vehicles/{id}/guard*`` (4 routes) — `guard_handler.go` and `guard_events` table deleted (router.go L779-780).
- ``/signals/catalog`` and ``/signals/observations`` — `signal_catalog_handler.go` deleted (router.go L1718-1722).
- ``/trips/{id}`` — `v1.TripHandler.Register(r)` is never called from `router.go`; only `GET /trips` (list) is wired (router.go L1278).
- ``/tesla/fleet-telemetry/coverage`` — `FleetTelemetryHandler.Coverage` exists in `internal/api/fleet_telemetry_handler.go:118` but the handler is never wired into the chi router.

## What "ORPHAN" means in this audit

Three hook files have **zero production consumers** (test-only consumers do not count):

- ``useAlerts.ts`` — Re-export shim for alert hooks that physically live in
  ``useNotifications.ts``. Production code currently imports the underlying hooks
  directly from ``useNotifications`` rather than going through this shim. The shim
  is harmless but unused; keep it as part of the public hook SDK surface.
- ``useDashboardLayouts.ts`` — Exports `useNamedDashboardLayouts`, `useCreateDashboardLayout`,
  `useUpdateDashboardLayout`, `useDeleteDashboardLayout`, `useApplyDashboardLayout`,
  `dashboardLayoutLibraryKeys`. None of these symbols are referenced anywhere in
  ``web/src/`` outside the file itself. Note: the symbol `useDashboardLayouts` (singular
  file vs plural function) lives in ``useSettings.ts`` and IS consumed — so this is a
  naming-collision misdirection, NOT a sign that the file should be deleted.
- ``useFleetTelemetry.ts`` — Sole export `useFleetTelemetryCoverage` is consumed only
  by ``__tests__/useFleetTelemetry.test.tsx``. Its URL ``/tesla/fleet-telemetry/coverage``
  is also missing from the router. This hook is a double orphan: no consumer AND no
  endpoint.

## Why no deletions

The Honesty Covenant (rule 11) and ADR-005 #1 forbid UI deletions during
refactoring phases. Hooks are part of the SPA surface area; even those that
appear orphan today may be re-imported by a future feature, by a downstream
consumer of the public hook bundle, or by a test added in the next sprint.
Removing a hook silently breaks those flows without a deprecation window.

A separate prompt is required if any of these hooks should genuinely be
removed; that prompt MUST run after a deprecation window in which the hook is
annotated with `@deprecated`, the SDK changelog mentions the planned removal,
and consumers have at least one release cycle to migrate.


