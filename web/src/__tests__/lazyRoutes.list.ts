/**
 * Hand-maintained list of every lazy chunk wired into App.tsx.
 *
 * Adding or removing an `App.tsx` `lazy(() => import('./…'))` MUST be
 * mirrored here — the smoke test in `lazyRoutes.smoke.test.ts` then
 * proves the chunk loads without throwing during module evaluation.
 *
 * Why hand-maintained instead of parsed: avoids ts-morph / babel
 * dependency in tests; keeps the smoke test deterministic and the
 * failure messages grep-friendly. The `parity check` test in
 * `lazyRoutes.smoke.test.ts` keeps this list in sync with App.tsx by
 * counting `lazy(()` occurrences in the source file.
 *
 * Background: the production "L is not defined" crash on `/live` and
 * `/drives` slipped past tsc, eslint, and unit tests because the lazy
 * chunks were never imported during tests. The
 * leaflet-plugin chunk threw at module-eval time, before any React
 * component rendered. Importing each chunk here exercises that path.
 */
export const LAZY_ROUTE_IMPORTS: Array<{
  name: string
  load: () => Promise<unknown>
}> = [
  // Dashboard
  { name: 'Dashboard', load: () => import('../features/dashboard/pages/DashboardPage') },
  { name: 'QuickStats', load: () => import('../features/dashboard/pages/QuickStatsPage') },
  { name: 'GlancePage', load: () => import('../features/dashboard/pages/GlancePage') },

  // Vehicles
  { name: 'Vehicles', load: () => import('../features/vehicles/pages/VehicleListPage') },
  { name: 'VehicleDetail', load: () => import('../features/vehicles/pages/VehicleDetailPage') },
  { name: 'VehicleAccess', load: () => import('../features/vehicles/pages/VehicleAccessPage') },
  { name: 'DigitalTwin', load: () => import('../features/vehicles/pages/DigitalTwinPage') },

  // Charging
  { name: 'Charging', load: () => import('../features/charging/pages/ChargingListPage') },
  { name: 'ChargeDetail', load: () => import('../features/charging/pages/ChargingDetailPage') },
  { name: 'ChargingCurve', load: () => import('../features/charging/pages/ChargingCurvePage') },
  { name: 'ChargingHeatmap', load: () => import('../features/charging/pages/ChargingHeatmapPage') },
  { name: 'CostAnalysis', load: () => import('../features/charging/pages/CostAnalysisPage') },
  { name: 'TeslaChargingHistory', load: () => import('../features/charging/pages/TeslaChargingHistoryPage') },
  { name: 'TeslaChargingSessions', load: () => import('../features/charging/pages/TeslaChargingSessionsPage') },
  { name: 'SmartCharge', load: () => import('../features/charging/pages/SmartChargePage') },
  { name: 'Powershare', load: () => import('../features/charging/pages/PowersharePage') },

  // Trips
  { name: 'Trips', load: () => import('../features/trips/pages/TripListPage') },
  { name: 'TripDetail', load: () => import('../features/trips/pages/TripDetailPage') },

  // Battery & Energy
  { name: 'Energy', load: () => import('../features/battery/pages/EnergyPage') },
  { name: 'BatteryHealth', load: () => import('../features/battery/pages/BatteryHealthPage') },
  { name: 'BatteryCells', load: () => import('../features/battery/pages/BatteryCellsPage') },
  { name: 'BatteryDegradation', load: () => import('../features/battery/pages/BatteryDegradationPage') },
  { name: 'EnergyFlow', load: () => import('../features/battery/pages/EnergyFlowPage') },
  { name: 'PowerFlowDashboard', load: () => import('../features/battery/pages/PowerFlowDashboardPage') },
  { name: 'EnergyProducts', load: () => import('../features/battery/pages/EnergyProductsPage') },
  { name: 'VampireDrain', load: () => import('../features/battery/pages/VampireDrainPage') },
  { name: 'ProjectedRange', load: () => import('../features/battery/pages/ProjectedRangePage') },
  { name: 'SleepEfficiency', load: () => import('../features/battery/pages/SleepEfficiencyPage') },

  // Driving
  { name: 'Drives', load: () => import('../features/driving/pages/DrivesListPage') },
  { name: 'DriveDetail', load: () => import('../features/driving/pages/DriveDetailPage') },
  { name: 'TripReplay', load: () => import('../features/trips/pages/TripReplayPage') },
  { name: 'DriveScore', load: () => import('../features/driving/pages/DriveScorePage') },
  { name: 'DrivingDynamics', load: () => import('../features/driving/pages/DrivingDynamicsPage') },
  { name: 'DrivetrainHealth', load: () => import('../features/driving/pages/DrivetrainHealthPage') },
  { name: 'Efficiency', load: () => import('../features/driving/pages/EfficiencyPage') },
  { name: 'SpeedProfile', load: () => import('../features/driving/pages/SpeedProfilePage') },
  { name: 'RegenEfficiency', load: () => import('../features/driving/pages/RegenEfficiencyPage') },
  { name: 'RouteEfficiency', load: () => import('../features/driving/pages/RouteEfficiencyPage') },
  { name: 'TripPlanner', load: () => import('../features/driving/pages/TripPlannerPage') },

  // Analytics
  { name: 'Analytics', load: () => import('../features/analytics/pages/AnalyticsPage') },
  { name: 'Statistics', load: () => import('../features/analytics/pages/StatisticsPage') },
  { name: 'PeriodCompare', load: () => import('../features/analytics/pages/PeriodComparePage') },
  { name: 'Mileage', load: () => import('../features/analytics/pages/MileagePage') },
  { name: 'TrueCostOwnership', load: () => import('../features/analytics/pages/TrueCostPage') },
  { name: 'WeeklyDigest', load: () => import('../features/analytics/pages/WeeklyDigestPage') },
  { name: 'Timeline', load: () => import('../features/analytics/pages/TimelinePage') },
  { name: 'FleetCompare', load: () => import('../features/analytics/pages/FleetComparePage') },
  { name: 'LifetimeStats', load: () => import('../features/analytics/pages/LifetimeStatsPage') },
  { name: 'YearReview', load: () => import('../features/analytics/pages/YearReviewPage') },

  // Maps
  { name: 'LiveMap', load: () => import('../features/maps/pages/MapOverviewPage') },
  { name: 'Locations', load: () => import('../features/maps/pages/LocationsPage') },
  { name: 'Geofences', load: () => import('../features/maps/pages/GeofencesPage') },
  { name: 'NavigationRoute', load: () => import('../features/maps/pages/NavigationRoutePage') },
  { name: 'TemperatureImpact', load: () => import('../features/maps/pages/TemperatureImpactPage') },

  // Vehicle systems
  { name: 'ClimateControl', load: () => import('../features/vehicle-systems/pages/ClimateControlPage') },
  { name: 'TirePressure', load: () => import('../features/vehicle-systems/pages/TirePressurePage') },
  { name: 'Maintenance', load: () => import('../features/vehicle-systems/pages/MaintenancePage') },
  { name: 'SoftwareUpdates', load: () => import('../features/vehicle-systems/pages/SoftwareUpdatesPage') },
  { name: 'SafetySettings', load: () => import('../features/vehicle-systems/pages/SafetySettingsPage') },
  { name: 'GuardMode', load: () => import('../features/vehicle-systems/pages/GuardModePage') },
  { name: 'MediaPlayer', load: () => import('../features/vehicle-systems/pages/MediaPlayerPage') },

  // Automations
  { name: 'AutomationsListPage', load: () => import('../features/automations/pages/AutomationsListPage') },
  { name: 'AutomationListPage', load: () => import('../features/automations/pages/AutomationListPage') },
  { name: 'AutomationBuilderPage', load: () => import('../features/automations/pages/AutomationBuilderPage') },

  // Notifications
  { name: 'AlertsListPage', load: () => import('../features/notifications/pages/AlertsListPage') },
  { name: 'AlertStudio', load: () => import('../features/notifications/pages/AlertStudioPage') },
  { name: 'AlertRulesPage', load: () => import('../features/notifications/pages/AlertRulesPage') },
  { name: 'InboxPage', load: () => import('../features/notifications/pages/InboxPage') },
  { name: 'ArchivedPage', load: () => import('../features/notifications/pages/ArchivedPage') },
  { name: 'ChannelsPage', load: () => import('../features/notifications/pages/ChannelsPage') },
  { name: 'WebhooksPage', load: () => import('../features/notifications/pages/WebhooksPage') },
  { name: 'BrowserNotificationsPage', load: () => import('../features/notifications/pages/BrowserNotificationsPage') },
  { name: 'QuietHoursPage', load: () => import('../features/notifications/pages/QuietHoursPage') },
  { name: 'AuditLog', load: () => import('../features/notifications/pages/AuditLogPage') },

  // Telemetry
  { name: 'SignalExplorer', load: () => import('../features/telemetry/pages/SignalExplorerPage') },
  { name: 'SignalLogViewer', load: () => import('../features/telemetry/pages/SignalLogViewerPage') },
  { name: 'SignalDiff', load: () => import('../features/telemetry/pages/SignalDiffPage') },
  { name: 'SignalGapDetector', load: () => import('../features/telemetry/pages/SignalGapDetectorPage') },
  { name: 'LiveSignalMonitor', load: () => import('../features/telemetry/pages/LiveSignalMonitorPage') },
  { name: 'MQTTInspector', load: () => import('../features/telemetry/pages/MQTTInspectorPage') },

  // Diagnostics
  { name: 'AnomalyDashboard', load: () => import('../features/diagnostics/pages/AnomalyDashboardPage') },

  // Admin
  { name: 'DevTools', load: () => import('../features/admin/pages/DevToolsPage') },
  { name: 'APIKeysPage', load: () => import('../features/admin/pages/APIKeysPage') },
  { name: 'ApiLogs', load: () => import('../features/admin/pages/ApiLogsPage') },
  { name: 'FleetAPI', load: () => import('../features/admin/pages/FleetAPIPage') },
  { name: 'SecurityAccess', load: () => import('../features/admin/pages/SecurityAccessPage') },
  { name: 'BackupRestore', load: () => import('../features/admin/pages/BackupRestorePage') },
  { name: 'ApiPlayground', load: () => import('../features/admin/pages/ApiPlaygroundPage') },
  { name: 'RedisSignalViewer', load: () => import('../features/admin/pages/RedisSignalViewerPage') },
  { name: 'FeedbackQueue', load: () => import('../features/admin/pages/FeedbackQueuePage') },
  { name: 'FleetTelemetryCoverage', load: () => import('../features/admin/pages/FleetTelemetryCoveragePage') },

  // System
  { name: 'SystemStatus', load: () => import('../features/system/pages/SystemStatusPage') },
  { name: 'DataExport', load: () => import('../features/system/pages/DataExportPage') },
  { name: 'ExportsPage', load: () => import('../features/exports/pages/ExportsPage') },
  { name: 'DataRepair', load: () => import('../features/system/pages/DataRepairPage') },
  { name: 'DBHealthDashboard', load: () => import('../features/system/pages/DBHealthPage') },
  { name: 'StateMachineDebugger', load: () => import('../features/system/pages/StateMachineDebuggerPage') },
  { name: 'Commands', load: () => import('../features/system/pages/CommandsPage') },
  { name: 'CommandHistory', load: () => import('../features/system/pages/CommandHistoryPage') },
  { name: 'Chatbot', load: () => import('../features/system/pages/ChatbotPage') },
  { name: 'Roadmap', load: () => import('../features/system/pages/RoadmapPage') },
  { name: 'TeslaAccount', load: () => import('../features/system/pages/TeslaAccountPage') },
  { name: 'MyActivity', load: () => import('../features/system/pages/MyActivityPage') },

  // Settings, onboarding, misc
  { name: 'Settings', load: () => import('../features/settings/pages/SettingsPage') },
  { name: 'Onboarding', load: () => import('../features/onboarding/pages/OnboardingPage') },
  { name: 'NotFound', load: () => import('../features/system/pages/NotFoundPage') },
  { name: 'Search', load: () => import('../features/system/pages/SearchPage') },
  { name: 'SharedDrive', load: () => import('../features/sharing/pages/SharedDrivePage') },
  { name: 'WatchFace', load: () => import('../features/watch/pages/WatchFacePage') },

  // Additional routes — kept in App.tsx order so the parity counter stays honest.
  { name: 'LegacyAlertsRedirect', load: () => import('../features/notifications/components/LegacyAlertsRedirect') },
  { name: 'LegacyNotificationsRedirect', load: () => import('../features/notifications/components/LegacyNotificationsRedirect') },
  { name: 'LegacyAlertRulesRedirect', load: () => import('../features/notifications/components/LegacyAlertRulesRedirect') },
  { name: 'LegacyAlertStudioRedirect', load: () => import('../features/notifications/components/LegacyAlertStudioRedirect') },
  { name: 'SignalsWorkspace', load: () => import('../features/telemetry/pages/SignalsWorkspacePage') },
  { name: 'TeslaFeatureFlags', load: () => import('../features/admin/pages/TeslaFeatureFlagsPage') },
  { name: 'TeslaRegion', load: () => import('../features/admin/pages/TeslaRegionPage') },
  { name: 'TeslaOrders', load: () => import('../features/admin/pages/TeslaOrdersPage') },
  { name: 'GasPriceAutoPoll', load: () => import('../features/admin/pages/GasPriceAutoPollPage') },
  { name: 'SqlPlayground', load: () => import('../features/power-user/pages/SqlPlaygroundPage') },
  { name: 'GrafanaPanel', load: () => import('../features/power-user/pages/GrafanaPanelPage') },
  { name: 'Dashboards', load: () => import('../features/power-user/pages/DashboardsPage') },
  { name: 'IncidentTimeline', load: () => import('../features/system/pages/IncidentTimelinePage') },
  { name: 'StatusApiDocs', load: () => import('../features/system/pages/StatusApiDocsPage') },
  { name: 'Safety', load: () => import('../features/settings/pages/SafetyPage') },
  { name: 'TwoFactorAuth', load: () => import('../features/settings/pages/TwoFactorAuthPage') },
  { name: 'ActiveSessions', load: () => import('../features/settings/pages/ActiveSessionsPage') },
  { name: 'Privacy', load: () => import('../features/settings/pages/PrivacyPage') },
  { name: 'SharingTrips', load: () => import('../features/sharing/pages/SharingTripsPage') },

  // Phase-45 / Phase-50 admin, settings & explore surfaces — wired into
  // App.tsx after this list was first authored. Mirrored here so the parity
  // check in lazyRoutes.smoke.test.ts stays green and every chunk is exercised
  // by the smoke import (the file's whole reason to exist). Kept in App.tsx
  // order so the parity counter stays honest.
  { name: 'DLQInspector', load: () => import('../features/admin/pages/DLQInspectorPage') },
  { name: 'FeatureFlagsAdmin', load: () => import('../features/admin/pages/FeatureFlagsPage') },
  { name: 'IngestXRay', load: () => import('../features/admin/pages/IngestXRayPage') },
  { name: 'LiveSignalInspector', load: () => import('../features/admin/pages/LiveSignalInspectorPage') },
  { name: 'SchemaDrift', load: () => import('../features/admin/pages/SchemaDriftPage') },
  { name: 'SlowQueriesAdmin', load: () => import('../features/admin/pages/SlowQueriesPage') },
  { name: 'VehicleCostAdmin', load: () => import('../features/admin/pages/VehicleCostPage') },
  { name: 'DiskForecast', load: () => import('../features/admin/pages/DiskForecastPage') },
  { name: 'SecretRotation', load: () => import('../features/admin/pages/SecretRotationPage') },
  { name: 'AuditLogAdmin', load: () => import('../features/admin/pages/AuditLogPage') },
  { name: 'GDPRExportAdmin', load: () => import('../features/admin/pages/GDPRExportPage') },
  { name: 'Helix', load: () => import('../features/settings/pages/HelixPage') },
  { name: 'Explore', load: () => import('../features/explore/pages/ExplorePage') },
]
