import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import { PageLoader } from './components/feedback/PageLoader'
import { ErrorBoundary } from './components/feedback/ErrorBoundary'
import { AuthExpiredOverlay } from '@/components/feedback'

// ── ALL pages live in features/ — zero imports from pages/ ──────────────

// Dashboard
const Dashboard = lazy(() => import('./features/dashboard/pages/DashboardPage'))
const QuickStats = lazy(() => import('./features/dashboard/pages/QuickStatsPage'))
const GlancePage = lazy(() => import('./features/dashboard/pages/GlancePage'))

// Vehicles
const Vehicles = lazy(() => import('./features/vehicles/pages/VehicleListPage'))
const VehicleDetail = lazy(() => import('./features/vehicles/pages/VehicleDetailPage'))
const VehicleAccess = lazy(() => import('./features/vehicles/pages/VehicleAccessPage'))
const DigitalTwin = lazy(() => import('./features/vehicles/pages/DigitalTwinPage'))

// Charging
const Charging = lazy(() => import('./features/charging/pages/ChargingListPage'))
const ChargeDetail = lazy(() => import('./features/charging/pages/ChargingDetailPage'))
const ChargingCurve = lazy(() => import('./features/charging/pages/ChargingCurvePage'))
const ChargingHeatmap = lazy(() => import('./features/charging/pages/ChargingHeatmapPage'))
const CostAnalysis = lazy(() => import('./features/charging/pages/CostAnalysisPage'))
const TeslaChargingHistory = lazy(() => import('./features/charging/pages/TeslaChargingHistoryPage'))
const TeslaChargingSessions = lazy(() => import('./features/charging/pages/TeslaChargingSessionsPage'))

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

// Driving & Performance
const Drives = lazy(() => import('./features/driving/pages/DrivesListPage'))
const DriveDetail = lazy(() => import('./features/driving/pages/DriveDetailPage'))
const TripReplay = lazy(() => import('./features/driving/pages/TripReplayPage'))
const DriveScore = lazy(() => import('./features/driving/pages/DriveScorePage'))
const DrivingDynamics = lazy(() => import('./features/driving/pages/DrivingDynamicsPage'))
const DrivetrainHealth = lazy(() => import('./features/driving/pages/DrivetrainHealthPage'))
const Efficiency = lazy(() => import('./features/driving/pages/EfficiencyPage'))
const SpeedProfile = lazy(() => import('./features/driving/pages/SpeedProfilePage'))
const RegenEfficiency = lazy(() => import('./features/driving/pages/RegenEfficiencyPage'))
const RouteEfficiency = lazy(() => import('./features/driving/pages/RouteEfficiencyPage'))

// Analytics & Statistics
const Analytics = lazy(() => import('./features/analytics/pages/AnalyticsPage'))
const Statistics = lazy(() => import('./features/analytics/pages/StatisticsPage'))
const Compare = lazy(() => import('./features/analytics/pages/ComparePage'))
const Mileage = lazy(() => import('./features/analytics/pages/MileagePage'))
const TrueCostOwnership = lazy(() => import('./features/analytics/pages/TrueCostPage'))
const WeeklyDigest = lazy(() => import('./features/analytics/pages/WeeklyDigestPage'))
const Timeline = lazy(() => import('./features/analytics/pages/TimelinePage'))
const VehicleComparison = lazy(() => import('./features/analytics/pages/ComparisonPage'))

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
const MediaPlayer = lazy(() => import('./features/vehicle-systems/pages/MediaPlayerPage'))

// Automations
const AutomationsListPage = lazy(() => import('./features/automations/pages/AutomationsListPage'))
const AutomationBuilderPage = lazy(() => import('./features/automations/pages/AutomationBuilderPage'))

// Notifications & Alerts
const Alerts = lazy(() => import('./features/notifications/pages/AlertsPage'))
const AlertStudio = lazy(() => import('./features/notifications/pages/AlertStudioPage'))
const Notifications = lazy(() => import('./features/notifications/pages/NotificationsPage'))

// Telemetry & Signals
const SignalExplorer = lazy(() => import('./features/telemetry/pages/SignalExplorerPage'))
const SignalLogViewer = lazy(() => import('./features/telemetry/pages/SignalLogViewerPage'))
const SignalDiff = lazy(() => import('./features/telemetry/pages/SignalDiffPage'))
const SignalGapDetector = lazy(() => import('./features/telemetry/pages/SignalGapDetectorPage'))
const LiveSignalMonitor = lazy(() => import('./features/telemetry/pages/LiveSignalMonitorPage'))
const MQTTInspector = lazy(() => import('./features/telemetry/pages/MQTTInspectorPage'))

// Diagnostics
const AnomalyDashboard = lazy(() => import('./features/diagnostics/pages/AnomalyDashboardPage'))

// Admin & DevTools
const Admin = lazy(() => import('./features/admin/pages/AdminPage'))
const DevTools = lazy(() => import('./features/admin/pages/DevToolsPage'))
const APIKeysPage = lazy(() => import('./features/admin/pages/APIKeysPage'))
const ApiLogs = lazy(() => import('./features/admin/pages/ApiLogsPage'))
const FleetAPI = lazy(() => import('./features/admin/pages/FleetAPIPage'))
const SecurityAccess = lazy(() => import('./features/admin/pages/SecurityAccessPage'))
const BackupRestore = lazy(() => import('./features/admin/pages/BackupRestorePage'))
const ApiPlayground = lazy(() => import('./features/admin/pages/ApiPlaygroundPage'))

// System & Ops
const SystemStatus = lazy(() => import('./features/system/pages/SystemStatusPage'))
const DataExport = lazy(() => import('./features/system/pages/DataExportPage'))
const DataRepair = lazy(() => import('./features/system/pages/DataRepairPage'))
const DBHealthDashboard = lazy(() => import('./features/system/pages/DBHealthPage'))
const StateMachineDebugger = lazy(() => import('./features/system/pages/StateMachineDebuggerPage'))
const Commands = lazy(() => import('./features/system/pages/CommandsPage'))
const CommandHistory = lazy(() => import('./features/system/pages/CommandHistoryPage'))
const Chatbot = lazy(() => import('./features/system/pages/ChatbotPage'))
const Changelog = lazy(() => import('./features/system/pages/ChangelogPage'))
const Roadmap = lazy(() => import('./features/system/pages/RoadmapPage'))
const TeslaAccount = lazy(() => import('./features/system/pages/TeslaAccountPage'))

// Settings
const Settings = lazy(() => import('./features/settings/pages/SettingsPage'))

/** Route wrapper: Suspense for lazy loading + ErrorBoundary for crash isolation */
function SafeRoute({ children, name }: { children: React.ReactNode; name: string }) {
  return (
    <ErrorBoundary name={name}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  const navigate = useNavigate()

  // After re-authentication, redirect back to the page the user was on
  useEffect(() => {
    const returnUrl = sessionStorage.getItem('teslasync-return-url')
    if (returnUrl) {
      sessionStorage.removeItem('teslasync-return-url')
      try {
        const url = new URL(returnUrl)
        if (url.origin === window.location.origin && url.pathname !== window.location.pathname) {
          navigate(url.pathname + url.search + url.hash)
        }
      } catch {
        // Invalid URL stored — ignore
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <AuthExpiredOverlay />
      <Routes>
      <Route path="quick-stats" element={<SafeRoute name="QuickStats"><QuickStats /></SafeRoute>} />
      <Route path="glance" element={<SafeRoute name="Glance"><GlancePage /></SafeRoute>} />
      <Route path="/" element={<Layout />}>
        <Route index element={<SafeRoute name="Dashboard"><Dashboard /></SafeRoute>} />
        <Route path="live" element={<SafeRoute name="LiveMap"><LiveMap /></SafeRoute>} />
        <Route path="vehicles" element={<SafeRoute name="Vehicles"><Vehicles /></SafeRoute>} />
        <Route path="vehicles/:id" element={<SafeRoute name="VehicleDetail"><VehicleDetail /></SafeRoute>} />
        <Route path="vehicles/:id/access" element={<SafeRoute name="VehicleAccess"><VehicleAccess /></SafeRoute>} />
        <Route path="digital-twin" element={<SafeRoute name="DigitalTwin"><DigitalTwin /></SafeRoute>} />
        <Route path="energy" element={<SafeRoute name="Energy"><Energy /></SafeRoute>} />
        <Route path="battery" element={<SafeRoute name="BatteryHealth"><BatteryHealth /></SafeRoute>} />
        <Route path="drives" element={<SafeRoute name="Drives"><Drives /></SafeRoute>} />
        <Route path="charging" element={<SafeRoute name="Charging"><Charging /></SafeRoute>} />
        <Route path="analytics" element={<SafeRoute name="Analytics"><Analytics /></SafeRoute>} />
        <Route path="commands" element={<SafeRoute name="Commands"><Commands /></SafeRoute>} />
        <Route path="command-history" element={<SafeRoute name="CommandHistory"><CommandHistory /></SafeRoute>} />
        <Route path="automations" element={<SafeRoute name="Automations"><AutomationsListPage /></SafeRoute>} />
        <Route path="automations/new" element={<SafeRoute name="AutomationBuilder"><AutomationBuilderPage /></SafeRoute>} />
        <Route path="automations/:id/edit" element={<SafeRoute name="AutomationBuilder"><AutomationBuilderPage /></SafeRoute>} />
        <Route path="alerts" element={<SafeRoute name="Alerts"><Alerts /></SafeRoute>} />
        <Route path="alert-studio" element={<SafeRoute name="AlertStudio"><AlertStudio /></SafeRoute>} />
        <Route path="geofences" element={<SafeRoute name="Geofences"><Geofences /></SafeRoute>} />
        <Route path="settings" element={<SafeRoute name="Settings"><Settings /></SafeRoute>} />
        <Route path="drives/:id" element={<SafeRoute name="DriveDetail"><DriveDetail /></SafeRoute>} />
        <Route path="drives/:id/replay" element={<SafeRoute name="TripReplay"><TripReplay /></SafeRoute>} />
        <Route path="charging/:id" element={<SafeRoute name="ChargeDetail"><ChargeDetail /></SafeRoute>} />
        <Route path="notifications" element={<SafeRoute name="Notifications"><Notifications /></SafeRoute>} />
        <Route path="chatbot" element={<SafeRoute name="Chatbot"><Chatbot /></SafeRoute>} />
        <Route path="tire-pressure" element={<SafeRoute name="TirePressure"><TirePressure /></SafeRoute>} />
        <Route path="software-updates" element={<SafeRoute name="SoftwareUpdates"><SoftwareUpdates /></SafeRoute>} />
        <Route path="vampire-drain" element={<SafeRoute name="VampireDrain"><VampireDrain /></SafeRoute>} />
        <Route path="locations" element={<SafeRoute name="Locations"><Locations /></SafeRoute>} />
        <Route path="timeline" element={<SafeRoute name="Timeline"><Timeline /></SafeRoute>} />
        <Route path="mileage" element={<SafeRoute name="Mileage"><Mileage /></SafeRoute>} />
        <Route path="projected-range" element={<SafeRoute name="ProjectedRange"><ProjectedRange /></SafeRoute>} />
        <Route path="efficiency" element={<SafeRoute name="Efficiency"><Efficiency /></SafeRoute>} />
        <Route path="trips" element={<SafeRoute name="Trips"><Trips /></SafeRoute>} />
        <Route path="trips/:id" element={<SafeRoute name="TripDetail"><TripDetail /></SafeRoute>} />
        <Route path="statistics" element={<SafeRoute name="Statistics"><Statistics /></SafeRoute>} />
        <Route path="system-status" element={<SafeRoute name="SystemStatus"><SystemStatus /></SafeRoute>} />
        <Route path="roadmap" element={<SafeRoute name="Roadmap"><Roadmap /></SafeRoute>} />
        <Route path="api-keys" element={<SafeRoute name="APIKeys"><APIKeysPage /></SafeRoute>} />
        <Route path="changelog" element={<SafeRoute name="Changelog"><Changelog /></SafeRoute>} />
        <Route path="compare" element={<SafeRoute name="Compare"><Compare /></SafeRoute>} />
        <Route path="admin" element={<SafeRoute name="Admin"><Admin /></SafeRoute>} />
        <Route path="api-logs" element={<SafeRoute name="ApiLogs"><ApiLogs /></SafeRoute>} />
        <Route path="fleet-api" element={<SafeRoute name="FleetAPI"><FleetAPI /></SafeRoute>} />
        <Route path="dev-tools" element={<SafeRoute name="DevTools"><DevTools /></SafeRoute>} />
        <Route path="api-playground" element={<SafeRoute name="ApiPlayground"><ApiPlayground /></SafeRoute>} />
        <Route path="signal-explorer" element={<SafeRoute name="SignalExplorer"><SignalExplorer /></SafeRoute>} />
        <Route path="signal-log" element={<SafeRoute name="SignalLogViewer"><SignalLogViewer /></SafeRoute>} />
        <Route path="live-monitor" element={<SafeRoute name="LiveSignalMonitor"><LiveSignalMonitor /></SafeRoute>} />
        <Route path="state-debugger" element={<SafeRoute name="StateMachineDebugger"><StateMachineDebugger /></SafeRoute>} />
        <Route path="signal-diff" element={<SafeRoute name="SignalDiff"><SignalDiff /></SafeRoute>} />
        <Route path="signal-gaps" element={<SafeRoute name="SignalGapDetector"><SignalGapDetector /></SafeRoute>} />
        <Route path="db-health" element={<SafeRoute name="DBHealthDashboard"><DBHealthDashboard /></SafeRoute>} />
        <Route path="mqtt-inspector" element={<SafeRoute name="MQTTInspector"><MQTTInspector /></SafeRoute>} />
        <Route path="anomaly-detection" element={<SafeRoute name="AnomalyDashboard"><AnomalyDashboard /></SafeRoute>} />
        <Route path="driving-dynamics" element={<SafeRoute name="DrivingDynamics"><DrivingDynamics /></SafeRoute>} />
        <Route path="climate-control" element={<SafeRoute name="ClimateControl"><ClimateControl /></SafeRoute>} />
        <Route path="security-access" element={<SafeRoute name="SecurityAccess"><SecurityAccess /></SafeRoute>} />
        <Route path="charging-curve" element={<SafeRoute name="ChargingCurve"><ChargingCurve /></SafeRoute>} />
        <Route path="cost-analysis" element={<SafeRoute name="CostAnalysis"><CostAnalysis /></SafeRoute>} />
        <Route path="tesla-charging-history" element={<SafeRoute name="TeslaChargingHistory"><TeslaChargingHistory /></SafeRoute>} />
        <Route path="tesla-charging-sessions" element={<SafeRoute name="TeslaChargingSessions"><TeslaChargingSessions /></SafeRoute>} />
        <Route path="battery-cells" element={<SafeRoute name="BatteryCells"><BatteryCells /></SafeRoute>} />
        <Route path="drive-score" element={<SafeRoute name="DriveScore"><DriveScore /></SafeRoute>} />
        <Route path="weekly-digest" element={<SafeRoute name="WeeklyDigest"><WeeklyDigest /></SafeRoute>} />
        <Route path="maintenance" element={<SafeRoute name="Maintenance"><Maintenance /></SafeRoute>} />
        <Route path="data-export" element={<SafeRoute name="DataExport"><DataExport /></SafeRoute>} />
        <Route path="energy-flow" element={<SafeRoute name="EnergyFlow"><EnergyFlow /></SafeRoute>} />
        <Route path="power-flow" element={<SafeRoute name="PowerFlowDashboard"><PowerFlowDashboard /></SafeRoute>} />
        <Route path="energy-products" element={<SafeRoute name="EnergyProducts"><EnergyProducts /></SafeRoute>} />
        <Route path="drivetrain-health" element={<SafeRoute name="DrivetrainHealth"><DrivetrainHealth /></SafeRoute>} />
        <Route path="media-player" element={<SafeRoute name="MediaPlayer"><MediaPlayer /></SafeRoute>} />
        <Route path="safety-settings" element={<SafeRoute name="SafetySettings"><SafetySettings /></SafeRoute>} />
        <Route path="navigation" element={<SafeRoute name="NavigationRoute"><NavigationRoute /></SafeRoute>} />
        <Route path="data-repair" element={<SafeRoute name="DataRepair"><DataRepair /></SafeRoute>} />
        <Route path="backup" element={<SafeRoute name="BackupRestore"><BackupRestore /></SafeRoute>} />
        <Route path="temperature-impact" element={<SafeRoute name="TemperatureImpact"><TemperatureImpact /></SafeRoute>} />
        <Route path="route-efficiency" element={<SafeRoute name="RouteEfficiency"><RouteEfficiency /></SafeRoute>} />
        <Route path="regen-efficiency" element={<SafeRoute name="RegenEfficiency"><RegenEfficiency /></SafeRoute>} />
        <Route path="battery-degradation" element={<SafeRoute name="BatteryDegradation"><BatteryDegradation /></SafeRoute>} />
        <Route path="tco" element={<SafeRoute name="TrueCostOwnership"><TrueCostOwnership /></SafeRoute>} />
        <Route path="vehicle-comparison" element={<SafeRoute name="VehicleComparison"><VehicleComparison /></SafeRoute>} />
        <Route path="sleep-efficiency" element={<SafeRoute name="SleepEfficiency"><SleepEfficiency /></SafeRoute>} />
        <Route path="charging-heatmap" element={<SafeRoute name="ChargingHeatmap"><ChargingHeatmap /></SafeRoute>} />
        <Route path="speed-profile" element={<SafeRoute name="SpeedProfile"><SpeedProfile /></SafeRoute>} />
        <Route path="tesla-account" element={<SafeRoute name="TeslaAccount"><TeslaAccount /></SafeRoute>} />
      </Route>
      </Routes>
    </>
  )
}
