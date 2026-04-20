import { Outlet, NavLink, useLocation } from 'react-router-dom'
import InstallPrompt from '../feedback/InstallPrompt'
import {
  LayoutDashboard,
  Car,
  Route,
  BatteryCharging,
  MapPin,
  Settings,
  Zap,
  Menu,
  Radar,
  Bolt,
  HeartPulse,
  Gamepad2,
  Bell,
  BarChart3,
  Wifi,
  WifiOff,
  BellRing,
  Bot,
  Gauge,
  Download,
  Moon,
  Clock,
  Milestone,
  Target,
  Navigation,
  Activity,
  GitCompare,
  ArrowLeftRight,
  Wallet,
  BedDouble,
  ShieldAlert,
  FileText,
  Wrench,
  Thermometer,
  Lock,
  Cog,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Battery,
  Trophy,
  CalendarCheck,
  CalendarClock,
  HardDriveDownload,
  Headphones,
  DatabaseBackup,
  Recycle,
  Database,
  History,
  Monitor,
  Terminal,
  // Unique icon replacements (no more duplicates)
  ArrowRightLeft,
  Leaf,
  Workflow,
  BellPlus,
  Cloud,
  Grid3X3,
  PieChart,
  ShieldCheck,
  CircleDot,
  Fence,
  ThermometerSun,
  Navigation2,
  Stethoscope,
  MapPinned,
  Cpu,
  KeyRound,
  ScanSearch,
  Map,
  RadioTower,
  SlidersHorizontal,
  Award,
  Bug,
  HardDrive,
  Split,
  Radio,
  Signpost,
  Hammer,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useTour, isTourCompleted } from '@/hooks/useTour'
import { GotoIndicator } from '../feedback/GotoIndicator'
import { KeyboardCheatSheet } from '../feedback/KeyboardCheatSheet'
import { TourOverlay } from '../feedback/TourOverlay'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { BottomTabBar, BOTTOM_TAB_PATHS } from './BottomTabBar'
import { CommandPalette, CommandPaletteTrigger } from '../ui/CommandPalette'
import { ServiceStatusBanner, SystemHealthDot } from '../data-display/ServiceStatus'
import Logo from '../ui/Logo'
import OnboardingWizard from '../feedback/OnboardingWizard'
import { MAIN_TOUR_STEPS } from '@/features/onboarding/tourSteps'
import { request } from '@/api/client'
import { getVehicleState } from '@/api/vehicles'
import type { Alert, Vehicle, VersionInfo, UpdateCheckResult, StaleSessionsResponse } from '@/api/types'
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents'
import { useNotificationListener } from '../../hooks/useNotificationListener'
import { useToast } from '../feedback/Toast'
import { useSettings } from '../../hooks/useSettings'
import { GlassPanel } from '../ui/GlassPanel'

const navI18nKeys: Record<string, string> = {
  'Dashboard': 'nav.dashboard',
  'Live Map': 'nav.liveMap',
  'Fleet': 'nav.vehicles',
  'Drives': 'nav.drives',
  'Charging': 'nav.charging',
  'Energy': 'nav.energy',
  'Battery Health': 'nav.battery',
  'Analytics': 'nav.analytics',
  'Vehicle Comparison': 'nav.vehicleComparison',
  'Efficiency': 'nav.efficiency',
  'Mileage': 'nav.mileage',
  'Timeline': 'nav.timeline',
  'Locations': 'nav.locations',
  'Trips': 'nav.trips',
  'Tire Pressure': 'nav.tirePressure',
  'Vampire Drain': 'nav.vampireDrain',
  'Software Updates': 'nav.softwareUpdates',
  'Projected Range': 'nav.projectedRange',
  'Statistics': 'nav.statistics',
  'Alerts': 'nav.alerts',
  'Commands': 'nav.commands',
  'Command History': 'nav.commandHistory',
  'Geofences': 'nav.geofences',
  'Notifications': 'nav.notifications',
  'Settings': 'nav.settings',
  'Driving Dynamics': 'nav.drivingDynamics',
  'Climate Control': 'nav.climateControl',
  'Security & Access': 'nav.securityAccess',
  'Temperature Impact': 'nav.temperatureImpact',
  'Route Efficiency': 'nav.routeEfficiency',
  'Automations': 'nav.automations',
  'Digital Twin': 'nav.digitalTwin',
  'Smart Charge': 'nav.smartCharge',
  'Guard Mode': 'nav.guardMode',
}

type SSEState = 'connected' | 'reconnecting' | 'unavailable'

function SSEStatusDot({ state }: { state: SSEState }) {
  if (state === 'unavailable') return null // hide dot — polling handles everything
  const isConnected = state === 'connected'
  return (
    <span
      title={isConnected ? 'Live updates active' : 'Reconnecting live updates…'}
      className={clsx(
        'inline-block h-2 w-2 rounded-full shrink-0',
        isConnected ? 'bg-neon-green' : 'bg-amber-400 animate-pulse',
      )}
      style={{ boxShadow: `0 0 6px ${isConnected ? 'rgba(16,185,129,0.5)' : 'rgba(251,191,36,0.5)'}` }}
    />
  )
}

export const navSections = [
  {
    title: 'Overview',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', color: 'text-blue-400' },
      { to: '/live', icon: Radar, label: 'Live Map', color: 'text-emerald-400' },
      { to: '/vehicles', icon: Car, label: 'Fleet', color: 'text-sky-400', dataTour: 'vehicle-section' },
      { to: '/compare', icon: GitCompare, label: 'Compare', color: 'text-orange-400' },
      { to: '/weekly-digest', icon: CalendarCheck, label: 'Weekly Digest', color: 'text-purple-400' },
      { to: '/navigation', icon: Navigation, label: 'Navigation', color: 'text-teal-400' },
    ],
  },
  {
    title: 'Driving',
    items: [
      { to: '/drives', icon: Route, label: 'Drives', color: 'text-violet-400' },
      { to: '/trips', icon: MapPinned, label: 'Trips', color: 'text-teal-400' },
      { to: '/trip-planner', icon: MapPin, label: 'Trip Planner', color: 'text-emerald-400' },
      { to: '/drive-score', icon: Trophy, label: 'Drive Score', color: 'text-yellow-400' },
      { to: '/speed-profile', icon: Gauge, label: 'Speed Profile', color: 'text-rose-400' },
      { to: '/driving-dynamics', icon: Cog, label: 'Driving Dynamics', color: 'text-red-400' },
      { to: '/regen-efficiency', icon: Recycle, label: 'Regen Braking', color: 'text-green-400' },
    ],
  },
  {
    title: 'Battery & Charging',
    items: [
      { to: '/battery', icon: HeartPulse, label: 'Battery Health', color: 'text-rose-400' },
      { to: '/battery-cells', icon: Battery, label: 'Battery Cells', color: 'text-purple-400' },
      { to: '/battery-degradation', icon: TrendingDown, label: 'Degradation', color: 'text-orange-400' },
      { to: '/charging', icon: BatteryCharging, label: 'Charging', color: 'text-green-400' },
      { to: '/charging-heatmap', icon: Grid3X3, label: 'Charging Patterns', color: 'text-cyan-400' },
      { to: '/charging-curve', icon: TrendingUp, label: 'Charging Curve', color: 'text-lime-400' },
      { to: '/smart-charge', icon: CalendarClock, label: 'Smart Charge', color: 'text-cyan-400' },
    ],
  },
  {
    title: 'Energy & Efficiency',
    items: [
      { to: '/energy', icon: Bolt, label: 'Energy', color: 'text-yellow-400' },
      { to: '/energy-flow', icon: ArrowRightLeft, label: 'Energy Flow', color: 'text-yellow-400' },
      { to: '/efficiency', icon: Leaf, label: 'Efficiency', color: 'text-amber-400' },
      { to: '/route-efficiency', icon: Navigation2, label: 'Route Efficiency', color: 'text-emerald-400' },
      { to: '/projected-range', icon: Target, label: 'Projected Range', color: 'text-pink-400' },
      { to: '/mileage', icon: Milestone, label: 'Mileage', color: 'text-teal-400' },
      { to: '/temperature-impact', icon: ThermometerSun, label: 'Temperature Impact', color: 'text-blue-400' },
      { to: '/cost-analysis', icon: DollarSign, label: 'Cost Analysis', color: 'text-emerald-400' },
      { to: '/tco', icon: Wallet, label: 'Cost of Ownership', color: 'text-green-400' },
    ],
  },
  {
    title: 'Vehicle',
    items: [
      { to: '/digital-twin', icon: Monitor, label: 'Digital Twin', color: 'text-cyan-400' },
      { to: '/tire-pressure', icon: CircleDot, label: 'Tire Pressure', color: 'text-orange-400' },
      { to: '/climate-control', icon: Thermometer, label: 'Climate Control', color: 'text-sky-400' },
      { to: '/drivetrain-health', icon: Cpu, label: 'Drivetrain Health', color: 'text-red-400' },
      { to: '/vampire-drain', icon: Moon, label: 'Vampire Drain', color: 'text-indigo-400' },
      { to: '/sleep-efficiency', icon: BedDouble, label: 'Sleep Efficiency', color: 'text-purple-400' },
      { to: '/software-updates', icon: Download, label: 'Software Updates', color: 'text-teal-400' },
      { to: '/maintenance', icon: Wrench, label: 'Maintenance', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { to: '/analytics', icon: BarChart3, label: 'Analytics', color: 'text-indigo-400' },
      { to: '/statistics', icon: PieChart, label: 'Statistics', color: 'text-cyan-400' },
      { to: '/lifetime-stats', icon: Award, label: 'Lifetime Stats', color: 'text-yellow-400' },
      { to: '/vehicle-comparison', icon: ArrowLeftRight, label: 'Vehicle Comparison', color: 'text-orange-400', minVehicles: 2 },
      { to: '/timeline', icon: Clock, label: 'Timeline', color: 'text-sky-400' },
      { to: '/locations', icon: Map, label: 'Locations', color: 'text-emerald-400' },
    ],
  },
  {
    title: 'Control',
    items: [
      { to: '/commands', icon: Gamepad2, label: 'Commands', color: 'text-fuchsia-400', dataTour: 'commands-section' },
      { to: '/command-history', icon: History, label: 'Command History', color: 'text-violet-400' },
      { to: '/automations', icon: Workflow, label: 'Automations', color: 'text-neon-cyan' },
      { to: '/alerts', icon: Bell, label: 'Alerts', color: 'text-red-400' },
      { to: '/alert-studio', icon: BellPlus, label: 'Alert Studio', color: 'text-neon-cyan' },
      { to: '/geofences', icon: Fence, label: 'Geofences', color: 'text-lime-400' },
      { to: '/notifications', icon: BellRing, label: 'Notifications', color: 'text-purple-400' },
      { to: '/security-access', icon: Lock, label: 'Security & Access', color: 'text-emerald-400' },
      { to: '/safety-settings', icon: ShieldCheck, label: 'Safety Settings', color: 'text-amber-400' },
      { to: '/guard-mode', icon: ShieldAlert, label: 'Guard Mode', color: 'text-red-400' },
    ],
  },
  {
    title: 'AI',
    items: [
      { to: '/chatbot', icon: Bot, label: 'Chatbot', color: 'text-cyan-400' },
      { to: '/media-player', icon: Headphones, label: 'Media Player', color: 'text-pink-400' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/system-status', icon: Activity, label: 'Status', color: 'text-emerald-400' },
      { to: '/api-logs', icon: FileText, label: 'API Logs', color: 'text-amber-400' },
      { to: '/fleet-api', icon: Cloud, label: 'Fleet API', color: 'text-sky-400' },
      { to: '/settings', icon: Settings, label: 'Settings', color: 'text-[var(--text-muted)]' },
      { to: '/admin', icon: KeyRound, label: 'Admin', color: 'text-red-400' },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/data-export', icon: HardDriveDownload, label: 'Data Export', color: 'text-lime-400' },
      { to: '/backup', icon: DatabaseBackup, label: 'Backup & Restore', color: 'text-teal-400' },
      { to: '/data-repair', icon: Stethoscope, label: 'Data Repair', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Developer',
    items: [
      { to: '/dev-tools', icon: Hammer, label: 'Dev Tools', color: 'text-cyan-400' },
      { to: '/api-playground', icon: Terminal, label: 'API Playground', color: 'text-emerald-400' },
      { to: '/roadmap', icon: Signpost, label: 'Roadmap', color: 'text-violet-400' },
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      { to: '/live-monitor', icon: RadioTower, label: 'Live Monitor', color: 'text-neon-green', dataTour: 'live-signals-section' },
      { to: '/signal-log', icon: Database, label: 'Signal Log', color: 'text-cyan-400' },
      { to: '/signal-explorer', icon: SlidersHorizontal, label: 'Signal Explorer', color: 'text-neon-cyan' },
      { to: '/signal-diff', icon: Split, label: 'Signal Diff', color: 'text-violet-400' },
      { to: '/signal-gaps', icon: Wifi, label: 'Gap Detector', color: 'text-amber-400' },
      { to: '/state-debugger', icon: Bug, label: 'State Machine', color: 'text-purple-400' },
      { to: '/mqtt-inspector', icon: Radio, label: 'MQTT Inspector', color: 'text-blue-400' },
      { to: '/db-health', icon: HardDrive, label: 'DB Health', color: 'text-emerald-400' },
      { to: '/anomaly-detection', icon: ScanSearch, label: 'Anomaly Detection', color: 'text-red-400' },
    ],
  },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { t } = useTranslation()

  // SSE connection status + global alert toast
  const toast = useToast()
  const { state: sseState } = useRealtimeEvents({
    onAlert: (data) => {
      const alert = data as { title?: string; message?: string; severity?: string }
      const severity = alert.severity ?? 'info'
      const method = severity === 'critical' ? toast.error : severity === 'warning' ? toast.warning : toast.info
      method(alert.title ?? 'Alert', alert.message ?? '')
    },
  })
  useNotificationListener()
  const { convertDistance, distanceUnit } = useSettings()
  const { mode: shortcutMode, showCheatSheet, toggleCheatSheet } = useKeyboardShortcuts()

  // Onboarding tour
  const tour = useTour(MAIN_TOUR_STEPS)
  useEffect(() => {
    if (!isTourCompleted()) {
      const timer = setTimeout(() => tour.start(), 1500)
      return () => clearTimeout(timer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Version info
  const { data: versionInfo } = useQuery({ queryKey: ['version-info'], queryFn: () => request<VersionInfo>('/system/version'), staleTime: 60_000, refetchInterval: 60_000 })
  const { data: updateCheck } = useQuery({ queryKey: ['update-check'], queryFn: () => request<UpdateCheckResult>('/system/update-check'), staleTime: 3600_000, refetchInterval: 3600_000 })

  // Live data for sidebar
  const { data: alerts } = useQuery({ queryKey: ['alerts-sidebar'], queryFn: () => request<Alert[]>('/alerts?limit=50&offset=0'), refetchInterval: 30_000, retry: 1 })
  const { data: vehicles } = useQuery({ queryKey: ['vehicles-sidebar'], queryFn: () => request<Vehicle[]>('/vehicles'), refetchInterval: 60_000, retry: 1 })
  const primaryVehicle = vehicles?.[0]
  const { data: primaryState } = useQuery({
    queryKey: ['primary-state-sidebar', primaryVehicle?.id],
    queryFn: () => getVehicleState(primaryVehicle!.id),
    enabled: !!primaryVehicle,
    refetchInterval: 60_000,
  })
  const unreadAlerts = alerts?.filter(a => !a.is_read).length ?? 0
  const onlineVehicles = vehicles?.filter(v => v.state === 'online').length ?? 0
  const isConnected = !!primaryState?.live

  // Stale sessions count for Data Repair badge
  const { data: staleSessions } = useQuery({ queryKey: ['stale-sessions-sidebar'], queryFn: () => request<StaleSessionsResponse>('/data-repair/stale-sessions'), refetchInterval: 60_000, retry: 1 })
  const staleCount = (staleSessions?.stale_charging?.length ?? 0) + (staleSessions?.stale_drives?.length ?? 0)

  const uptimeStr= (() => {
    const secs = versionInfo?.uptime_seconds
    if (!secs || secs <= 0) return 'Online'
    const d = Math.floor(secs / 86400)
    const h = Math.floor((secs % 86400) / 3600)
    const m = Math.floor((secs % 3600) / 60)
    if (d > 0) return `${d}d ${h}h uptime`
    if (h > 0) return `${h}h ${m}m uptime`
    return `${m}m uptime`
  })()

  const mainRef = useRef<HTMLElement>(null)

  return (
    <div className="flex h-dvh bg-[var(--bg)] text-white/90">
      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[300] focus:rounded-lg focus:bg-neon-cyan focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-black focus:outline-none"
        onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}
      >
        Skip to content
      </a>

      {/* Ambient background effects */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 -left-40 h-96 w-96 rounded-full bg-neon-cyan/[0.02] blur-[100px]" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-neon-purple/[0.02] blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-neon-blue/[0.01] blur-[120px]" />
      </div>

      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm lg:hidden"
            style={{ top: '56px' }}
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        role="navigation"
        aria-label="Main navigation"
        data-tour="sidebar"
        data-sidebar-open={sidebarOpen}
        className={clsx(
          'fixed left-0 bottom-0 top-14 z-[56] w-[clamp(240px,70vw,256px)] transform transition-transform duration-300 ease-out lg:top-0 lg:static lg:z-auto lg:w-64 lg:translate-x-0',
          'border-r border-white/[0.06] backdrop-blur-xl flex flex-col bg-white/[0.04]',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-3 px-5 py-5 border-b border-white/[0.06] shrink-0 hover:bg-white/[0.02] transition-colors" onClick={() => setSidebarOpen(false)}>
          <Logo size={32} showWordmark />
          <span className="ml-auto rounded-md bg-neon-cyan/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neon-cyan">
            {versionInfo?.chart_version && versionInfo.chart_version !== 'unknown'
              ? `v${versionInfo.chart_version}`
              : versionInfo?.app_version && versionInfo.app_version !== 'unknown'
                ? versionInfo.app_version
                : ''}
          </span>
        </NavLink>

        {/* Sticky search trigger */}
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
          <CommandPaletteTrigger />
        </div>

        {/* Navigation */}
        <nav
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-4 px-3 space-y-6 scrollbar-thin"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehaviorY: 'contain' }}
        >

          {navSections.map(section => (
            <div key={section.title}>
              <p className="mb-2 px-4 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items
                  .filter((item) => !('minVehicles' in item) || (vehicles?.length ?? 0) >= (item as { minVehicles?: number }).minVehicles!)
                  .map(({ to, icon: Icon, label, color, ...rest }) => {
                  const dataTour = 'dataTour' in rest ? (rest as { dataTour?: string }).dataTour : undefined;
                  const isActive = to === '/'
                    ? location.pathname === '/'
                    : location.pathname === to || location.pathname.startsWith(to + '/')
                  const isInTabBar = BOTTOM_TAB_PATHS.has(to)
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setSidebarOpen(false)}
                      aria-label={label}
                      aria-current={isActive ? 'page' : undefined}
                      data-tour={dataTour}
                      className={clsx(
                        'group relative flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200',
                        isInTabBar && 'opacity-50 lg:opacity-100'
                      )}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="nav-active"
                          className="absolute inset-0 rounded-xl bg-white/[0.06] border border-white/[0.08]"
                          style={{ boxShadow: '0 0 20px rgba(0, 240, 255, 0.05)' }}
                          transition={{ type: 'spring', bounce: 0.15, duration: 0.5 }}
                        />
                      )}
                      <span className="relative z-10">
                        <Icon className={clsx('h-[18px] w-[18px] transition-all duration-200', color, isActive ? 'opacity-100 drop-shadow-[0_0_6px_currentColor]' : 'opacity-40 group-hover:opacity-80')} />
                      </span>
                      <span className={clsx('relative z-10 transition-colors', isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]')}>
                        {navI18nKeys[label] ? (t(navI18nKeys[label]) === navI18nKeys[label] ? label : t(navI18nKeys[label])) : label}
                      </span>
                      {/* Badge for Alerts */}
                      {to === '/alerts' && unreadAlerts > 0 && (
                        <span className="relative z-10 ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-red/20 px-1.5 text-[10px] font-bold text-neon-red ring-1 ring-neon-red/30">
                          {unreadAlerts > 9 ? '9+' : unreadAlerts}
                        </span>
                      )}
                      {/* Badge for Fleet */}
                      {to === '/vehicles' && vehicles && vehicles.length > 0 && (
                        <span className="relative z-10 ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-cyan/10 px-1.5 text-[10px] font-bold text-neon-cyan ring-1 ring-neon-cyan/20">
                          {vehicles.length}
                        </span>
                      )}
                      {/* Badge for Data Repair */}
                      {to === '/data-repair' && staleCount > 0 && (
                        <span className="relative z-10 ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-amber/20 px-1.5 text-[10px] font-bold text-neon-amber ring-1 ring-neon-amber/30">
                          {staleCount > 9 ? '9+' : staleCount}
                        </span>
                      )}
                      {isActive && (
                        <span className="absolute right-3 h-1.5 w-1.5 rounded-full bg-neon-cyan shadow-[0_0_6px_rgba(0,240,255,0.5)]" />
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom status */}
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-2 shrink-0 safe-bottom">
          {/* Update available banner */}
          {updateCheck?.update_available && (
            <GlassPanel className="!p-2.5 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <Download className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-amber-300">Update available</p>
                <p className="text-[10px] text-amber-400/70">v{updateCheck.latest}</p>
              </div>
            </GlassPanel>
          )}
          {/* Live vehicle mini-status */}
          {primaryVehicle && primaryState?.state && (
            <GlassPanel className="!p-2.5 flex items-center gap-2.5">
              <div className={clsx('h-2 w-2 rounded-full', primaryState.state.battery_level > 20 ? 'bg-neon-green' : 'bg-neon-red')}
                style={{ boxShadow: `0 0 6px ${primaryState.state.battery_level > 20 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}` }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[var(--text-secondary)] truncate">{primaryVehicle.display_name || 'Vehicle'}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{primaryState.state.battery_level}% · {Math.round(convertDistance(primaryState.state.rated_range))} {distanceUnit}</p>
              </div>
              <Zap className="h-3 w-3 text-neon-cyan/50" />
            </GlassPanel>
          )}
          <GlassPanel className="flex items-center gap-3 !p-2.5">
            {isConnected ? (
              <Wifi className="h-3.5 w-3.5 text-neon-green" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            )}
            <div className="flex-1">
              <p className="text-[11px] font-medium text-[var(--text-secondary)]">{isConnected ? 'Connected' : 'Standby'}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{onlineVehicles}/{vehicles?.length ?? 0} vehicles · {uptimeStr}</p>
            </div>
            <SystemHealthDot />
            <SSEStatusDot state={sseState} />
          </GlassPanel>
          <p data-tour="keyboard-hint" className="text-center text-[10px] text-white/20 mt-1">
            {t('shortcuts.hint', 'Press')} <kbd className="px-1 rounded bg-white/5 text-white/30">?</kbd> {t('shortcuts.hintSuffix', 'for shortcuts')}
          </p>
        </div>
      </aside>

      {/* Mobile top bar — hidden when sidebar is open (sidebar has its own close button) */}
      {!sidebarOpen && (
        <header className="fixed top-0 left-0 right-0 z-[60] flex items-center border-b backdrop-blur-xl px-4 py-3 lg:hidden" style={{ borderColor: 'var(--glass-border)', background: 'var(--surface-1)', touchAction: 'manipulation' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            type="button"
            aria-label="Open sidebar"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            className="relative z-10 rounded-xl p-2.5 -ml-1 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] transition-colors active:scale-95"
          >
            <Menu className="h-6 w-6" />
          </button>
          <div className="flex-1 flex justify-center -ml-10">
            <Logo size={26} showWordmark />
          </div>
        </header>
      )}

      {/* Main content */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Spacer for fixed mobile header */}
        <div className="h-14 shrink-0 lg:hidden" />

        <ServiceStatusBanner />
        <main id="main-content" ref={mainRef} role="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none pb-16 lg:pb-0">
          <div className="mx-auto max-w-[1600px] px-3 py-4 pb-safe sm:px-5 sm:py-5 lg:px-8 lg:py-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <BottomTabBar />

      {/* Command Palette */}
      <CommandPalette />

      {/* Onboarding Wizard */}
      <OnboardingWizard />

      {/* PWA Install Prompt */}
      <InstallPrompt />

      {/* Keyboard shortcut overlays */}
      <GotoIndicator visible={shortcutMode === 'goto'} />
      <KeyboardCheatSheet open={showCheatSheet} onClose={toggleCheatSheet} />

      {/* Onboarding tour */}
      {tour.isActive && tour.step && (
        <TourOverlay
          step={tour.step}
          targetRect={tour.targetRect}
          currentStep={tour.currentStep}
          totalSteps={tour.totalSteps}
          onNext={tour.next}
          onPrev={tour.prev}
          onSkip={tour.skip}
        />
      )}
    </div>
  )
}
