---
description: "Phase 7 — Frontend features: dashboard, vehicles, charging, trips, settings, maps pages"
---

# Phase 7: Frontend Features

**Branch:** `refactor/full-rewrite`
**Depends on:** Phase 6 (shared component library exists)

**Read ENGINEERING_GUIDELINES.md:** §4.1 (reusability mandate), §4.5 (decision tree), §4.8 (API Layer), §4.10 (State Management), §4.12 (i18n)

**CRITICAL RULE: Every UI element MUST come from `web/src/components/`. NO raw `<button>`, `<input>`, `<table>`, `<div className="card...">` in feature code. If you create raw HTML, the PR will be rejected.**

**Follow `.github/copilot-instructions.md` PHASES 1–5 exactly.**

## What to Build

### 1. `web/src/types/` — API response types
- `vehicle.ts`, `charging.ts`, `trip.ts`, `export.ts`, `dashboard.ts`, `user.ts`
- Match the backend DTO shapes exactly
- NO `any` types — strict TypeScript

### 2. `web/src/api/hooks/` — TanStack Query hooks
- `useVehicles.ts` — query key factory + useVehicles, useVehicle, useRefreshVehicle, useCreateVehicle, useDeleteVehicle
- `useCharging.ts` — useChargingSessions, useChargingSession, useChargingTimeline
- `useTrips.ts` — useTrips, useTrip
- `useExports.ts` — useExports, useCreateExport, useExportDownload
- `useDashboard.ts` — useDashboardStats
- `useUser.ts` — useCurrentUser, useUpdateUser
- Every hook uses `apiClient` from `api/client.ts` — NO direct fetch

### 3. `web/src/features/dashboard/`
- `pages/DashboardPage.tsx` — uses PageContainer, Grid, StatCard, TimeSeriesChart, ChargingPowerChart
- `components/DashboardStats.tsx` — composes StatCard (miles, energy, cost, efficiency)
- `components/RecentActivity.tsx` — composes Timeline

### 4. `web/src/features/vehicles/`
- `pages/VehicleListPage.tsx` — PageContainer + DataTable + SearchInput
- `pages/VehicleDetailPage.tsx` — PageContainer + StatCards + StateBadge + vehicle info
- `components/VehicleGrid.tsx` — Grid of Cards with StateBadge
- `components/VehicleStats.tsx` — StatCards for battery, range, odometer, state

### 5. `web/src/features/charging/`
- `pages/ChargingListPage.tsx` — PageContainer + DataTable
- `pages/ChargingDetailPage.tsx` — PageContainer + ChargingPowerChart + StatCards + StateBadge (with SubFSM)
- `components/ChargingPowerChart.tsx` — ChartContainer + TimeSeriesChart

### 6. `web/src/features/trips/`
- `pages/TripListPage.tsx` — PageContainer + DataTable
- `pages/TripDetailPage.tsx` — PageContainer + TripMapView + StatCards
- `components/TripTable.tsx` — DataTable with trip columns
- `components/TripMapView.tsx` — MapContainer + MapRoute + MapMarker

### 7. `web/src/features/settings/`
- `pages/SettingsPage.tsx` — PageContainer + FormSection + FormField + Toggle

### 8. `web/src/features/maps/`
- `pages/MapOverviewPage.tsx` — full-screen MapContainer + MapMarker for each vehicle + MapCluster

### 9. `web/src/routes/index.tsx`
- All pages loaded via `React.lazy()` with code splitting
- `LazyRoute` wrapper with Suspense + Spinner fallback
- React Router v6 route definitions

### 10. `web/src/i18n/`
- `locales/en/` — translation files per feature namespace (common, vehicles, charging, trips, dashboard, settings)
- All user-facing strings use `useTranslation()`

## Acceptance Criteria

```bash
cd web && npx tsc --noEmit && npm run lint && npm run test -- --coverage && npm run build
```

- [ ] Zero TypeScript errors. Paste tsc output.
- [ ] Zero lint errors. Paste lint output.
- [ ] All tests pass. Paste test output.
- [ ] Build succeeds with JS bundle < 200 KB gzipped. Paste build output.
- [ ] ZERO `fetch()` or `useEffect(() => { fetch... })` — only TanStack Query
- [ ] ZERO raw HTML elements in feature code — only shared components
- [ ] ZERO `any` types
- [ ] ZERO hardcoded user-facing strings — all through i18next
- [ ] Every page handles loading + error + empty states via PageContainer
- [ ] Run: `grep -rn "from 'recharts'\|from 'react-leaflet'\|from 'framer-motion'" web/src/features/` — must return nothing
