# Mobile / Responsive Audit

Generated: `2026-05-01T17:19:35Z` UTC by `scripts/mobile-audit.ps1`.

See [MOBILE_GUIDELINES.md](../MOBILE_GUIDELINES.md) for the breakpoint policy.

## Summary

| Check | Count |
|-------|------:|
| Pages without `grid-cols-1` base | 16 |
| Files with tables missing `overflow-x-auto` | 47 |
| Fixed pixel widths in features | 33 |
| Files using `<Modal>` (review for full-screen on <sm) | 16 |

## 1. Pages without `grid-cols-1` base

These pages use multi-column grids (`grid-cols-2+` or `md:grid-cols-*`) without a `grid-cols-1` base, so they may not stack cleanly on phones.

- `web\src\features\admin\pages\BackupRestorePage.tsx`
- `web\src\features\admin\pages\RedisSignalViewerPage.tsx`
- `web\src\features\automations\pages\AutomationsListPage.tsx`
- `web\src\features\battery\pages\EnergyFlowPage.tsx`
- `web\src\features\charging\pages\ChargingHeatmapPage.tsx`
- `web\src\features\diagnostics\pages\AnomalyDashboardPage.tsx`
- `web\src\features\driving\pages\RegenEfficiencyPage.tsx`
- `web\src\features\driving\pages\SpeedProfilePage.tsx`
- `web\src\features\driving\pages\TripReplayPage.tsx`
- `web\src\features\maps\pages\MapOverviewPage.tsx`
- `web\src\features\maps\pages\NavigationRoutePage.tsx`
- `web\src\features\maps\pages\TemperatureImpactPage.tsx`
- `web\src\features\telemetry\pages\LiveSignalMonitorPage.tsx`
- `web\src\features\telemetry\pages\MQTTInspectorPage.tsx`
- `web\src\features\telemetry\pages\SignalGapDetectorPage.tsx`
- `web\src\features\vehicle-systems\pages\TirePressurePage.tsx`

## 2. Files with tables missing `overflow-x-auto`

Tables containing many columns will clip on narrow viewports without horizontal scroll. Wrap raw `<table>` elements in `<div class="overflow-x-auto">` or migrate to `<DataTable>` (which already wraps).

- `web\src\features\admin\components\devtools\FleetApiSection.tsx`
- `web\src\features\admin\components\devtools\FleetTelemetryHealth.tsx`
- `web\src\features\admin\components\devtools\tools\HttpStatusTool.tsx`
- `web\src\features\admin\components\devtools\tools\TeslaApiRefTool.tsx`
- `web\src\features\admin\components\security-access\EventHistoryTable.tsx`
- `web\src\features\admin\pages\AdminPage.tsx`
- `web\src\features\admin\pages\BackupRestorePage.tsx`
- `web\src\features\admin\pages\RedisSignalViewerPage.tsx`
- `web\src\features\analytics\pages\ComparePage.tsx`
- `web\src\features\analytics\pages\ComparisonPage.tsx`
- `web\src\features\analytics\pages\MileagePage.tsx`
- `web\src\features\analytics\pages\TimelinePage.tsx`
- `web\src\features\battery\pages\BatteryCellsPage.tsx`
- `web\src\features\battery\pages\BatteryDegradationPage.tsx`
- `web\src\features\battery\pages\EnergyFlowPage.tsx`
- `web\src\features\battery\pages\EnergyPage.tsx`
- `web\src\features\battery\pages\SleepEfficiencyPage.tsx`
- `web\src\features\battery\pages\VampireDrainPage.tsx`
- `web\src\features\charging\components\cost-analysis\MonthlyCostTable.tsx`
- `web\src\features\charging\pages\TeslaChargingHistoryPage.tsx`
- `web\src\features\charging\pages\TeslaChargingSessionsPage.tsx`
- `web\src\features\dashboard\widgets\NotificationStatsWidget.tsx`
- `web\src\features\driving\components\driving-dynamics\DrivingCoachSection.tsx`
- `web\src\features\driving\pages\EfficiencyPage.tsx`
- `web\src\features\maps\pages\MapOverviewPage.tsx`
- `web\src\features\maps\pages\NavigationRoutePage.tsx`
- `web\src\features\system\components\status\BackendStatusSection.tsx`
- `web\src\features\system\components\status\DataPipelineSection.tsx`
- `web\src\features\system\components\status\OperationsSection.tsx`
- `web\src\features\system\components\status\ServiceHealthSection.tsx`
- `web\src\features\system\pages\DataExportPage.tsx`
- `web\src\features\system\pages\DBHealthPage.tsx`
- `web\src\features\system\pages\StateMachineDebuggerPage.tsx`
- `web\src\features\telemetry\pages\LiveSignalMonitorPage.tsx`
- `web\src\features\telemetry\pages\MQTTInspectorPage.tsx`
- `web\src\features\telemetry\pages\SignalDiffPage.tsx`
- `web\src\features\telemetry\pages\SignalExplorerPage.tsx`
- `web\src\features\telemetry\pages\SignalGapDetectorPage.tsx`
- `web\src\features\telemetry\pages\SignalLogViewerPage.tsx`
- `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx`
- `web\src\features\vehicle-systems\pages\MaintenancePage.tsx`
- `web\src\features\vehicle-systems\pages\MediaPlayerPage.tsx`
- `web\src\features\vehicle-systems\pages\SafetySettingsPage.tsx`
- `web\src\features\vehicle-systems\pages\TirePressurePage.tsx`
- `web\src\features\vehicles\components\vehicle-detail\RecentChargesSection.tsx`
- `web\src\features\vehicles\components\vehicle-detail\RecentDrivesSection.tsx`
- `web\src\features\vehicles\pages\VehicleAccessPage.tsx`

## 3. Fixed pixel widths in features

Fixed `w-[NNNpx]` or `min-w-[NNNpx]` over 100px frequently breaks below 640px. Acceptable for icons/avatars; review for layout containers, modals, and chart wrappers.

| File | Line | Snippet |
|------|-----:|---------|
| `web\src\features\admin\components\ResponseViewer.tsx` | 251 | `<span className="text-white/40 max-w-[120px] truncate">{h.path}</span>` |
| `web\src\features\admin\pages\ApiLogsPage.tsx` | 352 | `<span className="text-xs text-red-400 truncate max-w-[250px] hidden md:block">` |
| `web\src\features\admin\pages\BackupRestorePage.tsx` | 506 | `<span className="text-xs text-[var(--text-secondary)] max-w-[200px] truncate block font-mono">` |
| `web\src\features\admin\pages\RedisSignalViewerPage.tsx` | 181 | `<div className="relative flex-1 min-w-[200px]">` |
| `web\src\features\automations\pages\ActionBuilder.tsx` | 395 | `<div className="min-w-[220px] flex-1">` |
| `web\src\features\automations\pages\ActionBuilder.tsx` | 448 | `<div className="min-w-[220px] flex-1">` |
| `web\src\features\battery\pages\ProjectedRangePage.tsx` | 278 | `<div className="min-w-[400px]">` |
| `web\src\features\charging\components\charging-list\CostHeatmap.tsx` | 23 | `<div className="min-w-[600px]">` |
| `web\src\features\charging\pages\TeslaChargingHistoryPage.tsx` | 102 | `<span className="text-sm text-white/80 truncate max-w-[200px]">` |
| `web\src\features\charging\pages\TeslaChargingSessionsPage.tsx` | 106 | `<span className="text-sm text-white/80 truncate max-w-[200px]">` |
| `web\src\features\dashboard\components\LayoutManager.tsx` | 237 | `<span className="truncate max-w-[120px]">{d.name}</span>` |
| `web\src\features\dashboard\components\LayoutManager.tsx` | 307 | `rounded-lg shadow-xl py-1 min-w-[160px]"` |
| `web\src\features\dashboard\components\LiveTelemetry.tsx` | 379 | `<span className="text-sm font-bold text-[var(--text-primary)] truncate max-w-[120px]">{value}</span>` |
| `web\src\features\dashboard\widgets\DriveTelemetryWidget.tsx` | 261 | `<Badge variant="neutral" size="sm" className="truncate max-w-[180px]">` |
| `web\src\features\dashboard\widgets\LiveSignalsWidget.tsx` | 22 | `<span className="text-xs font-bold text-white/90 truncate max-w-[100px]">` |
| `web\src\features\dashboard\widgets\NotificationStatsWidget.tsx` | 106 | `className: 'max-w-[120px]',` |
| `web\src\features\dashboard\widgets\NotificationStatsWidget.tsx` | 116 | `className: 'max-w-[100px]',` |
| `web\src\features\dashboard\widgets\TelemetryErrorsWidget.tsx` | 142 | `<span className="text-xs font-mono text-white/70 truncate max-w-[120px]">` |
| `web\src\features\driving\components\driving-dynamics\LiveMotorStatus.tsx` | 84 | `<div className="flex h-[120px] w-[120px] items-center justify-center">` |
| `web\src\features\driving\pages\DriveScorePage.tsx` | 1275 | `<div className="min-w-[800px]">` |
| `web\src\features\maps\pages\NavigationRoutePage.tsx` | 393 | `<span className="text-[var(--text-primary)] truncate max-w-[150px] block">` |
| `web\src\features\notifications\pages\AlertsPage.tsx` | 230 | `{ key: 'title', header: t('Title'), render: (log) => <span className="text-[var(--text-primary)] …` |
| `web\src\features\notifications\pages\NotificationsPage.tsx` | 444 | `{ key: 'error', header: t('Error'), render: (log) => <span className="text-xs text-neon-red/70 ma…` |
| `web\src\features\system\components\status\DataPipelineSection.tsx` | 50 | `render: (row) => <span className="font-mono text-xs truncate max-w-[200px] block">{row.file_name}…` |
| `web\src\features\system\components\status\OperationsSection.tsx` | 57 | `render: (row) => <span className="text-white/90 truncate max-w-[200px] block">{row.title}</span>,` |
| `web\src\features\system\components\status\OperationsSection.tsx` | 61 | `render: (row) => <span className="text-xs text-white/40 truncate max-w-[250px] block">{row.messag…` |
| `web\src\features\system\components\status\OperationsSection.tsx` | 72 | `render: (row) => <span className="text-xs text-white/40 truncate max-w-[250px] block">{row.detail…` |
| `web\src\features\system\pages\CommandHistoryPage.tsx` | 271 | `className="min-w-[140px] rounded-lg border-0 bg-white/[0.04] px-3 py-1.5 text-xs text-gray-300 ri…` |
| `web\src\features\system\pages\DataExportPage.tsx` | 749 | `className="text-[11px] text-rose-300 truncate max-w-[120px] inline-block"` |
| `web\src\features\telemetry\pages\SignalGapDetectorPage.tsx` | 72 | `render: (signal) => <span className="font-mono text-[var(--text-secondary)] max-w-[200px] truncat…` |
| `web\src\features\vehicle-systems\pages\MaintenancePage.tsx` | 263 | `<span className="text-sm text-[var(--text-primary)] truncate max-w-[200px] block">` |
| `web\src\features\vehicle-systems\pages\MediaPlayerPage.tsx` | 231 | `<span className="truncate max-w-[200px] block font-medium text-[var(--text-primary)]">` |
| `web\src\features\vehicle-systems\pages\MediaPlayerPage.tsx` | 241 | `<span className="truncate max-w-[160px] block text-[var(--text-secondary)]">` |

## 4. `<Modal>` usages

The shared `<Modal>` component already forces full-screen on `<sm`. This list exists so reviewers can spot-check that each modal renders cleanly at 390px wide.

- `web\src\features\admin\pages\APIKeysPage.tsx`
- `web\src\features\admin\pages\BackupRestorePage.tsx`
- `web\src\features\battery\components\TOUSettingsModal.tsx`
- `web\src\features\dashboard\components\DashboardSettingsModal.tsx`
- `web\src\features\dashboard\components\ExportModal.tsx`
- `web\src\features\dashboard\components\ImportPreviewModal.tsx`
- `web\src\features\dashboard\components\KioskSettingsModal.tsx`
- `web\src\features\dashboard\components\TemplateGallery.tsx`
- `web\src\features\dashboard\components\WidgetSettingsModal.tsx`
- `web\src\features\driving\components\ShareDriveDialog.tsx`
- `web\src\features\maps\pages\GeofencesPage.tsx`
- `web\src\features\notifications\pages\AlertStudioPage.tsx`
- `web\src\features\notifications\pages\NotificationsPage.tsx`
- `web\src\features\system\components\CommandConfirmDialog.tsx`
- `web\src\features\system\components\CommandInputDialog.tsx`
- `web\src\features\system\components\CommandSelectDialog.tsx`

