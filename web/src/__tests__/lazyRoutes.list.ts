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
  { name: 'VehicleManagement', load: () => import('../features/vehicles/pages/VehicleManagementPage') },
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
  { name: 'NotificationsAudit', load: () => import('../features/notifications/pages/AuditLogPage') },

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
  { name: 'ActivityTimeline', load: () => import('../features/system/pages/ActivityTimelinePage') },

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
  { name: 'PowerSqlPlayground', load: () => import('../features/power-user/pages/SqlPlaygroundPage') },
  { name: 'PowerGrafanaPanel', load: () => import('../features/power-user/pages/GrafanaPanelPage') },
  { name: 'PowerDashboards', load: () => import('../features/power-user/pages/DashboardsPage') },
  { name: 'IncidentTimeline', load: () => import('../features/system/pages/IncidentTimelinePage') },
  { name: 'StatusApiDocs', load: () => import('../features/system/pages/StatusApiDocsPage') },
  { name: 'Help', load: () => import('../features/system/pages/HelpPage') },
  { name: 'SafetySettingsPage', load: () => import('../features/settings/pages/SafetyPage') },
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

  // Pre-existing drift closed alongside the phase-51 wiring: these App.tsx
  // lazy chunks had never been mirrored here, so the parity guard was red.
  { name: 'TimeMachine', load: () => import('../features/vehicles/pages/TimeMachinePage') },
  { name: 'BatteryPassport', load: () => import('../features/battery/pages/BatteryPassportPage') },
  { name: 'DriveDNA', load: () => import('../features/driving/pages/DriveDNAPage') },
  { name: 'WhatIf', load: () => import('../features/driving/pages/WhatIfPage') },
  { name: 'TripLogbook', load: () => import('../features/driving/pages/TripLogbookPage') },
  { name: 'RangeBuffer', load: () => import('../features/driving/pages/RangeBufferPage') },
  { name: 'DrivingRhythm', load: () => import('../features/driving/pages/DrivingRhythmPage') },
  { name: 'FSDInsights', load: () => import('../features/driving/pages/FSDInsightsPage') },
  { name: 'SpeedSweetSpot', load: () => import('../features/driving/pages/SpeedSweetSpotPage') },
  { name: 'ParkingAnalytics', load: () => import('../features/vehicles/pages/ParkingAnalyticsPage') },
  { name: 'MileageBudget', load: () => import('../features/analytics/pages/MileageBudgetPage') },
  { name: 'BatteryCare', load: () => import('../features/battery/pages/BatteryCarePage') },
  { name: 'ChargeAdvisor', load: () => import('../features/battery/pages/ChargeAdvisorPage') },
  { name: 'DriveCalendar', load: () => import('../features/analytics/pages/DriveCalendarPage') },
  { name: 'Explorer', load: () => import('../features/driving/pages/ExplorerPage') },
  { name: 'DriveCompare', load: () => import('../features/driving/pages/DriveComparePage') },
  { name: 'EfficiencyTarget', load: () => import('../features/driving/pages/EfficiencyTargetPage') },
  { name: 'Milestones', load: () => import('../features/analytics/pages/MilestonesPage') },
  { name: 'ColdStart', load: () => import('../features/driving/pages/ColdStartPage') },
  { name: 'ShareCard', load: () => import('../features/sharing/pages/ShareCardPage') },
  { name: 'Utilization', load: () => import('../features/vehicles/pages/UtilizationPage') },
  { name: 'Segments', load: () => import('../features/driving/pages/SegmentsPage') },
  { name: 'CarbonIntelligence', load: () => import('../features/analytics/pages/CarbonIntelligencePage') },
  { name: 'RemainingUsefulLife', load: () => import('../features/diagnostics/pages/RemainingUsefulLifePage') },

  // Phase-51 — advanced analytics family
  { name: 'PackCapacity', load: () => import('../features/battery/pages/PackCapacityPage') },
  { name: 'EnergyLedger', load: () => import('../features/battery/pages/EnergyLedgerPage') },
  { name: 'DepartureForecast', load: () => import('../features/driving/pages/DepartureForecastPage') },
  { name: 'DriveArchetypes', load: () => import('../features/analytics/pages/DriveArchetypesPage') },
  { name: 'FirmwareImpact', load: () => import('../features/analytics/pages/FirmwareImpactPage') },
  { name: 'CabinThermal', load: () => import('../features/vehicle-systems/pages/CabinThermalPage') },
  { name: 'ChargerHealth', load: () => import('../features/charging/pages/ChargerHealthPage') },
  { name: 'AlertFatigue', load: () => import('../features/notifications/pages/AlertFatiguePage') },
  { name: 'CommandReliability', load: () => import('../features/system/pages/CommandReliabilityPage') },
  { name: 'SignalCorrelation', load: () => import('../features/telemetry/pages/SignalCorrelationPage') },

  // Phase-52 — decision intelligence family
  { name: 'ArrivalReliability', load: () => import('../features/driving/pages/ArrivalReliabilityPage') },
  { name: 'DestinationTransitions', load: () => import('../features/driving/pages/DestinationTransitionsPage') },
  { name: 'JourneyFragmentation', load: () => import('../features/driving/pages/JourneyFragmentationPage') },
  { name: 'SeasonalEfficiency', load: () => import('../features/driving/pages/SeasonalEfficiencyPage') },
  { name: 'ChargeInterruption', load: () => import('../features/charging/pages/ChargeInterruptionPage') },
  { name: 'ChargerResilience', load: () => import('../features/charging/pages/ChargerResiliencePage') },
  { name: 'ChargeDepartureAlignment', load: () => import('../features/charging/pages/ChargeDepartureAlignmentPage') },
  { name: 'ChargingThermalTax', load: () => import('../features/charging/pages/ChargingThermalTaxPage') },
  { name: 'CycleStress', load: () => import('../features/battery/pages/CycleStressPage') },
  { name: 'HvacCycling', load: () => import('../features/vehicle-systems/pages/HvacCyclingPage') },
  { name: 'ComfortConsistency', load: () => import('../features/vehicle-systems/pages/ComfortConsistencyPage') },
  { name: 'PreconditioningEffectiveness', load: () => import('../features/vehicle-systems/pages/PreconditioningEffectivenessPage') },
  { name: 'TireDifferentialDrift', load: () => import('../features/vehicle-systems/pages/TireDifferentialDriftPage') },
  { name: 'SignalEntropy', load: () => import('../features/telemetry/pages/SignalEntropyPage') },
  { name: 'SignalTrend', load: () => import('../features/telemetry/pages/SignalTrendPage') },
  { name: 'SignalChangePoints', load: () => import('../features/telemetry/pages/SignalChangePointsPage') },
  { name: 'SignalDeadband', load: () => import('../features/telemetry/pages/SignalDeadbandPage') },
  { name: 'SignalMutualInformation', load: () => import('../features/telemetry/pages/SignalMutualInformationPage') },
  { name: 'NotificationBurnRate', load: () => import('../features/notifications/pages/NotificationBurnRatePage') },
  { name: 'NotificationLatency', load: () => import('../features/notifications/pages/NotificationLatencyPage') },

  // Differentiated local intelligence and operations
  { name: 'RootCauseIntelligence', load: () => import('../features/diagnostics/pages/RootCauseIntelligencePage') },
  { name: 'ServiceEvidencePack', load: () => import('../features/diagnostics/pages/ServiceEvidencePackPage') },
  { name: 'DashcamIntelligence', load: () => import('../features/dashcam/pages/DashcamIntelligencePage') },
  { name: 'WholeHomeEnergy', load: () => import('../features/home-energy/pages/WholeHomeEnergyPage') },
  { name: 'ServiceIntelligence', load: () => import('../features/service-intelligence/pages/ServiceIntelligencePage') },
  { name: 'PrivacyBenchmarks', load: () => import('../features/benchmarks/pages/PrivacyBenchmarksPage') },
  { name: 'IntelligencePackMarketplace', load: () => import('../features/intelligence-packs/pages/IntelligencePackMarketplacePage') },
  { name: 'WarrantyResaleVault', load: () => import('../features/resale-vault/pages/WarrantyResaleVaultPage') },
  { name: 'FleetOperations', load: () => import('../features/fleet-ops/pages/FleetOperationsPage') },
  { name: 'ActionCenter', load: () => import('../features/action-center/pages/ActionCenterPage') },
  { name: 'TwinLab', load: () => import('../features/advanced-intelligence/pages/TwinLabPage') },
  { name: 'FirmwareCanary', load: () => import('../features/advanced-intelligence/pages/FirmwareCanaryPage') },
  { name: 'ComponentSurvival', load: () => import('../features/advanced-intelligence/pages/ComponentSurvivalPage') },
  { name: 'RoadHazardMesh', load: () => import('../features/advanced-intelligence/pages/RoadHazardMeshPage') },
  { name: 'BehavioralSentinel', load: () => import('../features/advanced-intelligence/pages/BehavioralSentinelPage') },
  { name: 'ChargingForensics', load: () => import('../features/advanced-intelligence/pages/ChargingForensicsPage') },
  { name: 'JourneyAssurance', load: () => import('../features/advanced-intelligence/pages/JourneyAssurancePage') },
  { name: 'ChargingSiteTwin', load: () => import('../features/advanced-intelligence/pages/ChargingSiteTwinPage') },
  { name: 'FederatedLearningStudio', load: () => import('../features/advanced-intelligence/pages/FederatedLearningStudioPage') },
  { name: 'EmergencyResilience', load: () => import('../features/advanced-intelligence/pages/EmergencyResiliencePage') },
  { name: 'CausalExperimentLab', load: () => import('../features/advanced-intelligence/pages/CausalExperimentationPage') },
  { name: 'TCOOptimizer', load: () => import('../features/advanced-intelligence/pages/TCOOptimizerPage') },
  { name: 'InsuranceTelematics', load: () => import('../features/ownership/pages/InsuranceTelematicsPage') },
  { name: 'TariffLab', load: () => import('../features/ownership/pages/TariffLabPage') },
  { name: 'ChargingReconciliation', load: () => import('../features/ownership/pages/ChargingReconciliationPage') },
  { name: 'DriverAttribution', load: () => import('../features/ownership/pages/DriverAttributionPage') },
  { name: 'WarrantyCommand', load: () => import('../features/ownership/pages/WarrantyCommandPage') },
  { name: 'DataGovernance', load: () => import('../features/ownership/pages/DataGovernancePage') },
  { name: 'ModelTrust', load: () => import('../features/ownership/pages/ModelTrustPage') },
  { name: 'JurisdictionCompliance', load: () => import('../features/ownership/pages/JurisdictionCompliancePage') },
  { name: 'ConsumablesLifecycle', load: () => import('../features/ownership/pages/ConsumablesLifecyclePage') },
  { name: 'SubscriptionROI', load: () => import('../features/ownership/pages/SubscriptionROIPage') },
]
