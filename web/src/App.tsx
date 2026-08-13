import { lazy, useEffect, useRef } from 'react'
import { Navigate, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import Layout from './components/layout/Layout'
import { ScrollRestoration } from './components/layout/ScrollRestoration'
import { PageLoadSkeleton } from './components/feedback/PageLoadSkeleton'
import { ErrorBoundary } from './components/feedback/ErrorBoundary'
import { SuspenseProgressBoundary } from './components/feedback/SuspenseProgressBoundary'
import { OnboardingGate } from '@/features/onboarding/components/OnboardingGate'
import { DensityApplier } from '@/components/ui/DensityApplier'
import { ContextMenuRoot } from '@/components/ui/ContextMenu'
import { RouteAnnouncer } from '@/components/a11y'
import { recordPageView, resolvePageLabel } from '@/lib/recentPages'
import { getBaseTitle } from '@/lib/titleStore'

// ── ALL pages live in features/ — zero imports from pages/ ──────────────

// Dashboard
const Dashboard = lazy(() => import('./features/dashboard/pages/DashboardPage'))
const QuickStats = lazy(() => import('./features/dashboard/pages/QuickStatsPage'))
const GlancePage = lazy(() => import('./features/dashboard/pages/GlancePage'))

// Vehicles
const Vehicles = lazy(() => import('./features/vehicles/pages/VehicleListPage'))
const VehicleDetail = lazy(() => import('./features/vehicles/pages/VehicleDetailPage'))
const VehicleAccess = lazy(() => import('./features/vehicles/pages/VehicleAccessPage'))
const VehicleManagement = lazy(() => import('./features/vehicles/pages/VehicleManagementPage'))
const DigitalTwin = lazy(() => import('./features/vehicles/pages/DigitalTwinPage'))
const TimeMachine = lazy(() => import('./features/vehicles/pages/TimeMachinePage'))

// Charging
const Charging = lazy(() => import('./features/charging/pages/ChargingListPage'))
const ChargeDetail = lazy(() => import('./features/charging/pages/ChargingDetailPage'))
const ChargingCurve = lazy(() => import('./features/charging/pages/ChargingCurvePage'))
const ChargingHeatmap = lazy(() => import('./features/charging/pages/ChargingHeatmapPage'))
const CostAnalysis = lazy(() => import('./features/charging/pages/CostAnalysisPage'))
const TeslaChargingHistory = lazy(() => import('./features/charging/pages/TeslaChargingHistoryPage'))
const TeslaChargingSessions = lazy(() => import('./features/charging/pages/TeslaChargingSessionsPage'))
const SmartCharge = lazy(() => import('./features/charging/pages/SmartChargePage'))
const Powershare = lazy(() => import('./features/charging/pages/PowersharePage'))

// Trips
const Trips = lazy(() => import('./features/trips/pages/TripListPage'))
const TripDetail = lazy(() => import('./features/trips/pages/TripDetailPage'))

// Battery & Energy
const Energy = lazy(() => import('./features/battery/pages/EnergyPage'))
const BatteryHealth = lazy(() => import('./features/battery/pages/BatteryHealthPage'))
const BatteryCells = lazy(() => import('./features/battery/pages/BatteryCellsPage'))
const BatteryDegradation = lazy(() => import('./features/battery/pages/BatteryDegradationPage'))
const EnergyFlow = lazy(() => import('./features/battery/pages/EnergyFlowPage'))
const PowerFlowDashboard = lazy(() => import('./features/battery/pages/PowerFlowDashboardPage'))
const EnergyProducts = lazy(() => import('./features/battery/pages/EnergyProductsPage'))
const VampireDrain = lazy(() => import('./features/battery/pages/VampireDrainPage'))
const ProjectedRange = lazy(() => import('./features/battery/pages/ProjectedRangePage'))
const SleepEfficiency = lazy(() => import('./features/battery/pages/SleepEfficiencyPage'))
const BatteryPassport = lazy(() => import('./features/battery/pages/BatteryPassportPage'))

// Phase-51 — advanced analytics family. Each of these is backed by a pure,
// unit-tested `features/{domain}/lib/*.ts` module rather than a new endpoint;
// they derive novel signal from data the API already returns.
const PackCapacity = lazy(() => import('./features/battery/pages/PackCapacityPage'))
const EnergyLedger = lazy(() => import('./features/battery/pages/EnergyLedgerPage'))
const DepartureForecast = lazy(() => import('./features/driving/pages/DepartureForecastPage'))
const DriveArchetypes = lazy(() => import('./features/analytics/pages/DriveArchetypesPage'))
const FirmwareImpact = lazy(() => import('./features/analytics/pages/FirmwareImpactPage'))
const CabinThermal = lazy(() => import('./features/vehicle-systems/pages/CabinThermalPage'))
const ChargerHealth = lazy(() => import('./features/charging/pages/ChargerHealthPage'))
const AlertFatigue = lazy(() => import('./features/notifications/pages/AlertFatiguePage'))
const CommandReliability = lazy(() => import('./features/system/pages/CommandReliabilityPage'))
const SignalCorrelation = lazy(() => import('./features/telemetry/pages/SignalCorrelationPage'))

// Phase-52 — decision intelligence family. These pages apply distinct
// statistical models to existing SI-canonical API data; no endpoint aliases or
// re-skinned legacy features are involved.
const ArrivalReliability = lazy(() => import('./features/driving/pages/ArrivalReliabilityPage'))
const DestinationTransitions = lazy(() => import('./features/driving/pages/DestinationTransitionsPage'))
const JourneyFragmentation = lazy(() => import('./features/driving/pages/JourneyFragmentationPage'))
const SeasonalEfficiency = lazy(() => import('./features/driving/pages/SeasonalEfficiencyPage'))
const ChargeInterruption = lazy(() => import('./features/charging/pages/ChargeInterruptionPage'))
const ChargerResilience = lazy(() => import('./features/charging/pages/ChargerResiliencePage'))
const ChargeDepartureAlignment = lazy(() => import('./features/charging/pages/ChargeDepartureAlignmentPage'))
const ChargingThermalTax = lazy(() => import('./features/charging/pages/ChargingThermalTaxPage'))
const CycleStress = lazy(() => import('./features/battery/pages/CycleStressPage'))
const HvacCycling = lazy(() => import('./features/vehicle-systems/pages/HvacCyclingPage'))
const ComfortConsistency = lazy(() => import('./features/vehicle-systems/pages/ComfortConsistencyPage'))
const PreconditioningEffectiveness = lazy(() => import('./features/vehicle-systems/pages/PreconditioningEffectivenessPage'))
const TireDifferentialDrift = lazy(() => import('./features/vehicle-systems/pages/TireDifferentialDriftPage'))
const SignalEntropy = lazy(() => import('./features/telemetry/pages/SignalEntropyPage'))
const SignalTrend = lazy(() => import('./features/telemetry/pages/SignalTrendPage'))
const SignalChangePoints = lazy(() => import('./features/telemetry/pages/SignalChangePointsPage'))
const SignalDeadband = lazy(() => import('./features/telemetry/pages/SignalDeadbandPage'))
const SignalMutualInformation = lazy(() => import('./features/telemetry/pages/SignalMutualInformationPage'))
const NotificationBurnRate = lazy(() => import('./features/notifications/pages/NotificationBurnRatePage'))
const NotificationLatency = lazy(() => import('./features/notifications/pages/NotificationLatencyPage'))

// Driving & Performance
const Drives = lazy(() => import('./features/driving/pages/DrivesListPage'))
const DriveDetail = lazy(() => import('./features/driving/pages/DriveDetailPage'))
const TripReplay = lazy(() => import('./features/trips/pages/TripReplayPage'))
const DriveScore = lazy(() => import('./features/driving/pages/DriveScorePage'))
const DrivingDynamics = lazy(() => import('./features/driving/pages/DrivingDynamicsPage'))
const DrivetrainHealth = lazy(() => import('./features/driving/pages/DrivetrainHealthPage'))
const Efficiency = lazy(() => import('./features/driving/pages/EfficiencyPage'))
const SpeedProfile = lazy(() => import('./features/driving/pages/SpeedProfilePage'))
const RegenEfficiency = lazy(() => import('./features/driving/pages/RegenEfficiencyPage'))
const RouteEfficiency = lazy(() => import('./features/driving/pages/RouteEfficiencyPage'))
const TripPlanner = lazy(() => import('./features/driving/pages/TripPlannerPage'))
const DriveDNA = lazy(() => import('./features/driving/pages/DriveDNAPage'))
const WhatIf = lazy(() => import('./features/driving/pages/WhatIfPage'))
const TripLogbook = lazy(() => import('./features/driving/pages/TripLogbookPage'))
const RangeBuffer = lazy(() => import('./features/driving/pages/RangeBufferPage'))
const DrivingRhythm = lazy(() => import('./features/driving/pages/DrivingRhythmPage'))
const SpeedSweetSpot = lazy(() => import('./features/driving/pages/SpeedSweetSpotPage'))
const ParkingAnalytics = lazy(() => import('./features/vehicles/pages/ParkingAnalyticsPage'))
const MileageBudget = lazy(() => import('./features/analytics/pages/MileageBudgetPage'))
const BatteryCare = lazy(() => import('./features/battery/pages/BatteryCarePage'))
const ChargeAdvisor = lazy(() => import('./features/battery/pages/ChargeAdvisorPage'))
const DriveCalendar = lazy(() => import('./features/analytics/pages/DriveCalendarPage'))
const Explorer = lazy(() => import('./features/driving/pages/ExplorerPage'))
const DriveCompare = lazy(() => import('./features/driving/pages/DriveComparePage'))
const EfficiencyTarget = lazy(() => import('./features/driving/pages/EfficiencyTargetPage'))
const Milestones = lazy(() => import('./features/analytics/pages/MilestonesPage'))
const ColdStart = lazy(() => import('./features/driving/pages/ColdStartPage'))
const ShareCard = lazy(() => import('./features/sharing/pages/ShareCardPage'))
const Utilization = lazy(() => import('./features/vehicles/pages/UtilizationPage'))
const Segments = lazy(() => import('./features/driving/pages/SegmentsPage'))

// Analytics & Statistics
const Analytics = lazy(() => import('./features/analytics/pages/AnalyticsPage'))
const Statistics = lazy(() => import('./features/analytics/pages/StatisticsPage'))
const PeriodCompare = lazy(() => import('./features/analytics/pages/PeriodComparePage'))
const Mileage = lazy(() => import('./features/analytics/pages/MileagePage'))
const TrueCostOwnership = lazy(() => import('./features/analytics/pages/TrueCostPage'))
const CarbonIntelligence = lazy(() => import('./features/analytics/pages/CarbonIntelligencePage'))
const WeeklyDigest = lazy(() => import('./features/analytics/pages/WeeklyDigestPage'))
const Timeline = lazy(() => import('./features/analytics/pages/TimelinePage'))
const FleetCompare = lazy(() => import('./features/analytics/pages/FleetComparePage'))
const LifetimeStats = lazy(() => import('./features/analytics/pages/LifetimeStatsPage'))
const YearReview = lazy(() => import('./features/analytics/pages/YearReviewPage'))

// Maps & Location
const LiveMap = lazy(() => import('./features/maps/pages/MapOverviewPage'))
const Locations = lazy(() => import('./features/maps/pages/LocationsPage'))
const Geofences = lazy(() => import('./features/maps/pages/GeofencesPage'))
const NavigationRoute = lazy(() => import('./features/maps/pages/NavigationRoutePage'))
const TemperatureImpact = lazy(() => import('./features/maps/pages/TemperatureImpactPage'))

// Vehicle Systems
const ClimateControl = lazy(() => import('./features/vehicle-systems/pages/ClimateControlPage'))
const TirePressure = lazy(() => import('./features/vehicle-systems/pages/TirePressurePage'))
const Maintenance = lazy(() => import('./features/vehicle-systems/pages/MaintenancePage'))
const SoftwareUpdates = lazy(() => import('./features/vehicle-systems/pages/SoftwareUpdatesPage'))
const SafetySettings = lazy(() => import('./features/vehicle-systems/pages/SafetySettingsPage'))
const GuardMode = lazy(() => import('./features/vehicle-systems/pages/GuardModePage'))
const MediaPlayer = lazy(() => import('./features/vehicle-systems/pages/MediaPlayerPage'))

// Automations
const AutomationsListPage = lazy(() => import('./features/automations/pages/AutomationsListPage'))
const AutomationListPage = lazy(() => import('./features/automations/pages/AutomationListPage'))
const AutomationBuilderPage = lazy(() => import('./features/automations/pages/AutomationBuilderPage'))

// Notifications & Alerts
const AlertsListPage = lazy(() => import('./features/notifications/pages/AlertsListPage'))
const AlertStudio = lazy(() => import('./features/notifications/pages/AlertStudioPage'))
const AlertRulesPage = lazy(() => import('./features/notifications/pages/AlertRulesPage'))
const InboxPage = lazy(() => import('./features/notifications/pages/InboxPage'))
const ArchivedPage = lazy(() => import('./features/notifications/pages/ArchivedPage'))
const ChannelsPage = lazy(() => import('./features/notifications/pages/ChannelsPage'))
const WebhooksPage = lazy(() => import('./features/notifications/pages/WebhooksPage'))
const BrowserNotificationsPage = lazy(() => import('./features/notifications/pages/BrowserNotificationsPage'))
const QuietHoursPage = lazy(() => import('./features/notifications/pages/QuietHoursPage'))
const LegacyAlertsRedirect = lazy(() => import('./features/notifications/components/LegacyAlertsRedirect'))
const LegacyNotificationsRedirect = lazy(() => import('./features/notifications/components/LegacyNotificationsRedirect'))
const LegacyAlertRulesRedirect = lazy(() => import('./features/notifications/components/LegacyAlertRulesRedirect'))
const LegacyAlertStudioRedirect = lazy(() => import('./features/notifications/components/LegacyAlertStudioRedirect'))

// Telemetry & Signals
const SignalExplorer = lazy(() => import('./features/telemetry/pages/SignalExplorerPage'))
const SignalLogViewer = lazy(() => import('./features/telemetry/pages/SignalLogViewerPage'))
const SignalDiff = lazy(() => import('./features/telemetry/pages/SignalDiffPage'))
const SignalGapDetector = lazy(() => import('./features/telemetry/pages/SignalGapDetectorPage'))
const LiveSignalMonitor = lazy(() => import('./features/telemetry/pages/LiveSignalMonitorPage'))
const SignalsWorkspace = lazy(() => import('./features/telemetry/pages/SignalsWorkspacePage'))
const MQTTInspector = lazy(() => import('./features/telemetry/pages/MQTTInspectorPage'))

// Diagnostics
const AnomalyDashboard = lazy(() => import('./features/diagnostics/pages/AnomalyDashboardPage'))
const RemainingUsefulLife = lazy(() => import('./features/diagnostics/pages/RemainingUsefulLifePage'))
const RootCauseIntelligence = lazy(() => import('./features/diagnostics/pages/RootCauseIntelligencePage'))
const ServiceEvidencePack = lazy(() => import('./features/diagnostics/pages/ServiceEvidencePackPage'))

// Differentiated local intelligence and operations
const DashcamIntelligence = lazy(() => import('./features/dashcam/pages/DashcamIntelligencePage'))
const WholeHomeEnergy = lazy(() => import('./features/home-energy/pages/WholeHomeEnergyPage'))
const ServiceIntelligence = lazy(() => import('./features/service-intelligence/pages/ServiceIntelligencePage'))
const PrivacyBenchmarks = lazy(() => import('./features/benchmarks/pages/PrivacyBenchmarksPage'))
const IntelligencePackMarketplace = lazy(() => import('./features/intelligence-packs/pages/IntelligencePackMarketplacePage'))
const WarrantyResaleVault = lazy(() => import('./features/resale-vault/pages/WarrantyResaleVaultPage'))
const FleetOperations = lazy(() => import('./features/fleet-ops/pages/FleetOperationsPage'))
const ActionCenter = lazy(() => import('./features/action-center/pages/ActionCenterPage'))
const TwinLab = lazy(() => import('./features/advanced-intelligence/pages/TwinLabPage'))
const FirmwareCanary = lazy(() => import('./features/advanced-intelligence/pages/FirmwareCanaryPage'))
const ComponentSurvival = lazy(() => import('./features/advanced-intelligence/pages/ComponentSurvivalPage'))
const RoadHazardMesh = lazy(() => import('./features/advanced-intelligence/pages/RoadHazardMeshPage'))
const BehavioralSentinel = lazy(() => import('./features/advanced-intelligence/pages/BehavioralSentinelPage'))
const ChargingForensics = lazy(() => import('./features/advanced-intelligence/pages/ChargingForensicsPage'))
const JourneyAssurance = lazy(() => import('./features/advanced-intelligence/pages/JourneyAssurancePage'))
const ChargingSiteTwin = lazy(() => import('./features/advanced-intelligence/pages/ChargingSiteTwinPage'))
const FederatedLearningStudio = lazy(() => import('./features/advanced-intelligence/pages/FederatedLearningStudioPage'))
const EmergencyResilience = lazy(() => import('./features/advanced-intelligence/pages/EmergencyResiliencePage'))
const CausalExperimentLab = lazy(() => import('./features/advanced-intelligence/pages/CausalExperimentationPage'))
const TCOOptimizer = lazy(() => import('./features/advanced-intelligence/pages/TCOOptimizerPage'))

// Ownership Intelligence
const InsuranceTelematics = lazy(() => import('./features/ownership/pages/InsuranceTelematicsPage'))
const TariffLab = lazy(() => import('./features/ownership/pages/TariffLabPage'))
const ChargingReconciliation = lazy(() => import('./features/ownership/pages/ChargingReconciliationPage'))
const DriverAttribution = lazy(() => import('./features/ownership/pages/DriverAttributionPage'))
const WarrantyCommand = lazy(() => import('./features/ownership/pages/WarrantyCommandPage'))
const DataGovernance = lazy(() => import('./features/ownership/pages/DataGovernancePage'))
const ModelTrust = lazy(() => import('./features/ownership/pages/ModelTrustPage'))
const JurisdictionCompliance = lazy(() => import('./features/ownership/pages/JurisdictionCompliancePage'))
const ConsumablesLifecycle = lazy(() => import('./features/ownership/pages/ConsumablesLifecyclePage'))
const SubscriptionROI = lazy(() => import('./features/ownership/pages/SubscriptionROIPage'))

// Admin & DevTools
const NotificationsAudit = lazy(() => import('./features/notifications/pages/AuditLogPage'))
const DevTools = lazy(() => import('./features/admin/pages/DevToolsPage'))
const APIKeysPage = lazy(() => import('./features/admin/pages/APIKeysPage'))
const ApiLogs = lazy(() => import('./features/admin/pages/ApiLogsPage'))
const FleetAPI = lazy(() => import('./features/admin/pages/FleetAPIPage'))
const TeslaFeatureFlags = lazy(() => import('./features/admin/pages/TeslaFeatureFlagsPage'))
const TeslaRegion = lazy(() => import('./features/admin/pages/TeslaRegionPage'))
const TeslaOrders = lazy(() => import('./features/admin/pages/TeslaOrdersPage'))
const GasPriceAutoPoll = lazy(() => import('./features/admin/pages/GasPriceAutoPollPage'))
const SecurityAccess = lazy(() => import('./features/admin/pages/SecurityAccessPage'))
const BackupRestore = lazy(() => import('./features/admin/pages/BackupRestorePage'))
const ApiPlayground = lazy(() => import('./features/admin/pages/ApiPlaygroundPage'))
const RedisSignalViewer = lazy(() => import('./features/admin/pages/RedisSignalViewerPage'))
const FeedbackQueue = lazy(() => import('./features/admin/pages/FeedbackQueuePage'))
const FleetTelemetryCoverage = lazy(() => import('./features/admin/pages/FleetTelemetryCoveragePage'))
// Phase-tracing diagnostic surfaces — DLQ / Flags / Ingest-XRay / Live Signals.
// Each pages a Go handler under /api/v1/system/* added in this branch.
const DLQInspector = lazy(() => import('./features/admin/pages/DLQInspectorPage'))
const FeatureFlagsAdmin = lazy(() => import('./features/admin/pages/FeatureFlagsPage'))
const IngestXRay = lazy(() => import('./features/admin/pages/IngestXRayPage'))
const LiveSignalInspector = lazy(() => import('./features/admin/pages/LiveSignalInspectorPage'))
// Phase-45 Operator Confidence admin surfaces — backed by
// /api/v1/admin/observability/*, /admin/audit-log, /admin/gdpr/exports.
const SchemaDrift = lazy(() => import('./features/admin/pages/SchemaDriftPage'))
const SlowQueriesAdmin = lazy(() => import('./features/admin/pages/SlowQueriesPage'))
const VehicleCostAdmin = lazy(() => import('./features/admin/pages/VehicleCostPage'))
const DiskForecast = lazy(() => import('./features/admin/pages/DiskForecastPage'))
const SecretRotation = lazy(() => import('./features/admin/pages/SecretRotationPage'))
const AuditLogAdmin = lazy(() => import('./features/admin/pages/AuditLogPage'))
const GDPRExportAdmin = lazy(() => import('./features/admin/pages/GDPRExportPage'))

// Power user
const PowerSqlPlayground = lazy(() => import('./features/power-user/pages/SqlPlaygroundPage'))
const PowerGrafanaPanel = lazy(() => import('./features/power-user/pages/GrafanaPanelPage'))
const PowerDashboards = lazy(() => import('./features/power-user/pages/DashboardsPage'))

// System & Ops
const SystemStatus = lazy(() => import('./features/system/pages/SystemStatusPage'))
const IncidentTimeline = lazy(() => import('./features/system/pages/IncidentTimelinePage'))
const StatusApiDocs = lazy(() => import('./features/system/pages/StatusApiDocsPage'))
const DataExport = lazy(() => import('./features/system/pages/DataExportPage'))
const ExportsPage = lazy(() => import('./features/exports/pages/ExportsPage'))
const DataRepair = lazy(() => import('./features/system/pages/DataRepairPage'))
const DBHealthDashboard = lazy(() => import('./features/system/pages/DBHealthPage'))
const StateMachineDebugger = lazy(() => import('./features/system/pages/StateMachineDebuggerPage'))
const Commands = lazy(() => import('./features/system/pages/CommandsPage'))
const CommandHistory = lazy(() => import('./features/system/pages/CommandHistoryPage'))
const Chatbot = lazy(() => import('./features/system/pages/ChatbotPage'))
const Roadmap = lazy(() => import('./features/system/pages/RoadmapPage'))
const TeslaAccount = lazy(() => import('./features/system/pages/TeslaAccountPage'))

// Per-user activity feed (Phase-40 / Prompt 49 — Recent Activity Discoverability)
const MyActivity = lazy(() => import('./features/system/pages/MyActivityPage'))

// Settings
const Settings = lazy(() => import('./features/settings/pages/SettingsPage'))
// Phase-50 / 0054 — P3 safety setting explainer host page. Distinct
// from /safety-settings (vehicle telemetry) — this page hosts the
// safety-RELATED APPLICATION settings (notification quiet hours,
// alert digest mode, critical-flash, tab-badge, api_suspended) plus
// the opt-in Helix narrator. Routed at /settings/safety to live
// under the /settings family.
const SafetySettingsPage = lazy(() => import('./features/settings/pages/SafetyPage'))
// Account-level security pages promoted out of Settings (Phase-50 split):
//   /account/2fa       — Two-factor authentication enrollment / disable
//   /account/sessions  — Active browser/device sessions + revoke
//   /account/privacy   — Recently viewed pages + cookies / analytics consent
const TwoFactorAuth = lazy(() => import('./features/settings/pages/TwoFactorAuthPage'))
const ActiveSessions = lazy(() => import('./features/settings/pages/ActiveSessionsPage'))
const Privacy = lazy(() => import('./features/settings/pages/PrivacyPage'))
// Helix (AI integration) — promoted out of /settings into its own page
// under the Integrations side-nav group. AISettings (the configuration
// component) is unchanged; this page is just chrome.
const Helix = lazy(() => import('./features/settings/pages/HelixPage'))

// Onboarding (Phase 40 / Prompt 18 — first-run experience)
const Onboarding = lazy(() => import('./features/onboarding/pages/OnboardingPage'))

// Feature Hub — discoverable browse-and-search front door to every page.
const Explore = lazy(() => import('./features/explore/pages/ExplorePage'))

// 404 (Phase 40 / Prompt 38 — catch-all route)
const NotFound = lazy(() => import('./features/system/pages/NotFoundPage'))

// Global app-wide search (Phase 40 / Prompt 41)
const Search = lazy(() => import('./features/system/pages/SearchPage'))

// Sharing (public)
const SharedDrive = lazy(() => import('./features/sharing/pages/SharedDrivePage'))
// Sharing (authenticated, in Layout) — Phase-50 / 0060 GEN1 trip postcard.
const SharingTrips = lazy(() => import('./features/sharing/pages/SharingTripsPage'))

// Watch (standalone — no Layout, API key auth)
const WatchFace = lazy(() => import('./features/watch/pages/WatchFacePage'))

/** Route wrapper: Suspense for lazy loading + ErrorBoundary for crash isolation.
 *  Uses PageLoadSkeleton (layout-shaped) instead of a plain spinner so the page
 *  doesn't reflow when the lazy chunk arrives — important for our CLS budget.
 *  See web/lighthouserc.json for the active assertions (Phase 40 / Prompt 35).
 *
 *  Phase-46 / Prompt 07 — wraps Suspense in SuspenseProgressBoundary so
 *  every route-chunk download also activates the global <TopProgress>
 *  bar mounted in <Layout>. The bar gives the user a visible "loading"
 *  affordance during chunk download even before the layout-shaped
 *  skeleton paints. */
export function SafeRoute({ children, name }: { children: React.ReactNode; name: string }) {
  const { pathname } = useLocation()
  // key={pathname} guarantees a fresh ErrorBoundary instance on every navigation,
  // so a crash on the previous route can never persist into the next one.
  // resetKey is also passed for defense-in-depth against any code path that
  // would otherwise reuse the boundary instance across path changes.
  return (
    <ErrorBoundary key={pathname} name={name} resetKey={pathname}>
      <SuspenseProgressBoundary fallback={<PageLoadSkeleton />}>{children}</SuspenseProgressBoundary>
    </ErrorBoundary>
  )
}

/**
 * Phase-46 / Prompt 51 — Recent-pages recorder.
 *
 * Subscribes to React Router's `useLocation()` and, on every pathname
 * change, schedules a {@link RECENT_PAGES_RECORD_DELAY_MS} timeout that
 * reads the canonical page title (set by `usePageTitle` from inside the
 * lazy-loaded page) and pushes a row into the {@link recordPageView}
 * store.
 *
 * The delay exists for the same reason as RouteAnnouncer: at the
 * instant `useLocation()` fires, the new page's chunk may still be
 * downloading and `usePageTitle()` hasn't written to the title store
 * yet. Waiting lets the React commit phase flush so the captured title
 * reflects the page we actually landed on, not the previous one.
 *
 * Records the very first paint as well — a user who deep-links to
 * `/vehicles/3` and immediately closes the tab still gets that visit
 * captured the next time they open the palette.
 */
export const RECENT_PAGES_RECORD_DELAY_MS = 250
const TITLE_SUFFIX = ' — TeslaSync'

export function stripTitleSuffix(t: string): string {
  if (t.endsWith(TITLE_SUFFIX)) return t.slice(0, -TITLE_SUFFIX.length)
  return t
}

export function RecentPagesRecorder() {
  const { pathname } = useLocation()
  // Refs over deps so the same timeout closure can be re-created on
  // every pathname change without re-binding the listener.
  const lastPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (lastPathRef.current === pathname) return
    const id = window.setTimeout(() => {
      // Mark this path recorded only once the delayed write actually
      // fires — never up-front. Assigning the ref before the timeout
      // resolves breaks React 18 StrictMode's mount→unmount→mount probe:
      // the first schedule is cleared by the interleaved cleanup, and the
      // re-mounted effect would early-return against its own ref and thus
      // never record the visit (recent-pages silently broken in dev).
      // Deferring the assignment keeps first-paint recording resilient to
      // remounts while still de-duplicating a settled pathname.
      lastPathRef.current = pathname
      const stripped = stripTitleSuffix(getBaseTitle())
      const fromStore = stripped && stripped !== 'TeslaSync' ? stripped : null
      const fromRegistry = resolvePageLabel(pathname)
      const title = fromStore ?? fromRegistry ?? pathname
      recordPageView({ path: pathname, title })
    }, RECENT_PAGES_RECORD_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [pathname])

  return null
}

/**
 * Pure resolver for the post-re-authentication return redirect.
 *
 * Given the value stashed in `sessionStorage['teslasync-return-url']`
 * before a ForwardAuth bounce, decide where — if anywhere — the SPA
 * should navigate once it re-mounts. Returns a router-relative
 * `pathname + search + hash` string, or `null` when no navigation should
 * happen: nothing stored, a malformed URL, a cross-origin target, or the
 * user is already on the stored path.
 *
 * Kept pure (no `window` / `sessionStorage` access) so the branch matrix
 * is unit-testable without a DOM round-trip; {@link App} owns the
 * imperative read/remove + `navigate()` side effects.
 */
export function resolveReturnRedirect(
  returnUrl: string | null | undefined,
  currentOrigin: string,
  currentPathname: string,
): string | null {
  if (!returnUrl) return null
  let url: URL
  try {
    url = new URL(returnUrl)
  } catch {
    // Malformed value stored — ignore rather than throw on mount.
    return null
  }
  if (url.origin !== currentOrigin) return null
  if (url.pathname === currentPathname) return null
  return url.pathname + url.search + url.hash
}

export default function App() {
  const navigate = useNavigate()

  // After re-authentication, redirect back to the page the user was on.
  useEffect(() => {
    const returnUrl = sessionStorage.getItem('teslasync-return-url')
    if (!returnUrl) return
    sessionStorage.removeItem('teslasync-return-url')
    const dest = resolveReturnRedirect(
      returnUrl,
      window.location.origin,
      window.location.pathname,
    )
    if (dest) navigate(dest)
  }, [navigate])

  return (
    <>
      <OnboardingGate />
      <ScrollRestoration />
      <DensityApplier />
      {/* Phase-46 / Prompt 21 — announces the new page title to screen
          readers on every SPA navigation. WCAG 2.4.2. */}
      <RouteAnnouncer />
      {/* Phase-46 / Prompt 51 — records every route the user visits so
          the command palette and dashboard widget can surface them. */}
      <RecentPagesRecorder />
      {/* Phase-46 / Prompt 30 — single portal host for the shared
          right-click ContextMenu primitive. Subscribes to a module-level
          store so any DataTable row, notification row, or future
          adopter can open a menu without prop drilling. */}
      <ContextMenuRoot />
      <Routes>
      <Route path="quick-stats" element={<SafeRoute name="QuickStats"><QuickStats /></SafeRoute>} />
      <Route path="glance" element={<SafeRoute name="Glance"><GlancePage /></SafeRoute>} />
      <Route path="year-review/:year" element={<SafeRoute name="YearReview"><YearReview /></SafeRoute>} />
      <Route path="s/:token" element={<SafeRoute name="SharedDrive"><SharedDrive /></SafeRoute>} />
      <Route path="watch" element={<SafeRoute name="WatchFace"><WatchFace /></SafeRoute>} />
      <Route path="onboarding" element={<SafeRoute name="Onboarding"><Onboarding /></SafeRoute>} />
      <Route path="/" element={<Layout />}>
        <Route index element={<SafeRoute name="Dashboard"><Dashboard /></SafeRoute>} />
        <Route path="explore" element={<SafeRoute name="Explore"><Explore /></SafeRoute>} />
        <Route path="live" element={<SafeRoute name="LiveMap"><LiveMap /></SafeRoute>} />
        <Route path="vehicles" element={<SafeRoute name="Vehicles"><Vehicles /></SafeRoute>} />
        <Route path="vehicles/:id" element={<SafeRoute name="VehicleDetail"><VehicleDetail /></SafeRoute>} />
        <Route path="vehicles/:id/access" element={<SafeRoute name="VehicleAccess"><VehicleAccess /></SafeRoute>} />
        <Route path="vehicle-management" element={<SafeRoute name="VehicleManagement"><VehicleManagement /></SafeRoute>} />
        <Route path="digital-twin" element={<SafeRoute name="DigitalTwin"><DigitalTwin /></SafeRoute>} />
        <Route path="time-machine" element={<SafeRoute name="TimeMachine"><TimeMachine /></SafeRoute>} />
        <Route path="energy" element={<SafeRoute name="Energy"><Energy /></SafeRoute>} />
        <Route path="battery" element={<SafeRoute name="BatteryHealth"><BatteryHealth /></SafeRoute>} />
        <Route path="battery/health" element={<SafeRoute name="BatteryHealth"><BatteryHealth /></SafeRoute>} />
        <Route path="drives" element={<SafeRoute name="Drives"><Drives /></SafeRoute>} />
        <Route path="charging" element={<SafeRoute name="Charging"><Charging /></SafeRoute>} />
        <Route path="analytics" element={<SafeRoute name="Analytics"><Analytics /></SafeRoute>} />
        <Route path="commands" element={<SafeRoute name="Commands"><Commands /></SafeRoute>} />
        <Route path="command-history" element={<SafeRoute name="CommandHistory"><CommandHistory /></SafeRoute>} />
        <Route path="automations" element={<SafeRoute name="Automations"><AutomationsListPage /></SafeRoute>} />
        <Route path="automations/list" element={<SafeRoute name="AutomationList"><AutomationListPage /></SafeRoute>} />
        <Route path="automations/new" element={<SafeRoute name="AutomationBuilder"><AutomationBuilderPage /></SafeRoute>} />
        <Route path="automations/:id/edit" element={<SafeRoute name="AutomationBuilder"><AutomationBuilderPage /></SafeRoute>} />
        <Route path="alerts" element={<SafeRoute name="LegacyAlertsRedirect"><LegacyAlertsRedirect /></SafeRoute>} />
        <Route path="alert-studio" element={<SafeRoute name="LegacyAlertStudioRedirect"><LegacyAlertStudioRedirect /></SafeRoute>} />
        <Route path="alert-rules" element={<SafeRoute name="LegacyAlertRulesRedirect"><LegacyAlertRulesRedirect /></SafeRoute>} />
        <Route path="notifications" element={<SafeRoute name="LegacyNotificationsRedirect"><LegacyNotificationsRedirect /></SafeRoute>} />
        <Route path="notifications/inbox" element={<SafeRoute name="NotificationsInbox"><InboxPage /></SafeRoute>} />
        <Route path="notifications/archived" element={<SafeRoute name="NotificationsArchived"><ArchivedPage /></SafeRoute>} />
        <Route path="notifications/alerts" element={<SafeRoute name="NotificationsAlerts"><AlertsListPage /></SafeRoute>} />
        <Route path="notifications/channels" element={<SafeRoute name="NotificationsChannels"><ChannelsPage /></SafeRoute>} />
        <Route path="notifications/webhooks" element={<SafeRoute name="NotificationsWebhooks"><WebhooksPage /></SafeRoute>} />
        <Route path="notifications/browser" element={<SafeRoute name="NotificationsBrowser"><BrowserNotificationsPage /></SafeRoute>} />
        <Route path="notifications/quiet-hours" element={<SafeRoute name="NotificationsQuietHours"><QuietHoursPage /></SafeRoute>} />
        <Route path="notifications/rules" element={<SafeRoute name="NotificationsRules"><AlertRulesPage /></SafeRoute>} />
        <Route path="notifications/studio" element={<SafeRoute name="NotificationsStudio"><AlertStudio /></SafeRoute>} />
        <Route path="notifications/audit" element={<SafeRoute name="NotificationsAudit"><NotificationsAudit /></SafeRoute>} />
        <Route path="geofences" element={<SafeRoute name="Geofences"><Geofences /></SafeRoute>} />
        <Route path="settings" element={<SafeRoute name="Settings"><Settings /></SafeRoute>} />
        <Route path="settings/safety" element={<SafeRoute name="SafetySettingsPage"><SafetySettingsPage /></SafeRoute>} />
        <Route path="account/2fa" element={<SafeRoute name="TwoFactorAuth"><TwoFactorAuth /></SafeRoute>} />
        <Route path="account/sessions" element={<SafeRoute name="ActiveSessions"><ActiveSessions /></SafeRoute>} />
        <Route path="account/privacy" element={<SafeRoute name="Privacy"><Privacy /></SafeRoute>} />
        <Route path="integrations/helix" element={<SafeRoute name="Helix"><Helix /></SafeRoute>} />
        <Route path="drives/:id" element={<SafeRoute name="DriveDetail"><DriveDetail /></SafeRoute>} />
        <Route path="drives/:id/replay" element={<SafeRoute name="TripReplay"><TripReplay /></SafeRoute>} />
        <Route path="charging/:id" element={<SafeRoute name="ChargeDetail"><ChargeDetail /></SafeRoute>} />
        <Route path="chatbot" element={<SafeRoute name="Chatbot"><Chatbot /></SafeRoute>} />
        <Route path="tire-pressure" element={<SafeRoute name="TirePressure"><TirePressure /></SafeRoute>} />
        <Route path="software-updates" element={<SafeRoute name="SoftwareUpdates"><SoftwareUpdates /></SafeRoute>} />
        {/* Phase-50 / 0051 alias: the slice prompt registered the AI feature
            against frontend route `/vehicle-systems/software`; the canonical
            app path stays `/software-updates` for back-compat, but mounting
            the same page at `/vehicle-systems/software` lets the registry's
            RouteSet.Frontend entry land users on the deterministic
            baseline. */}
        <Route path="vehicle-systems/software" element={<SafeRoute name="SoftwareUpdates"><SoftwareUpdates /></SafeRoute>} />
        <Route path="vampire-drain" element={<SafeRoute name="VampireDrain"><VampireDrain /></SafeRoute>} />
        {/* Phase-50 / 0030 alias: the slice prompt registered the AI feature
            against frontend route `/charging/vampire-drain`; the canonical
            app path stays `/vampire-drain` for back-compat, but mounting the
            same page at `/charging/vampire-drain` lets the registry's
            RouteSet.Frontend entry land users on the deterministic
            baseline. */}
        <Route path="charging/vampire-drain" element={<SafeRoute name="VampireDrain"><VampireDrain /></SafeRoute>} />
        <Route path="locations" element={<SafeRoute name="Locations"><Locations /></SafeRoute>} />
        <Route path="timeline" element={<SafeRoute name="Timeline"><Timeline /></SafeRoute>} />
        <Route path="mileage" element={<SafeRoute name="Mileage"><Mileage /></SafeRoute>} />
        <Route path="projected-range" element={<SafeRoute name="ProjectedRange"><ProjectedRange /></SafeRoute>} />
        {/* Phase-50 / 0063 alias: the slice prompt registered the AI feature
            `range-prediction-model` against frontend route `/analytics/range`;
            the canonical app path stays `/projected-range` for back-compat,
            but mounting the same page at `/analytics/range` lets the
            registry's RouteSet.Frontend entry land users on the deterministic
            baseline (which also hosts the opt-in AIRangePrediction section
            when AI mode is on and the toggle is enabled). */}
        <Route path="analytics/range" element={<SafeRoute name="ProjectedRange"><ProjectedRange /></SafeRoute>} />
        <Route path="efficiency" element={<SafeRoute name="Efficiency"><Efficiency /></SafeRoute>} />
        <Route path="trips" element={<SafeRoute name="Trips"><Trips /></SafeRoute>} />
        <Route path="trips/:id" element={<SafeRoute name="TripDetail"><TripDetail /></SafeRoute>} />
        {/* Phase-50 / 0060 — GEN1 trip-postcard-share-card-image-generation
            registers frontend route `/sharing/trips`. The page renders the
            deterministic recent-trips list + static-share-card hints
            regardless of AI mode; the opt-in AI card is gated by
            withAiFeature and absent in off mode. */}
        <Route path="sharing/trips" element={<SafeRoute name="SharingTrips"><SharingTrips /></SafeRoute>} />
        <Route path="trip-planner" element={<SafeRoute name="TripPlanner"><TripPlanner /></SafeRoute>} />
        <Route path="statistics" element={<SafeRoute name="Statistics"><Statistics /></SafeRoute>} />
        <Route path="lifetime-stats" element={<SafeRoute name="LifetimeStats"><LifetimeStats /></SafeRoute>} />
        <Route path="analytics/lifetime" element={<Navigate to="/lifetime-stats" replace />} />
        <Route path="system-status" element={<SafeRoute name="SystemStatus"><SystemStatus /></SafeRoute>} />
        <Route path="system-status/incidents/:id" element={<SafeRoute name="IncidentTimeline"><IncidentTimeline /></SafeRoute>} />
        <Route path="docs/status-api" element={<SafeRoute name="StatusApiDocs"><StatusApiDocs /></SafeRoute>} />
        <Route path="roadmap" element={<SafeRoute name="Roadmap"><Roadmap /></SafeRoute>} />
        <Route path="api-keys" element={<SafeRoute name="APIKeys"><APIKeysPage /></SafeRoute>} />
        <Route path="compare" element={<Navigate to="/period-compare" replace />} />
        <Route path="analytics/compare" element={<Navigate to="/period-compare" replace />} />
        <Route path="period-compare" element={<SafeRoute name="PeriodCompare"><PeriodCompare /></SafeRoute>} />
        <Route path="admin" element={<Navigate to="/system-status" replace />} />
        <Route path="admin/feedback" element={<SafeRoute name="FeedbackQueue"><FeedbackQueue /></SafeRoute>} />
        <Route path="admin/telemetry/coverage" element={<SafeRoute name="FleetTelemetryCoverage"><FleetTelemetryCoverage /></SafeRoute>} />
        {/* Phase-tracing diagnostic surfaces */}
        <Route path="admin/dlq" element={<SafeRoute name="DLQInspector"><DLQInspector /></SafeRoute>} />
        <Route path="admin/flags" element={<SafeRoute name="FeatureFlagsAdmin"><FeatureFlagsAdmin /></SafeRoute>} />
        <Route path="admin/ingest-xray" element={<SafeRoute name="IngestXRay"><IngestXRay /></SafeRoute>} />
        <Route path="admin/live-signals" element={<SafeRoute name="LiveSignalInspector"><LiveSignalInspector /></SafeRoute>} />
        {/* Phase-45 Operator Confidence admin surfaces */}
        <Route path="admin/schema-drift" element={<SafeRoute name="SchemaDrift"><SchemaDrift /></SafeRoute>} />
        <Route path="admin/slow-queries" element={<SafeRoute name="SlowQueries"><SlowQueriesAdmin /></SafeRoute>} />
        <Route path="admin/vehicle-cost" element={<SafeRoute name="VehicleCost"><VehicleCostAdmin /></SafeRoute>} />
        <Route path="admin/disk-forecast" element={<SafeRoute name="DiskForecast"><DiskForecast /></SafeRoute>} />
        <Route path="admin/secret-rotation" element={<SafeRoute name="SecretRotation"><SecretRotation /></SafeRoute>} />
        <Route path="admin/audit-log" element={<SafeRoute name="AuditLog"><AuditLogAdmin /></SafeRoute>} />
        <Route path="admin/gdpr-exports" element={<SafeRoute name="GDPRExport"><GDPRExportAdmin /></SafeRoute>} />
        <Route path="api-logs" element={<SafeRoute name="ApiLogs"><ApiLogs /></SafeRoute>} />
        <Route path="fleet-api" element={<SafeRoute name="FleetAPI"><FleetAPI /></SafeRoute>} />
        <Route path="tesla-features" element={<SafeRoute name="TeslaFeatureFlags"><TeslaFeatureFlags /></SafeRoute>} />
        <Route path="tesla-region" element={<SafeRoute name="TeslaRegion"><TeslaRegion /></SafeRoute>} />
        <Route path="tesla-orders" element={<SafeRoute name="TeslaOrders"><TeslaOrders /></SafeRoute>} />
        <Route path="gas-price" element={<SafeRoute name="GasPriceAutoPoll"><GasPriceAutoPoll /></SafeRoute>} />
        <Route path="dev-tools" element={<SafeRoute name="DevTools"><DevTools /></SafeRoute>} />
        <Route path="api-playground" element={<SafeRoute name="ApiPlayground"><ApiPlayground /></SafeRoute>} />
        <Route path="power/sql" element={<SafeRoute name="PowerSqlPlayground"><PowerSqlPlayground /></SafeRoute>} />
        <Route path="power/grafana" element={<SafeRoute name="PowerGrafanaPanel"><PowerGrafanaPanel /></SafeRoute>} />
        <Route path="power/dashboards" element={<SafeRoute name="PowerDashboards"><PowerDashboards /></SafeRoute>} />
        <Route path="redis-signals" element={<SafeRoute name="RedisSignalViewer"><RedisSignalViewer /></SafeRoute>} />
        <Route path="signals" element={<SafeRoute name="SignalsWorkspace"><SignalsWorkspace /></SafeRoute>} />
        <Route path="signal-explorer" element={<SafeRoute name="SignalExplorer"><SignalExplorer /></SafeRoute>} />
        <Route path="signal-log" element={<SafeRoute name="SignalLogViewer"><SignalLogViewer /></SafeRoute>} />
        <Route path="live-monitor" element={<SafeRoute name="LiveSignalMonitor"><LiveSignalMonitor /></SafeRoute>} />
        <Route path="state-debugger" element={<SafeRoute name="StateMachineDebugger"><StateMachineDebugger /></SafeRoute>} />
        <Route path="signal-diff" element={<SafeRoute name="SignalDiff"><SignalDiff /></SafeRoute>} />
        <Route path="signal-gaps" element={<SafeRoute name="SignalGapDetector"><SignalGapDetector /></SafeRoute>} />
        <Route path="db-health" element={<SafeRoute name="DBHealthDashboard"><DBHealthDashboard /></SafeRoute>} />
        <Route path="mqtt-inspector" element={<SafeRoute name="MQTTInspector"><MQTTInspector /></SafeRoute>} />
        <Route path="anomaly-detection" element={<SafeRoute name="AnomalyDashboard"><AnomalyDashboard /></SafeRoute>} />
        {/* Phase-50 / 0062 alias: the slice prompt registered the AI feature
            `learned-per-vehicle-anomaly-baselines` against frontend route
            `/analytics/anomalies`; the canonical app path stays
            `/anomaly-detection` for back-compat, but mounting the same page
            at `/analytics/anomalies` lets the registry's RouteSet.Frontend
            entry land users on the deterministic baseline (which also hosts
            the opt-in AILearnedAnomalyBaselines section when AI mode is on
            and the toggle is enabled). */}
        <Route path="analytics/anomalies" element={<SafeRoute name="AnomalyDashboard"><AnomalyDashboard /></SafeRoute>} />
        <Route path="diagnostics/rul" element={<SafeRoute name="RemainingUsefulLife"><RemainingUsefulLife /></SafeRoute>} />
        <Route path="diagnostics/root-cause" element={<SafeRoute name="RootCauseIntelligence"><RootCauseIntelligence /></SafeRoute>} />
        <Route path="diagnostics/service-evidence" element={<SafeRoute name="ServiceEvidencePack"><ServiceEvidencePack /></SafeRoute>} />
        <Route path="dashcam" element={<SafeRoute name="DashcamIntelligence"><DashcamIntelligence /></SafeRoute>} />
        <Route path="energy-orchestrator" element={<SafeRoute name="WholeHomeEnergy"><WholeHomeEnergy /></SafeRoute>} />
        <Route path="service-intelligence" element={<SafeRoute name="ServiceIntelligence"><ServiceIntelligence /></SafeRoute>} />
        <Route path="benchmarks/privacy" element={<SafeRoute name="PrivacyBenchmarks"><PrivacyBenchmarks /></SafeRoute>} />
        <Route path="intelligence-packs" element={<SafeRoute name="IntelligencePackMarketplace"><IntelligencePackMarketplace /></SafeRoute>} />
        <Route path="resale-vault" element={<SafeRoute name="WarrantyResaleVault"><WarrantyResaleVault /></SafeRoute>} />
        <Route path="fleet-operations" element={<SafeRoute name="FleetOperations"><FleetOperations /></SafeRoute>} />
        <Route path="action-center" element={<SafeRoute name="ActionCenter"><ActionCenter /></SafeRoute>} />
        <Route path="intelligence/twin-lab" element={<SafeRoute name="TwinLab"><TwinLab /></SafeRoute>} />
        <Route path="intelligence/firmware-canary" element={<SafeRoute name="FirmwareCanary"><FirmwareCanary /></SafeRoute>} />
        <Route path="intelligence/component-survival" element={<SafeRoute name="ComponentSurvival"><ComponentSurvival /></SafeRoute>} />
        <Route path="intelligence/road-hazards" element={<SafeRoute name="RoadHazardMesh"><RoadHazardMesh /></SafeRoute>} />
        <Route path="intelligence/behavioral-sentinel" element={<SafeRoute name="BehavioralSentinel"><BehavioralSentinel /></SafeRoute>} />
        <Route path="intelligence/charging-forensics" element={<SafeRoute name="ChargingForensics"><ChargingForensics /></SafeRoute>} />
        <Route path="intelligence/journey-assurance" element={<SafeRoute name="JourneyAssurance"><JourneyAssurance /></SafeRoute>} />
        <Route path="intelligence/charging-site-twin" element={<SafeRoute name="ChargingSiteTwin"><ChargingSiteTwin /></SafeRoute>} />
        <Route path="intelligence/federated-learning" element={<SafeRoute name="FederatedLearningStudio"><FederatedLearningStudio /></SafeRoute>} />
        <Route path="intelligence/emergency-resilience" element={<SafeRoute name="EmergencyResilience"><EmergencyResilience /></SafeRoute>} />
        <Route path="intelligence/causal-lab" element={<SafeRoute name="CausalExperimentLab"><CausalExperimentLab /></SafeRoute>} />
        <Route path="intelligence/tco-optimizer" element={<SafeRoute name="TCOOptimizer"><TCOOptimizer /></SafeRoute>} />
        <Route path="ownership/insurance-telematics" element={<SafeRoute name="InsuranceTelematics"><InsuranceTelematics /></SafeRoute>} />
        <Route path="ownership/tariff-lab" element={<SafeRoute name="TariffLab"><TariffLab /></SafeRoute>} />
        <Route path="ownership/charging-reconciliation" element={<SafeRoute name="ChargingReconciliation"><ChargingReconciliation /></SafeRoute>} />
        <Route path="ownership/driver-attribution" element={<SafeRoute name="DriverAttribution"><DriverAttribution /></SafeRoute>} />
        <Route path="ownership/warranty-command" element={<SafeRoute name="WarrantyCommand"><WarrantyCommand /></SafeRoute>} />
        <Route path="ownership/data-governance" element={<SafeRoute name="DataGovernance"><DataGovernance /></SafeRoute>} />
        <Route path="ownership/model-trust" element={<SafeRoute name="ModelTrust"><ModelTrust /></SafeRoute>} />
        <Route path="ownership/jurisdiction-compliance" element={<SafeRoute name="JurisdictionCompliance"><JurisdictionCompliance /></SafeRoute>} />
        <Route path="ownership/consumables-lifecycle" element={<SafeRoute name="ConsumablesLifecycle"><ConsumablesLifecycle /></SafeRoute>} />
        <Route path="ownership/subscription-roi" element={<SafeRoute name="SubscriptionROI"><SubscriptionROI /></SafeRoute>} />
        <Route path="driving-dynamics" element={<SafeRoute name="DrivingDynamics"><DrivingDynamics /></SafeRoute>} />
        <Route path="climate-control" element={<SafeRoute name="ClimateControl"><ClimateControl /></SafeRoute>} />
        {/* Phase-50 / 0031 alias: the slice prompt registered the AI feature
            against frontend route `/climate`; the canonical app path stays
            `/climate-control` for back-compat, but mounting the same page at
            `/climate` lets the registry's RouteSet.Frontend entry land users
            on the deterministic baseline (which also hosts the opt-in
            AIPreheatPrecoolRecommender section when AI mode is on). */}
        <Route path="climate" element={<SafeRoute name="ClimateControl"><ClimateControl /></SafeRoute>} />
        <Route path="security-access" element={<SafeRoute name="SecurityAccess"><SecurityAccess /></SafeRoute>} />
        <Route path="charging-curve" element={<SafeRoute name="ChargingCurve"><ChargingCurve /></SafeRoute>} />
        {/* Phase-50 / 0028 alias: the slice prompt registered the AI feature
            against frontend route `/charging/curves`; the canonical app path
            stays `/charging-curve` for back-compat, but mounting the same
            page at `/charging/curves` lets the registry's RouteSet.Frontend
            entry land users on the deterministic baseline. */}
        <Route path="charging/curves" element={<SafeRoute name="ChargingCurve"><ChargingCurve /></SafeRoute>} />
        <Route path="cost-analysis" element={<SafeRoute name="CostAnalysis"><CostAnalysis /></SafeRoute>} />
        {/* Phase-50 / 0029 alias: the slice prompt registered the AI feature
            against frontend route `/charging/costs`; the canonical app path
            stays `/cost-analysis` for back-compat, but mounting the same
            page at `/charging/costs` lets the registry's RouteSet.Frontend
            entry land users on the deterministic baseline. */}
        <Route path="charging/costs" element={<SafeRoute name="CostAnalysis"><CostAnalysis /></SafeRoute>} />
        <Route path="tesla-charging-history" element={<SafeRoute name="TeslaChargingHistory"><TeslaChargingHistory /></SafeRoute>} />
        <Route path="tesla-charging-sessions" element={<SafeRoute name="TeslaChargingSessions"><TeslaChargingSessions /></SafeRoute>} />
        <Route path="smart-charge" element={<SafeRoute name="SmartCharge"><SmartCharge /></SafeRoute>} />
        <Route path="charging/schedule" element={<SafeRoute name="SmartCharge"><SmartCharge /></SafeRoute>} />
        <Route path="powershare" element={<SafeRoute name="Powershare"><Powershare /></SafeRoute>} />
        <Route path="battery-cells" element={<SafeRoute name="BatteryCells"><BatteryCells /></SafeRoute>} />
        <Route path="drive-score" element={<SafeRoute name="DriveScore"><DriveScore /></SafeRoute>} />
        <Route path="weekly-digest" element={<SafeRoute name="WeeklyDigest"><WeeklyDigest /></SafeRoute>} />
        <Route path="maintenance" element={<SafeRoute name="Maintenance"><Maintenance /></SafeRoute>} />
        <Route path="data-export" element={<SafeRoute name="DataExport"><DataExport /></SafeRoute>} />
        <Route path="exports" element={<SafeRoute name="Exports"><ExportsPage /></SafeRoute>} />
        <Route path="energy-flow" element={<SafeRoute name="EnergyFlow"><EnergyFlow /></SafeRoute>} />
        <Route path="power-flow" element={<SafeRoute name="PowerFlowDashboard"><PowerFlowDashboard /></SafeRoute>} />
        <Route path="energy-products" element={<SafeRoute name="EnergyProducts"><EnergyProducts /></SafeRoute>} />
        <Route path="drivetrain-health" element={<SafeRoute name="DrivetrainHealth"><DrivetrainHealth /></SafeRoute>} />
        <Route path="media-player" element={<SafeRoute name="MediaPlayer"><MediaPlayer /></SafeRoute>} />
        <Route path="safety-settings" element={<SafeRoute name="SafetySettings"><SafetySettings /></SafeRoute>} />
        <Route path="guard-mode" element={<SafeRoute name="GuardMode"><GuardMode /></SafeRoute>} />
        <Route path="navigation" element={<SafeRoute name="NavigationRoute"><NavigationRoute /></SafeRoute>} />
        <Route path="data-repair" element={<SafeRoute name="DataRepair"><DataRepair /></SafeRoute>} />
        <Route path="backup" element={<SafeRoute name="BackupRestore"><BackupRestore /></SafeRoute>} />
        <Route path="temperature-impact" element={<SafeRoute name="TemperatureImpact"><TemperatureImpact /></SafeRoute>} />
        <Route path="route-efficiency" element={<SafeRoute name="RouteEfficiency"><RouteEfficiency /></SafeRoute>} />
        <Route path="regen-efficiency" element={<SafeRoute name="RegenEfficiency"><RegenEfficiency /></SafeRoute>} />
                <Route path="drive-dna" element={<SafeRoute name="DriveDNA"><DriveDNA /></SafeRoute>} />
                <Route path="what-if" element={<SafeRoute name="WhatIf"><WhatIf /></SafeRoute>} />
                <Route path="logbook" element={<SafeRoute name="TripLogbook"><TripLogbook /></SafeRoute>} />
                <Route path="range-buffer" element={<SafeRoute name="RangeBuffer"><RangeBuffer /></SafeRoute>} />
                <Route path="driving-rhythm" element={<SafeRoute name="DrivingRhythm"><DrivingRhythm /></SafeRoute>} />
                <Route path="speed-sweetspot" element={<SafeRoute name="SpeedSweetSpot"><SpeedSweetSpot /></SafeRoute>} />
                <Route path="parking" element={<SafeRoute name="ParkingAnalytics"><ParkingAnalytics /></SafeRoute>} />
                <Route path="mileage-budget" element={<SafeRoute name="MileageBudget"><MileageBudget /></SafeRoute>} />
                <Route path="battery-care" element={<SafeRoute name="BatteryCare"><BatteryCare /></SafeRoute>} />
                <Route path="charge-advisor" element={<SafeRoute name="ChargeAdvisor"><ChargeAdvisor /></SafeRoute>} />
                <Route path="drive-calendar" element={<SafeRoute name="DriveCalendar"><DriveCalendar /></SafeRoute>} />
                <Route path="explorer" element={<SafeRoute name="Explorer"><Explorer /></SafeRoute>} />
                <Route path="drive-compare" element={<SafeRoute name="DriveCompare"><DriveCompare /></SafeRoute>} />
                <Route path="efficiency-target" element={<SafeRoute name="EfficiencyTarget"><EfficiencyTarget /></SafeRoute>} />
                <Route path="milestones" element={<SafeRoute name="Milestones"><Milestones /></SafeRoute>} />
                <Route path="cold-start" element={<SafeRoute name="ColdStart"><ColdStart /></SafeRoute>} />
                <Route path="share-card" element={<SafeRoute name="ShareCard"><ShareCard /></SafeRoute>} />
                <Route path="utilization" element={<SafeRoute name="Utilization"><Utilization /></SafeRoute>} />
                <Route path="segments" element={<SafeRoute name="Segments"><Segments /></SafeRoute>} />
        <Route path="battery-degradation" element={<SafeRoute name="BatteryDegradation"><BatteryDegradation /></SafeRoute>} />
        <Route path="battery-passport" element={<SafeRoute name="BatteryPassport"><BatteryPassport /></SafeRoute>} />
        {/* Phase-51 — advanced analytics family. */}
        <Route path="pack-capacity" element={<SafeRoute name="PackCapacity"><PackCapacity /></SafeRoute>} />
        <Route path="energy-ledger" element={<SafeRoute name="EnergyLedger"><EnergyLedger /></SafeRoute>} />
        <Route path="departure-forecast" element={<SafeRoute name="DepartureForecast"><DepartureForecast /></SafeRoute>} />
        <Route path="drive-archetypes" element={<SafeRoute name="DriveArchetypes"><DriveArchetypes /></SafeRoute>} />
        <Route path="firmware-impact" element={<SafeRoute name="FirmwareImpact"><FirmwareImpact /></SafeRoute>} />
        <Route path="cabin-thermal" element={<SafeRoute name="CabinThermal"><CabinThermal /></SafeRoute>} />
        <Route path="charger-health" element={<SafeRoute name="ChargerHealth"><ChargerHealth /></SafeRoute>} />
        <Route path="alert-fatigue" element={<SafeRoute name="AlertFatigue"><AlertFatigue /></SafeRoute>} />
        <Route path="command-reliability" element={<SafeRoute name="CommandReliability"><CommandReliability /></SafeRoute>} />
        <Route path="signal-correlation" element={<SafeRoute name="SignalCorrelation"><SignalCorrelation /></SafeRoute>} />
        {/* Phase-52 — decision intelligence family. */}
        <Route path="arrival-reliability" element={<SafeRoute name="ArrivalReliability"><ArrivalReliability /></SafeRoute>} />
        <Route path="destination-transitions" element={<SafeRoute name="DestinationTransitions"><DestinationTransitions /></SafeRoute>} />
        <Route path="journey-fragmentation" element={<SafeRoute name="JourneyFragmentation"><JourneyFragmentation /></SafeRoute>} />
        <Route path="seasonal-efficiency" element={<SafeRoute name="SeasonalEfficiency"><SeasonalEfficiency /></SafeRoute>} />
        <Route path="charge-interruption" element={<SafeRoute name="ChargeInterruption"><ChargeInterruption /></SafeRoute>} />
        <Route path="charger-resilience" element={<SafeRoute name="ChargerResilience"><ChargerResilience /></SafeRoute>} />
        <Route path="charge-departure-alignment" element={<SafeRoute name="ChargeDepartureAlignment"><ChargeDepartureAlignment /></SafeRoute>} />
        <Route path="charging-thermal-tax" element={<SafeRoute name="ChargingThermalTax"><ChargingThermalTax /></SafeRoute>} />
        <Route path="cycle-stress" element={<SafeRoute name="CycleStress"><CycleStress /></SafeRoute>} />
        <Route path="hvac-cycling" element={<SafeRoute name="HvacCycling"><HvacCycling /></SafeRoute>} />
        <Route path="comfort-consistency" element={<SafeRoute name="ComfortConsistency"><ComfortConsistency /></SafeRoute>} />
        <Route path="preconditioning-effectiveness" element={<SafeRoute name="PreconditioningEffectiveness"><PreconditioningEffectiveness /></SafeRoute>} />
        <Route path="tire-differential-drift" element={<SafeRoute name="TireDifferentialDrift"><TireDifferentialDrift /></SafeRoute>} />
        <Route path="signal-entropy" element={<SafeRoute name="SignalEntropy"><SignalEntropy /></SafeRoute>} />
        <Route path="signal-trend" element={<SafeRoute name="SignalTrend"><SignalTrend /></SafeRoute>} />
        <Route path="signal-change-points" element={<SafeRoute name="SignalChangePoints"><SignalChangePoints /></SafeRoute>} />
        <Route path="signal-deadband" element={<SafeRoute name="SignalDeadband"><SignalDeadband /></SafeRoute>} />
        <Route path="signal-mutual-information" element={<SafeRoute name="SignalMutualInformation"><SignalMutualInformation /></SafeRoute>} />
        <Route path="notification-burn-rate" element={<SafeRoute name="NotificationBurnRate"><NotificationBurnRate /></SafeRoute>} />
        <Route path="notification-latency" element={<SafeRoute name="NotificationLatency"><NotificationLatency /></SafeRoute>} />
        <Route path="tco" element={<SafeRoute name="TrueCostOwnership"><TrueCostOwnership /></SafeRoute>} />
        {/* Phase-50 / 0050 alias: the slice prompt registered the AI feature
            against frontend route `/analytics/tco`; the canonical app path
            stays `/tco` for back-compat (it predates the /analytics/* family),
            but mounting the same page at `/analytics/tco` lets the registry's
            RouteSet.Frontend entry land users on the deterministic baseline
            without surprising 404s. */}
        <Route path="analytics/tco" element={<SafeRoute name="TrueCostOwnership"><TrueCostOwnership /></SafeRoute>} />
        {/* Carbon Intelligence — grid-aware CO₂ accounting; sibling of /analytics/tco (money) */}
        <Route path="analytics/carbon" element={<SafeRoute name="CarbonIntelligence"><CarbonIntelligence /></SafeRoute>} />
        <Route path="vehicle-comparison" element={<SafeRoute name="FleetCompare"><FleetCompare /></SafeRoute>} />
        <Route path="sleep-efficiency" element={<SafeRoute name="SleepEfficiency"><SleepEfficiency /></SafeRoute>} />
        <Route path="charging-heatmap" element={<SafeRoute name="ChargingHeatmap"><ChargingHeatmap /></SafeRoute>} />
        <Route path="speed-profile" element={<SafeRoute name="SpeedProfile"><SpeedProfile /></SafeRoute>} />
        <Route path="tesla-account" element={<SafeRoute name="TeslaAccount"><TeslaAccount /></SafeRoute>} />
        {/* Phase 40 / Prompt 49 — per-user activity feed */}
        <Route path="me/activity" element={<SafeRoute name="MyActivity"><MyActivity /></SafeRoute>} />
        {/* Phase 40 / Prompt 41 — global app-wide entity search */}
        <Route path="search" element={<SafeRoute name="Search"><Search /></SafeRoute>} />
        {/* Phase 40 / Prompt 38 — catch-all inside Layout so unknown URLs still
            render with the sidebar/header chrome instead of a blank Outlet. */}
        <Route path="*" element={<SafeRoute name="NotFound"><NotFound /></SafeRoute>} />
      </Route>
      {/* Outer catch-all defends against any future top-level routes that
          forget to nest under '/'. In normal operation the inner one wins. */}
      <Route path="*" element={<SafeRoute name="NotFound"><NotFound /></SafeRoute>} />
      </Routes>
    </>
  )
}
