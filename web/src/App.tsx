import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { PageLoader } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'

// ── Refactored pages (features/ architecture) ──────────────────────────
const Dashboard = lazy(() => import('./features/dashboard/pages/DashboardPage'))
const Vehicles = lazy(() => import('./features/vehicles/pages/VehicleListPage'))
const VehicleDetail = lazy(() => import('./features/vehicles/pages/VehicleDetailPage'))
const Charging = lazy(() => import('./features/charging/pages/ChargingListPage'))
const ChargeDetail = lazy(() => import('./features/charging/pages/ChargingDetailPage'))
const Trips = lazy(() => import('./features/trips/pages/TripListPage'))
const TripDetail = lazy(() => import('./features/trips/pages/TripDetailPage'))
const Settings = lazy(() => import('./features/settings/pages/SettingsPage'))
const LiveMap = lazy(() => import('./features/maps/pages/MapOverviewPage'))

// ── Legacy pages (not yet migrated to features/) ──────────────────────
// TODO(refactor): migrate to features/energy/pages/
const Energy = lazy(() => import('./pages/Energy'))
// TODO(refactor): migrate to features/battery/pages/
const BatteryHealth = lazy(() => import('./pages/BatteryHealth'))
// TODO(refactor): migrate to features/drives/pages/
const Drives = lazy(() => import('./pages/Drives'))
const DriveDetail = lazy(() => import('./pages/DriveDetail'))
// TODO(refactor): migrate to features/analytics/pages/
const Analytics = lazy(() => import('./pages/Analytics'))
// TODO(refactor): migrate to features/commands/pages/
const Commands = lazy(() => import('./pages/Commands'))
// TODO(refactor): migrate to features/alerts/pages/
const Alerts = lazy(() => import('./pages/Alerts'))
const AlertStudio = lazy(() => import('./pages/AlertStudio'))
// TODO(refactor): migrate to features/geofences/pages/
const Geofences = lazy(() => import('./pages/Geofences'))
// TODO(refactor): migrate to features/notifications/pages/
const Notifications = lazy(() => import('./pages/Notifications'))
// TODO(refactor): migrate to features/chatbot/pages/
const Chatbot = lazy(() => import('./pages/Chatbot'))
// TODO(refactor): migrate remaining pages to features/ architecture
const TirePressure = lazy(() => import('./pages/TirePressure'))
const SoftwareUpdates = lazy(() => import('./pages/SoftwareUpdates'))
const VampireDrain = lazy(() => import('./pages/VampireDrain'))
const Locations = lazy(() => import('./pages/Locations'))
const Timeline = lazy(() => import('./pages/Timeline'))
const Mileage = lazy(() => import('./pages/Mileage'))
const ProjectedRange = lazy(() => import('./pages/ProjectedRange'))
const Efficiency = lazy(() => import('./pages/Efficiency'))
const Statistics = lazy(() => import('./pages/Statistics'))
const SystemStatus = lazy(() => import('./pages/SystemStatus'))
const Roadmap = lazy(() => import('./pages/Roadmap'))
const APIKeysPage = lazy(() => import('./pages/APIKeys'))
const Changelog = lazy(() => import('./pages/Changelog'))
const Compare = lazy(() => import('./pages/Compare'))
const Admin = lazy(() => import('./pages/Admin'))
const ApiLogs = lazy(() => import('./pages/ApiLogs'))
const DevTools = lazy(() => import('./pages/DevTools'))
const QuickStats = lazy(() => import('./pages/QuickStats'))
const DrivingDynamics = lazy(() => import('./pages/DrivingDynamics'))
const ClimateControl = lazy(() => import('./pages/ClimateControl'))
const SecurityAccess = lazy(() => import('./pages/SecurityAccess'))
const ChargingCurve = lazy(() => import('./pages/ChargingCurve'))
const CostAnalysis = lazy(() => import('./pages/CostAnalysis'))
const BatteryCells = lazy(() => import('./pages/BatteryCells'))
const DriveScore = lazy(() => import('./pages/DriveScore'))
const WeeklyDigest = lazy(() => import('./pages/WeeklyDigest'))
const Maintenance = lazy(() => import('./pages/Maintenance'))
const DataExport = lazy(() => import('./pages/DataExport'))
const EnergyFlow = lazy(() => import('./pages/EnergyFlow'))
const DrivetrainHealth = lazy(() => import('./pages/DrivetrainHealth'))
const MediaPlayer = lazy(() => import('./pages/MediaPlayer'))
const SafetySettings = lazy(() => import('./pages/SafetySettings'))
const NavigationRoute = lazy(() => import('./pages/NavigationRoute'))
const DataRepair = lazy(() => import('./pages/DataRepair'))
const BackupRestore = lazy(() => import('./pages/BackupRestore'))
const TemperatureImpact = lazy(() => import('./pages/TemperatureImpact'))
const RouteEfficiency = lazy(() => import('./pages/RouteEfficiency'))
const RegenEfficiency = lazy(() => import('./pages/RegenEfficiency'))
const BatteryDegradation = lazy(() => import('./pages/BatteryDegradation'))
const TrueCostOwnership = lazy(() => import('./pages/TrueCostOwnership'))
const SleepEfficiency = lazy(() => import('./pages/SleepEfficiency'))
const ChargingHeatmap = lazy(() => import('./pages/ChargingHeatmap'))
const SpeedProfile = lazy(() => import('./pages/SpeedProfile'))
const SignalExplorer = lazy(() => import('./pages/SignalExplorer'))
const SignalLogViewer = lazy(() => import('./pages/SignalLogViewer'))
const LiveSignalMonitor = lazy(() => import('./pages/LiveSignalMonitor'))
const StateMachineDebugger = lazy(() => import('./pages/StateMachineDebugger'))
const SignalDiff = lazy(() => import('./pages/SignalDiff'))
const SignalGapDetector = lazy(() => import('./pages/SignalGapDetector'))
const DBHealthDashboard = lazy(() => import('./pages/DBHealthDashboard'))
const MQTTInspector = lazy(() => import('./pages/MQTTInspector'))
const FleetAPI = lazy(() => import('./pages/FleetAPI'))

/** Route wrapper: Suspense for lazy loading + ErrorBoundary for crash isolation */
function SafeRoute({ children, name }: { children: React.ReactNode; name: string }) {
  return (
    <ErrorBoundary name={name}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="quick-stats" element={<SafeRoute name="QuickStats"><QuickStats /></SafeRoute>} />
      <Route path="/" element={<Layout />}>
        <Route index element={<SafeRoute name="Dashboard"><Dashboard /></SafeRoute>} />
        <Route path="live" element={<SafeRoute name="LiveMap"><LiveMap /></SafeRoute>} />
        <Route path="vehicles" element={<SafeRoute name="Vehicles"><Vehicles /></SafeRoute>} />
        <Route path="vehicles/:id" element={<SafeRoute name="VehicleDetail"><VehicleDetail /></SafeRoute>} />
        <Route path="energy" element={<SafeRoute name="Energy"><Energy /></SafeRoute>} />
        <Route path="battery" element={<SafeRoute name="BatteryHealth"><BatteryHealth /></SafeRoute>} />
        <Route path="drives" element={<SafeRoute name="Drives"><Drives /></SafeRoute>} />
        <Route path="charging" element={<SafeRoute name="Charging"><Charging /></SafeRoute>} />
        <Route path="analytics" element={<SafeRoute name="Analytics"><Analytics /></SafeRoute>} />
        <Route path="commands" element={<SafeRoute name="Commands"><Commands /></SafeRoute>} />
        <Route path="alerts" element={<SafeRoute name="Alerts"><Alerts /></SafeRoute>} />
        <Route path="alert-studio" element={<SafeRoute name="AlertStudio"><AlertStudio /></SafeRoute>} />
        <Route path="geofences" element={<SafeRoute name="Geofences"><Geofences /></SafeRoute>} />
        <Route path="settings" element={<SafeRoute name="Settings"><Settings /></SafeRoute>} />
        <Route path="drives/:id" element={<SafeRoute name="DriveDetail"><DriveDetail /></SafeRoute>} />
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
        <Route path="signal-explorer" element={<SafeRoute name="SignalExplorer"><SignalExplorer /></SafeRoute>} />
        <Route path="signal-log" element={<SafeRoute name="SignalLogViewer"><SignalLogViewer /></SafeRoute>} />
        <Route path="live-monitor" element={<SafeRoute name="LiveSignalMonitor"><LiveSignalMonitor /></SafeRoute>} />
        <Route path="state-debugger" element={<SafeRoute name="StateMachineDebugger"><StateMachineDebugger /></SafeRoute>} />
        <Route path="signal-diff" element={<SafeRoute name="SignalDiff"><SignalDiff /></SafeRoute>} />
        <Route path="signal-gaps" element={<SafeRoute name="SignalGapDetector"><SignalGapDetector /></SafeRoute>} />
        <Route path="db-health" element={<SafeRoute name="DBHealthDashboard"><DBHealthDashboard /></SafeRoute>} />
        <Route path="mqtt-inspector" element={<SafeRoute name="MQTTInspector"><MQTTInspector /></SafeRoute>} />
        <Route path="driving-dynamics" element={<SafeRoute name="DrivingDynamics"><DrivingDynamics /></SafeRoute>} />
        <Route path="climate-control" element={<SafeRoute name="ClimateControl"><ClimateControl /></SafeRoute>} />
        <Route path="security-access" element={<SafeRoute name="SecurityAccess"><SecurityAccess /></SafeRoute>} />
        <Route path="charging-curve" element={<SafeRoute name="ChargingCurve"><ChargingCurve /></SafeRoute>} />
        <Route path="cost-analysis" element={<SafeRoute name="CostAnalysis"><CostAnalysis /></SafeRoute>} />
        <Route path="battery-cells" element={<SafeRoute name="BatteryCells"><BatteryCells /></SafeRoute>} />
        <Route path="drive-score" element={<SafeRoute name="DriveScore"><DriveScore /></SafeRoute>} />
        <Route path="weekly-digest" element={<SafeRoute name="WeeklyDigest"><WeeklyDigest /></SafeRoute>} />
        <Route path="maintenance" element={<SafeRoute name="Maintenance"><Maintenance /></SafeRoute>} />
        <Route path="data-export" element={<SafeRoute name="DataExport"><DataExport /></SafeRoute>} />
        <Route path="energy-flow" element={<SafeRoute name="EnergyFlow"><EnergyFlow /></SafeRoute>} />
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
        <Route path="sleep-efficiency" element={<SafeRoute name="SleepEfficiency"><SleepEfficiency /></SafeRoute>} />
        <Route path="charging-heatmap" element={<SafeRoute name="ChargingHeatmap"><ChargingHeatmap /></SafeRoute>} />
        <Route path="speed-profile" element={<SafeRoute name="SpeedProfile"><SpeedProfile /></SafeRoute>} />
      </Route>
    </Routes>
  )
}
