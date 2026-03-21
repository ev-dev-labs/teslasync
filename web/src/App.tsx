import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { PageLoader } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'

// Lazy-loaded pages for optimal code splitting
const Dashboard = lazy(() => import('./pages/Dashboard'))
const LiveMap = lazy(() => import('./pages/LiveMap'))
const Vehicles = lazy(() => import('./pages/Vehicles'))
const VehicleDetail = lazy(() => import('./pages/VehicleDetail'))
const Energy = lazy(() => import('./pages/Energy'))
const BatteryHealth = lazy(() => import('./pages/BatteryHealth'))
const Drives = lazy(() => import('./pages/Drives'))
const Charging = lazy(() => import('./pages/Charging'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Commands = lazy(() => import('./pages/Commands'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Geofences = lazy(() => import('./pages/Geofences'))
const Settings = lazy(() => import('./pages/Settings'))
const DriveDetail = lazy(() => import('./pages/DriveDetail'))
const ChargeDetail = lazy(() => import('./pages/ChargeDetail'))
const Notifications = lazy(() => import('./pages/Notifications'))
const Chatbot = lazy(() => import('./pages/Chatbot'))
const TirePressure = lazy(() => import('./pages/TirePressure'))
const SoftwareUpdates = lazy(() => import('./pages/SoftwareUpdates'))
const VampireDrain = lazy(() => import('./pages/VampireDrain'))
const Locations = lazy(() => import('./pages/Locations'))
const Timeline = lazy(() => import('./pages/Timeline'))
const Mileage = lazy(() => import('./pages/Mileage'))
const ProjectedRange = lazy(() => import('./pages/ProjectedRange'))
const Efficiency = lazy(() => import('./pages/Efficiency'))
const Trips = lazy(() => import('./pages/Trips'))
const Statistics = lazy(() => import('./pages/Statistics'))
const SystemStatus = lazy(() => import('./pages/SystemStatus'))
const Roadmap = lazy(() => import('./pages/Roadmap'))
const APIKeysPage = lazy(() => import('./pages/APIKeys'))
const Changelog = lazy(() => import('./pages/Changelog'))
const Compare = lazy(() => import('./pages/Compare'))

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
        <Route path="statistics" element={<SafeRoute name="Statistics"><Statistics /></SafeRoute>} />
        <Route path="system-status" element={<SafeRoute name="SystemStatus"><SystemStatus /></SafeRoute>} />
        <Route path="roadmap" element={<SafeRoute name="Roadmap"><Roadmap /></SafeRoute>} />
        <Route path="api-keys" element={<SafeRoute name="APIKeys"><APIKeysPage /></SafeRoute>} />
        <Route path="changelog" element={<SafeRoute name="Changelog"><Changelog /></SafeRoute>} />
        <Route path="compare" element={<SafeRoute name="Compare"><Compare /></SafeRoute>} />
      </Route>
    </Routes>
  )
}
