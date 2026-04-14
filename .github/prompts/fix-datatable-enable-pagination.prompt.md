---
description: "Enable pagination on remaining 47 DataTable instances — agent only did 3 of 51"
---

# Fix: Enable Pagination on All DataTable Instances

## Problem

DataTable pagination component was added but only enabled on 3 of 51 instances (DevToolsPage only).
The remaining 47 need `pagination` prop added.

## How to Fix

For EACH DataTable listed below, add the `pagination` prop:

```typescript
// BEFORE
<DataTable columns={cols} data={items} keyExtractor={...} />

// AFTER — default 25 per page
<DataTable columns={cols} data={items} keyExtractor={...} pagination />
```

**For high-volume data tables, use larger page size:**
```typescript
// Signal/telemetry/log tables — 50 per page
<DataTable columns={cols} data={items} keyExtractor={...} pagination={{ defaultPageSize: 50 }} />
```

## Files to Fix (47 instances)

### Use `pagination` (default 25 per page)
```
web/src/features/admin/pages/AdminPage.tsx:210
web/src/features/admin/pages/AdminPage.tsx:239
web/src/features/admin/pages/BackupRestorePage.tsx:676
web/src/features/admin/pages/BackupRestorePage.tsx:709
web/src/features/admin/pages/BackupRestorePage.tsx:923
web/src/features/admin/pages/SecurityAccessPage.tsx:730
web/src/features/analytics/pages/ComparePage.tsx:326
web/src/features/analytics/pages/MileagePage.tsx:241
web/src/features/battery/pages/BatteryCellsPage.tsx:689
web/src/features/battery/pages/BatteryDegradationPage.tsx:580
web/src/features/battery/pages/EnergyFlowPage.tsx:663
web/src/features/battery/pages/EnergyPage.tsx:567
web/src/features/battery/pages/VampireDrainPage.tsx:198
web/src/features/charging/pages/ChargingListPage.tsx:884
web/src/features/charging/pages/CostAnalysisPage.tsx:902
web/src/features/driving/pages/EfficiencyPage.tsx:378
web/src/features/maps/pages/MapOverviewPage.tsx:396
web/src/features/maps/pages/NavigationRoutePage.tsx:772
web/src/features/maps/pages/NavigationRoutePage.tsx:838
web/src/features/maps/pages/NavigationRoutePage.tsx:900
web/src/features/notifications/pages/AlertsPage.tsx:259
web/src/features/notifications/pages/NotificationsPage.tsx:425
web/src/features/system/pages/DataExportPage.tsx:810
web/src/features/system/pages/DBHealthPage.tsx:278
web/src/features/system/pages/StateMachineDebuggerPage.tsx:357
web/src/features/system/pages/StateMachineDebuggerPage.tsx:413
web/src/features/system/pages/SystemStatusPage.tsx:537
web/src/features/system/pages/SystemStatusPage.tsx:759
web/src/features/system/pages/SystemStatusPage.tsx:1102
web/src/features/system/pages/SystemStatusPage.tsx:1305
web/src/features/system/pages/SystemStatusPage.tsx:1328
web/src/features/vehicle-systems/pages/ClimateControlPage.tsx:947
web/src/features/vehicle-systems/pages/MaintenancePage.tsx:678
web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx:558
web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx:594
web/src/features/vehicle-systems/pages/TirePressurePage.tsx:460
web/src/features/vehicles/pages/VehicleDetailPage.tsx:915
web/src/features/vehicles/pages/VehicleDetailPage.tsx:950
```

### Use `pagination={{ defaultPageSize: 50 }}` (high-volume)
```
web/src/features/analytics/pages/TimelinePage.tsx:326
web/src/features/battery/pages/SleepEfficiencyPage.tsx:295
web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx:224
web/src/features/telemetry/pages/MQTTInspectorPage.tsx:270
web/src/features/telemetry/pages/SignalDiffPage.tsx:277
web/src/features/telemetry/pages/SignalExplorerPage.tsx:349
web/src/features/telemetry/pages/SignalExplorerPage.tsx:375
web/src/features/telemetry/pages/SignalGapDetectorPage.tsx:231
web/src/features/telemetry/pages/SignalLogViewerPage.tsx:290
```

## Verification

```bash
cd web
npx tsc --noEmit

# Count DataTables with pagination — should be ~51
grep -rn "<DataTable" src/features/ --include="*.tsx" | wc -l
grep -rn "<DataTable.*pagination" src/features/ --include="*.tsx" | wc -l
# Both numbers should be equal (or very close)

# Count WITHOUT pagination — should be 0
grep -rn "<DataTable" src/features/ --include="*.tsx" | grep -v "pagination" | wc -l
# Target: 0
```

**COMPLETION DEFINITION:**
- [ ] All 47 DataTable instances have `pagination` added
- [ ] Signal/telemetry tables use `defaultPageSize: 50`
- [ ] Standard tables use default (25)
- [ ] TypeScript compiles clean
- [ ] Zero DataTables without pagination remaining
