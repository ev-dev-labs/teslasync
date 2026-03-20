import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
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
  ChevronUp,
  History,
  Keyboard,
} from 'lucide-react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import clsx from 'clsx'
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette'
import { ServiceStatusBanner, SystemHealthDot } from './ServiceStatus'
import { Breadcrumb } from './Breadcrumb'
import Logo from './Logo'
import { getAlerts, getVehicles, getVehicleState } from '../api'

const RECENT_PAGES_KEY = 'teslasync-recent-pages'
const MAX_RECENT = 5

interface RecentPage {
  path: string
  label: string
}

const pathLabels: Record<string, string> = {
  '/': 'Dashboard', '/live': 'Live Map', '/vehicles': 'Vehicles',
  '/drives': 'Drives', '/charging': 'Charging', '/analytics': 'Analytics',
  '/energy': 'Energy', '/battery': 'Battery Health', '/settings': 'Settings',
  '/commands': 'Commands', '/alerts': 'Alerts', '/geofences': 'Geofences',
  '/notifications': 'Notifications', '/chatbot': 'Chatbot',
  '/tire-pressure': 'Tire Pressure', '/software-updates': 'Software Updates',
  '/vampire-drain': 'Vampire Drain', '/locations': 'Locations',
  '/timeline': 'Timeline', '/mileage': 'Mileage',
  '/projected-range': 'Projected Range', '/efficiency': 'Efficiency',
  '/trips': 'Trips', '/statistics': 'Statistics',
  '/system-status': 'System Status', '/roadmap': 'Roadmap',
}

const navigationShortcuts: Record<string, string> = {
  'd': '/',
  'l': '/live',
  'v': '/vehicles',
  'c': '/charging',
  'a': '/analytics',
  's': '/settings',
  'g': '/geofences',
  'e': '/energy',
  'n': '/notifications',
}

const shortcutDescriptions: [string, string][] = [
  ['Ctrl/⌘ + K', 'Command Palette'],
  ['D', 'Dashboard'],
  ['L', 'Live Map'],
  ['V', 'Vehicles'],
  ['C', 'Charging'],
  ['A', 'Analytics'],
  ['S', 'Settings'],
  ['G', 'Geofences'],
  ['E', 'Energy'],
  ['N', 'Notifications'],
  ['?', 'Keyboard Shortcuts'],
]

const navSections = [
  {
    title: 'Overview',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', color: 'text-blue-400' },
      { to: '/live', icon: Radar, label: 'Live Map', color: 'text-emerald-400' },
      { to: '/vehicles', icon: Car, label: 'Fleet', color: 'text-sky-400' },
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
      { to: '/settings', icon: Settings, label: 'Settings', color: 'text-gray-400' },
    ],
  },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const [recentPages, setRecentPages] = useState<RecentPage[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_PAGES_KEY) || '[]') }
    catch { return [] }
  })
  const location = useLocation()
  const navigate = useNavigate()
  const mainRef = useRef<HTMLElement>(null)
  const [now, setNow] = useState(Date.now())

  // Live data for sidebar
  const { data: alerts } = useQuery({ queryKey: ['alerts-sidebar'], queryFn: () => getAlerts(50), refetchInterval: 30_000 })
  const { data: vehicles } = useQuery({ queryKey: ['vehicles-sidebar'], queryFn: getVehicles, refetchInterval: 60_000 })
  const primaryVehicle = vehicles?.[0]
  const { data: primaryState } = useQuery({
    queryKey: ['primary-state-sidebar', primaryVehicle?.id],
    queryFn: () => getVehicleState(primaryVehicle!.id),
    enabled: !!primaryVehicle,
    refetchInterval: 15_000,
  })
  const unreadAlerts = alerts?.filter(a => !a.read).length ?? 0
  const onlineVehicles = vehicles?.filter(v => v.state === 'online').length ?? 0
  const isConnected = !!primaryState?.live

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Feature 1 & 10: Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === '?') {
        e.preventDefault()
        setShowShortcutHelp(prev => !prev)
        return
      }

      const path = navigationShortcuts[e.key.toLowerCase()]
      if (path) {
        e.preventDefault()
        navigate(path)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  // Feature 4: Track recent pages
  useEffect(() => {
    const label = pathLabels[location.pathname]
    if (!label) return
    setRecentPages(prev => {
      const filtered = prev.filter(p => p.path !== location.pathname)
      const next = [{ path: location.pathname, label }, ...filtered].slice(0, MAX_RECENT)
      localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(next))
      return next
    })
  }, [location.pathname])

  // Feature 12: Scroll-to-top visibility
  const handleScroll = useCallback(() => {
    if (mainRef.current) {
      setShowScrollTop(mainRef.current.scrollTop > 300)
    }
  }, [])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const scrollToTop = useCallback(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const uptimeStr = (() => {
    const d = Math.floor((now - (Date.parse('2024-01-01') || now)) / 86400000)
    return d > 0 ? `${d}d uptime` : 'Online'
  })()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}>
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
        className={clsx(
          'fixed inset-y-0 left-0 z-30 w-[clamp(240px,70vw,256px)] transform transition-transform duration-300 ease-out lg:static lg:w-64 lg:translate-x-0',
          'border-r backdrop-blur-xl',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        style={{ borderColor: 'var(--glass-border)', background: 'var(--surface-1)' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b" style={{ borderColor: 'var(--glass-border)' }}>
          <Logo size={32} showWordmark />
          <span className="ml-auto rounded-md bg-neon-cyan/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neon-cyan">v2</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6 scrollbar-thin">
          {/* Search trigger */}
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
                        {label}
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

          {/* Feature 4: Recent Pages */}
          {recentPages.length > 1 && (
            <div>
              <p className="mb-2 px-4 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] flex items-center gap-1.5">
                <History className="h-3 w-3" /> Recent
              </p>
              <div className="space-y-0.5">
                {recentPages.slice(1).map(({ path, label }) => (
                  <NavLink key={path} to={path} onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-4 py-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Bottom status */}
        <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: 'var(--glass-border)' }}>
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
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center gap-4 border-b backdrop-blur-xl px-3 py-2.5 sm:px-5 sm:py-3 lg:hidden safe-top" style={{ borderColor: 'var(--glass-border)', background: 'var(--surface-1)' }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-white/[0.05] hover:text-[var(--text-primary)] transition-colors"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Logo size={24} showWordmark />
        </header>

        <ServiceStatusBanner />
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1600px] px-3 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-8">
            <Breadcrumb />
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

      {/* Feature 12: Scroll-to-top button */}
      <AnimatePresence>
        {showScrollTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToTop}
            className="fixed bottom-6 right-6 z-40 rounded-full p-3 shadow-lg transition-colors"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}
            title="Scroll to top"
          >
            <ChevronUp className="h-5 w-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Feature 10: Keyboard Shortcut Help Modal */}
      <AnimatePresence>
        {showShortcutHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setShowShortcutHelp(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="glass-panel w-full max-w-md mx-4 p-6"
              style={{ background: 'var(--surface-1)', border: '1px solid var(--glass-border)' }}
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Keyboard className="h-5 w-5" style={{ color: 'var(--theme-primary)' }} />
                  <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Keyboard Shortcuts</h2>
                </div>
                <button onClick={() => setShowShortcutHelp(false)} className="rounded-lg p-1 hover:bg-white/[0.06] transition-colors">
                  <X className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {shortcutDescriptions.map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between gap-2 py-1">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                    <kbd className="rounded px-1.5 py-0.5 text-[10px] font-mono"
                      style={{ background: 'var(--surface-3)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)' }}>
                      {key}
                    </kbd>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
                Press <kbd className="rounded px-1 py-0.5 font-mono" style={{ background: 'var(--surface-3)', border: '1px solid var(--glass-border)' }}>?</kbd> or <kbd className="rounded px-1 py-0.5 font-mono" style={{ background: 'var(--surface-3)', border: '1px solid var(--glass-border)' }}>Esc</kbd> to close
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
