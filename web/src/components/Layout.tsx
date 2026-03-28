import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Car,
  Route,
  BatteryCharging,
  MapPin,
  Settings,
  Zap,
  Menu,
  X,
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
  Shield,
  FileText,
  Wrench,
} from 'lucide-react'
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette'
import { ServiceStatusBanner, SystemHealthDot } from './ServiceStatus'
import Logo from './Logo'
import OnboardingWizard from './OnboardingWizard'
import { getAlerts, getVehicles, getVehicleState, getVersionInfo, checkForUpdates } from '../api'
import { useRealtimeEvents } from '../hooks/useRealtimeEvents'

const navI18nKeys: Record<string, string> = {
  'Dashboard': 'nav.dashboard',
  'Live Map': 'nav.liveMap',
  'Fleet': 'nav.vehicles',
  'Drives': 'nav.drives',
  'Charging': 'nav.charging',
  'Energy': 'nav.energy',
  'Battery Health': 'nav.battery',
  'Analytics': 'nav.analytics',
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
  'Geofences': 'nav.geofences',
  'Notifications': 'nav.notifications',
  'Settings': 'nav.settings',
}

function SSEStatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      title={connected ? 'SSE Connected' : 'SSE Disconnected'}
      className={clsx('inline-block h-2 w-2 rounded-full shrink-0', connected ? 'bg-neon-green' : 'bg-red-500')}
      style={{ boxShadow: `0 0 6px ${connected ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}` }}
    />
  )
}

const navSections = [
  {
    title: 'Overview',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', color: 'text-blue-400' },
      { to: '/live', icon: Radar, label: 'Live Map', color: 'text-emerald-400' },
      { to: '/vehicles', icon: Car, label: 'Fleet', color: 'text-sky-400' },
      { to: '/compare', icon: GitCompare, label: 'Compare', color: 'text-orange-400' },
    ],
  },
  {
    title: 'Intelligence',
    items: [
      { to: '/energy', icon: Bolt, label: 'Energy', color: 'text-yellow-400' },
      { to: '/battery', icon: HeartPulse, label: 'Battery Health', color: 'text-rose-400' },
      { to: '/drives', icon: Route, label: 'Drives', color: 'text-violet-400' },
      { to: '/charging', icon: BatteryCharging, label: 'Charging', color: 'text-green-400' },
      { to: '/analytics', icon: BarChart3, label: 'Analytics', color: 'text-indigo-400' },
      { to: '/efficiency', icon: Zap, label: 'Efficiency', color: 'text-amber-400' },
      { to: '/tire-pressure', icon: Gauge, label: 'Tire Pressure', color: 'text-orange-400' },
      { to: '/mileage', icon: Milestone, label: 'Mileage', color: 'text-teal-400' },
      { to: '/projected-range', icon: Target, label: 'Projected Range', color: 'text-pink-400' },
      { to: '/statistics', icon: BarChart3, label: 'Statistics', color: 'text-cyan-400' },
    ],
  },
  {
    title: 'Control',
    items: [
      { to: '/commands', icon: Gamepad2, label: 'Commands', color: 'text-fuchsia-400' },
      { to: '/alerts', icon: Bell, label: 'Alerts', color: 'text-red-400' },
      { to: '/geofences', icon: MapPin, label: 'Geofences', color: 'text-lime-400' },
      { to: '/notifications', icon: BellRing, label: 'Notifications', color: 'text-purple-400' },
    ],
  },
  {
    title: 'History',
    items: [
      { to: '/timeline', icon: Clock, label: 'Timeline', color: 'text-sky-400' },
      { to: '/locations', icon: MapPin, label: 'Locations', color: 'text-emerald-400' },
      { to: '/trips', icon: Navigation, label: 'Trips', color: 'text-violet-400' },
      { to: '/vampire-drain', icon: Moon, label: 'Vampire Drain', color: 'text-indigo-400' },
      { to: '/software-updates', icon: Download, label: 'Software Updates', color: 'text-teal-400' },
    ],
  },
  {
    title: 'AI',
    items: [
      { to: '/chatbot', icon: Bot, label: 'Chatbot', color: 'text-cyan-400' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/system-status', icon: Activity, label: 'Status', color: 'text-emerald-400' },
      { to: '/roadmap', icon: Target, label: 'Roadmap', color: 'text-violet-400' },
      { to: '/api-logs', icon: FileText, label: 'API Logs', color: 'text-amber-400' },
      { to: '/dev-tools', icon: Wrench, label: 'Dev Tools', color: 'text-cyan-400' },
      { to: '/settings', icon: Settings, label: 'Settings', color: 'text-gray-400' },
      { to: '/admin', icon: Shield, label: 'Admin', color: 'text-red-400' },
    ],
  },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { t } = useTranslation()

  // SSE connection status
  const { connected: sseConnected } = useRealtimeEvents()

  // Version info
  const { data: versionInfo } = useQuery({ queryKey: ['version-info'], queryFn: getVersionInfo, staleTime: 60_000, refetchInterval: 60_000 })
  const { data: updateCheck } = useQuery({ queryKey: ['update-check'], queryFn: checkForUpdates, staleTime: 3600_000, refetchInterval: 3600_000 })

  // Live data for sidebar
  const { data: alerts } = useQuery({ queryKey: ['alerts-sidebar'], queryFn: () => getAlerts(50), refetchInterval: 30_000 })
  const { data: vehicles } = useQuery({ queryKey: ['vehicles-sidebar'], queryFn: getVehicles, refetchInterval: 60_000 })
  const primaryVehicle = vehicles?.[0]
  const { data: primaryState } = useQuery({
    queryKey: ['primary-state-sidebar', primaryVehicle?.id],
    queryFn: () => getVehicleState(primaryVehicle!.id),
    enabled: !!primaryVehicle,
    refetchInterval: 60_000,
  })
  const unreadAlerts = alerts?.filter(a => !a.read).length ?? 0
  const onlineVehicles = vehicles?.filter(v => v.state === 'online').length ?? 0
  const isConnected = !!primaryState?.live

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
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}>
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
            className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        role="navigation"
        aria-label="Main navigation"
        className={clsx(
          'fixed inset-y-0 left-0 z-30 w-[clamp(240px,70vw,256px)] transform transition-transform duration-300 ease-out lg:static lg:w-64 lg:translate-x-0',
          'border-r backdrop-blur-xl flex flex-col',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ borderColor: 'var(--glass-border)', background: 'var(--surface-1)', maxHeight: '100dvh' }}
      >
        {/* Logo */}
        <NavLink to="/" className="flex items-center gap-3 px-5 py-5 border-b shrink-0 hover:bg-white/[0.02] transition-colors" style={{ borderColor: 'var(--glass-border)' }} onClick={() => setSidebarOpen(false)}>
          <Logo size={32} showWordmark />
          <span className="ml-auto rounded-md bg-neon-cyan/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neon-cyan">
            {versionInfo?.chart_version && versionInfo.chart_version !== 'unknown' ? `v${versionInfo.chart_version}` : ''}
          </span>
        </NavLink>

        {/* Navigation */}
        <nav 
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-4 px-3 space-y-6 scrollbar-thin"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehaviorY: 'contain' }}
        >          {/* Search trigger */}
          <div className="px-1 mb-2">
            <CommandPaletteTrigger />
          </div>

          {navSections.map(section => (
            <div key={section.title}>
              <p className="mb-2 px-4 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)]">
                {section.title}
              </p>
              <div className="space-y-0.5">
                {section.items.map(({ to, icon: Icon, label, color }) => {
                  const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      onClick={() => setSidebarOpen(false)}
                      aria-label={label}
                      aria-current={isActive ? 'page' : undefined}
                      className="group relative flex items-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200"
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
                        {navI18nKeys[label] ? t(navI18nKeys[label]) : label}
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
        <div className="border-t px-4 py-3 space-y-2 shrink-0 safe-bottom" style={{ borderColor: 'var(--glass-border)' }}>
          {/* Update available banner */}
          {updateCheck?.update_available && (
            <div className="glass-card !p-2.5 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <Download className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-amber-300">Update available</p>
                <p className="text-[10px] text-amber-400/70">v{updateCheck.latest}</p>
              </div>
            </div>
          )}
          {/* Live vehicle mini-status */}
          {primaryVehicle && primaryState?.state && (
            <div className="glass-card !p-2.5 flex items-center gap-2.5">
              <div className={clsx('h-2 w-2 rounded-full', primaryState.state.battery_level > 20 ? 'bg-neon-green' : 'bg-neon-red')}
                style={{ boxShadow: `0 0 6px ${primaryState.state.battery_level > 20 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)'}` }} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[var(--text-secondary)] truncate">{primaryVehicle.display_name || 'Vehicle'}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{primaryState.state.battery_level}% · {Math.round(primaryState.state.rated_range)} km</p>
              </div>
              <Zap className="h-3 w-3 text-neon-cyan/50" />
            </div>
          )}
          <div className="glass-card flex items-center gap-3 !p-2.5">
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
            <SSEStatusDot connected={sseConnected} />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-4 border-b backdrop-blur-xl px-3 py-2.5 sm:px-5 sm:py-3 lg:hidden safe-top" style={{ borderColor: 'var(--glass-border)', background: 'var(--surface-1)' }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            aria-expanded={sidebarOpen}
            className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-[var(--text-primary)] transition-colors"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Logo size={24} showWordmark />
        </header>

        <ServiceStatusBanner />
        <main id="main-content" ref={mainRef} role="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
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

      {/* Command Palette */}
      <CommandPalette />

      {/* Onboarding Wizard */}
      <OnboardingWizard />
    </div>
  )
}
