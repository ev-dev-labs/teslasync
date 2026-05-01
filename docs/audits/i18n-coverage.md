# i18n Coverage Audit

Generated: `2026-05-01T19:37:10Z` UTC by `scripts/i18n-coverage.ps1`.

Policy: see [I18N_GUIDELINES.md](../I18N_GUIDELINES.md).

## Summary

| Check | Hits |
|-------|-----:|
| 1. Raw English text in JSX (`>Battery Health<`) | 34 |
| 2. JSX prop literals (`label="…"`, etc.) | 16 |
| 3. Toast / EmptyState / ConfirmDialog raw literals | 18 |
| 4. `t()` keys missing from `en.json` | 28 |
| 5. Defined keys never referenced | 180 |

Heuristics will produce some false positives — review each hit before
"fixing" it. Add ``// i18n-ignore`` to any line where the literal is
genuinely a non-translated technical token (URLs, CSS class strings,
debug labels visible only in dev tools, etc.).

## Top 20 worst-offender files (combined raw + prop + feedback)

| File | Hits |
|------|-----:|
| `web\src\lib\report.ts` | 19 |
| `web\src\lib\certificate.ts` | 5 |
| `web\src\components\vehicles\VehicleTwin.tsx` | 4 |
| `web\src\api\hooks\useGuard.ts` | 3 |
| `web\src\components\data-display\TeslaCarViz.tsx` | 2 |
| `web\src\components\layout\Breadcrumbs.tsx` | 2 |
| `web\src\api\hooks\useWatch.ts` | 2 |
| `web\src\api\hooks\useTelemetry.ts` | 2 |
| `web\src\api\hooks\useVehicleCommand.ts` | 2 |
| `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx` | 2 |
| `web\src\api\hooks\useSharing.ts` | 2 |
| `web\src\components\ui\SignalConfigModal.tsx` | 2 |
| `web\src\components\feedback\ErrorBoundary.tsx` | 1 |
| `web\src\components\feedback\Toast.tsx` | 1 |
| `web\src\features\battery\pages\BatteryDegradationPage.tsx` | 1 |
| `web\src\api\hooks\useExports.ts` | 1 |
| `web\src\api\hooks\useDriving.ts` | 1 |
| `web\src\features\dashboard\widgets\shared\WidgetStatGrid.tsx` | 1 |
| `web\src\features\dashboard\widgets\shared\WidgetDetailCard.tsx` | 1 |
| `web\src\components\layout\Layout.tsx` | 1 |

## 1. Raw English text in JSX

Showing first 34 of 34 hits.

| File | Line | Text |
|------|-----:|------|
| `web\src\components\data-display\ServiceStatus.tsx` | 35 | `You are offline. Data may be stale. Reconnecting automatically...` |
| `web\src\components\feedback\ErrorBoundary.tsx` | 97 | `Component failed to load` |
| `web\src\components\feedback\QueryError.tsx` | 13 | `Failed to load data` |
| `web\src\components\forms\DateRangeFilter.tsx` | 47 | `Apply` |
| `web\src\components\layout\Layout.tsx` | 1111 | `Update available` |
| `web\src\components\ui\CommandPalette.tsx` | 717 | `Search...` |
| `web\src\components\vehicles\VehicleTwin.tsx` | 1335 | `Tesla-inspired performance crossover side view digital twin` |
| `web\src\features\dashboard\widgets\shared\WidgetComparisonCard.tsx` | 102 | `No comparison data` |
| `web\src\features\system\pages\StateMachineDebuggerPage.tsx` | 386 | `Vehicle` |
| `web\src\hooks\useConfirm.ts` | 44 | `Delete` |
| `web\src\lib\certificate.ts` | 42 | `Powered by TeslaSync` |
| `web\src\lib\certificate.ts` | 49 | `Trees Equivalent` |
| `web\src\lib\certificate.ts` | 50 | `Gallons Saved` |
| `web\src\lib\certificate.ts` | 54 | `Liters Gas Avoided` |
| `web\src\lib\certificate.ts` | 55 | `Vehicle` |
| `web\src\lib\report.ts` | 38 | `Details` |
| `web\src\lib\report.ts` | 40 | `Start Time` |
| `web\src\lib\report.ts` | 41 | `End Time` |
| `web\src\lib\report.ts` | 42 | `Distance` |
| `web\src\lib\report.ts` | 43 | `Duration` |
| `web\src\lib\report.ts` | 44 | `Average Speed` |
| `web\src\lib\report.ts` | 45 | `Max Speed` |
| `web\src\lib\report.ts` | 46 | `Battery Used` |
| `web\src\lib\report.ts` | 47 | `Start Range` |
| `web\src\lib\report.ts` | 48 | `End Range` |
| `web\src\lib\report.ts` | 67 | `TeslaSync Monthly Report` |
| `web\src\lib\report.ts` | 81 | `Metric` |
| `web\src\lib\report.ts` | 81 | `Value` |
| `web\src\lib\report.ts` | 82 | `Total Vehicles` |
| `web\src\lib\report.ts` | 83 | `Total Distance` |
| `web\src\lib\report.ts` | 84 | `Total Drives` |
| `web\src\lib\report.ts` | 85 | `Total Energy` |
| `web\src\lib\report.ts` | 86 | `Total Cost` |
| `web\src\lib\report.ts` | 87 | `Avg Efficiency` |

## 2. JSX prop literals

Showing first 16 of 16 hits.

| File | Line | Text |
|------|-----:|------|
| `web\src\components\data-display\TeslaCarViz.tsx` | 560 | `Climate` |
| `web\src\components\data-display\TeslaCarViz.tsx` | 561 | `Sentry` |
| `web\src\components\feedback\Toast.tsx` | 174 | `Dismiss notification` |
| `web\src\components\layout\Breadcrumbs.tsx` | 21 | `Breadcrumb` |
| `web\src\components\layout\Breadcrumbs.tsx` | 27 | `Dashboard` |
| `web\src\components\ui\Drawer.tsx` | 74 | `Close` |
| `web\src\components\ui\Modal.tsx` | 136 | `Close` |
| `web\src\components\ui\SignalConfigModal.tsx` | 190 | `Close` |
| `web\src\components\ui\SignalConfigModal.tsx` | 228 | `Search signals...` |
| `web\src\components\vehicles\VehicleTwin.tsx` | 1322 | `Vehicle digital twin showing current physical state` |
| `web\src\components\vehicles\VehicleTwin.tsx` | 1361 | `Driver Rear` |
| `web\src\components\vehicles\VehicleTwin.tsx` | 1367 | `Driver Front` |
| `web\src\features\dashboard\widgets\shared\WidgetFlowDiagram.tsx` | 94 | `Energy flow diagram` |
| `web\src\features\onboarding\components\Stepper.tsx` | 77 | `Onboarding steps` |
| `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx` | 1084 | `Front Left` |
| `web\src\features\vehicle-systems\pages\ClimateControlPage.tsx` | 1089 | `Front Right` |

## 3. Toast / EmptyState / ConfirmDialog raw literals

Showing first 18 of 18 hits.

| File | Line | Text |
|------|-----:|------|
| `web\src\api\hooks\useDriving.ts` | 207 | `Trip planned` |
| `web\src\api\hooks\useExports.ts` | 36 | `Export started` |
| `web\src\api\hooks\useGuard.ts` | 90 | `Guard configuration updated` |
| `web\src\api\hooks\useGuard.ts` | 108 | `Panic alert triggered` |
| `web\src\api\hooks\useGuard.ts` | 126 | `Event acknowledged` |
| `web\src\api\hooks\useSharing.ts` | 29 | `Share link created` |
| `web\src\api\hooks\useSharing.ts` | 55 | `Share link revoked` |
| `web\src\api\hooks\useTelemetry.ts` | 217 | `Telemetry error VINs refreshed` |
| `web\src\api\hooks\useTelemetry.ts` | 232 | `Telemetry errors refreshed` |
| `web\src\api\hooks\useVehicleCommand.ts` | 40 | `Command sent successfully` |
| `web\src\api\hooks\useVehicleCommand.ts` | 42 | `Command failed` |
| `web\src\api\hooks\useWatch.ts` | 114 | `Command sent` |
| `web\src\api\hooks\useWatch.ts` | 116 | `Command failed` |
| `web\src\features\battery\pages\BatteryDegradationPage.tsx` | 591 | `Low' ? 'success` |
| `web\src\features\dashboard\widgets\shared\WidgetChartSummary.tsx` | 29 | `No data available` |
| `web\src\features\dashboard\widgets\shared\WidgetDetailCard.tsx` | 35 | `No details available` |
| `web\src\features\dashboard\widgets\shared\WidgetStatGrid.tsx` | 37 | `No stats available` |
| `web\src\features\dashboard\widgets\shared\WidgetTipCards.tsx` | 42 | `No recommendations` |

## 4. `t()` keys missing from `en.json` (sample)

Run ``node scripts/i18n-validate-keys.mjs --extract`` to auto-add
any keys whose ``t()`` call has a fallback string. Remaining keys
are listed below — they need a manual default written by hand.

| Key | Default | First use |
|-----|---------|-----------|
| `admin.security.timeline` | Security Event Timeline | `web/src/features/admin/components/security-access/EventTimeline.tsx:87` |
| `Read-Write` | _(none)_ | `web/src/features/admin/pages/APIKeysPage.tsx:35` |
| `templates.blank.desc` | Start from scratch and add widgets manually | `web/src/features/dashboard/components/TemplateGallery.tsx:245` |
| `dashboard.settings.vehicle` | Vehicle | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:48` |
| `dashboard.settings.allVehicles` | All Vehicles (first) | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:52` |
| `dashboard.settings.refreshInterval` | Refresh Interval | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:70` |
| `dashboard.settings.default` | Default | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:74` |
| `dashboard.settings.5s` | 5 seconds | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:75` |
| `dashboard.settings.15s` | 15 seconds | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:76` |
| `dashboard.settings.30s` | 30 seconds | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:77` |
| `dashboard.settings.60s` | 1 minute | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:78` |
| `dashboard.settings.timeRange` | Time Range | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:92` |
| `dashboard.settings.24h` | Last 24 hours | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:96` |
| `dashboard.settings.7d` | Last 7 days | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:97` |
| `dashboard.settings.30d` | Last 30 days | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:98` |
| `dashboard.settings.90d` | Last 90 days | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:99` |
| `dashboard.settings.appearance` | Appearance | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:109` |
| `dashboard.settings.showTitle` | Show widget title | `web/src/features/dashboard/components/WidgetSettingsModal.tsx:111` |
| `widget.chargeHistory` | Charge History | `web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx:72` |
| `widget.updateStatus` | _(none)_ | `web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx:50` |
| `tempImpact.tipOptimal` | _(none)_ | `web/src/features/maps/pages/TemperatureImpactPage.tsx:181` |
| `tempImpact.optimalDesc` | _(none)_ | `web/src/features/maps/pages/TemperatureImpactPage.tsx:383` |
| `tempImpact.optimalDelta` | _(none)_ | `web/src/features/maps/pages/TemperatureImpactPage.tsx:394` |
| `temperature` | Temperature | `web/src/features/settings/components/GeneralSettings.tsx:80` |
| `share.expired.title` | Share Link Unavailable | `web/src/features/sharing/pages/SharedDrivePage.tsx:48` |
| `share.expired.description` | This shared drive link has expired or been revoked. | `web/src/features/sharing/pages/SharedDrivePage.tsx:51` |
| `share.expired.home` | Go to TeslaSync | `web/src/features/sharing/pages/SharedDrivePage.tsx:57` |
| `vehicles.removeMessage` | _(none)_ | `web/src/features/vehicles/pages/VehicleListPage.tsx:395` |

## 5. Defined keys never referenced (sample)

These keys exist in `en.json` but no `t()` call references them. They
may be safe to remove, OR they may be referenced via dynamic key
construction (which the validator cannot follow). Spot-check before
deleting.

- `nav.dashboard`
- `nav.liveMap`
- `nav.energy`
- `nav.analytics`
- `nav.mileage`
- `nav.timeline`
- `nav.locations`
- `nav.trips`
- `nav.tirePressure`
- `nav.vampireDrain`
- `nav.softwareUpdates`
- `nav.projectedRange`
- `nav.statistics`
- `nav.alerts`
- `nav.commands`
- `nav.geofences`
- `nav.notifications`
- `nav.gpsState.locked`
- `nav.gpsState.unlocked`
- `nav.gpsState.unknown`
- `vehiclePicker.label`
- `common.loading`
- `common.noDataForPeriod`
- `common.edit`
- `common.create`
- `common.search`
- `common.export`
- `common.refresh`
- `common.online`
- `common.offline`
- `common.connected`
- `common.disconnected`
- `common.noVehicleSelected.desc`
- `units.km`
- `units.mi`
- `units.kmh`
- `units.mph`
- `units.celsius`
- `units.fahrenheit`
- `units.kwh`
- `units.whkm`
- `units.whmi`
- `units.psi`
- `dashboard.title`
- `dashboard.subtitle`
- `dashboard.vehicles`
- `dashboard.distance`
- `dashboard.drives`
- `dashboard.charges`
- `dashboard.energy`

