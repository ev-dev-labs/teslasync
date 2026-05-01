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
  X,
  User,
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
  RadioTower,
  SlidersHorizontal,
  Award,
  Bug,
  HardDrive,
  Split,
  Radio,
  Signpost,
  Hammer,
  Receipt,
  Key,
  Home,
  Server,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  Star,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { useTour, isTourCompleted } from '@/hooks/useTour'
import { GotoIndicator } from '../feedback/GotoIndicator'
import { KeyboardShortcutsModal } from '../feedback/KeyboardShortcutsModal'
import { TourOverlay } from '../feedback/TourOverlay'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { BottomTabBar, BOTTOM_TAB_PATHS } from './BottomTabBar'
import { CommandPalette, CommandPaletteTrigger } from '../ui/CommandPalette'
import { ServiceStatusBanner, SystemHealthDot } from '../data-display/ServiceStatus'
import { LiveIndicator } from '../data-display/LiveIndicator'
import Logo from '../ui/Logo'
import { Button } from '@/components/ui'
import { Breadcrumbs } from './Breadcrumbs'
import { VehiclePicker } from './VehiclePicker'

import { MAIN_TOUR_STEPS } from '@/features/onboarding/tourSteps'
import { request } from '@/api/client'
import { getVehicleState } from '@/api/vehicles'
import type { Alert, Vehicle, VersionInfo, UpdateCheckResult, StaleSessionsResponse } from '@/api/types'
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents'
import { useNotificationListener } from '../../hooks/useNotificationListener'
import { useToast } from '../feedback/Toast'
import { useSettings } from '../../hooks/useSettings'
import { useUnreadCount } from '@/api/hooks/useNotifications'
import { GlassPanel } from '../ui/GlassPanel'
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough'

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
  'Redis Signals': 'nav.redisSignals',
}

export const navSearchKeywords: Record<string, string[]> = {
  '/': ['home', 'overview', 'start', 'summary'],
  '/live': ['map', 'location', 'tracking', 'realtime', 'vehicle position'],
  '/vehicles': ['cars', 'fleet', 'garage', 'vehicle list'],
  '/compare': ['comparison', 'vehicles', 'side by side'],
  '/weekly-digest': ['digest', 'weekly', 'summary', 'report'],
  '/navigation': ['route', 'directions', 'map', 'nav'],
  '/drives': ['drive history', 'sessions', 'trips'],
  '/trips': ['trip history', 'journeys', 'routes'],
  '/trip-planner': ['plan trip', 'route planner', 'range planning'],
  '/drive-score': ['score', 'driving score', 'safe driving'],
  '/speed-profile': ['speed', 'profile', 'velocity'],
  '/driving-dynamics': ['dynamics', 'handling', 'performance', 'acceleration'],
  '/regen-efficiency': ['regen', 'regenerative', 'braking', 'recovery'],
  '/battery': ['battery', 'health', 'range', 'capacity', 'soh'],
  '/battery-cells': ['cells', 'cell voltage', 'battery module'],
  '/battery-degradation': ['degradation', 'battery loss', 'range loss', 'aging'],
  '/charging': ['charge', 'charging sessions', 'plug', 'charger'],
  '/tesla-charging-history': ['supercharger', 'tesla charging', 'charge cost', 'invoice', 'receipt'],
  '/charging-heatmap': ['charging patterns', 'heatmap', 'schedule', 'when charging'],
  '/charging-curve': ['curve', 'charging speed', 'kw', 'power curve'],
  '/smart-charge': ['smart charging', 'schedule', 'automation'],
  '/powershare': ['power share', 'home backup', 'v2h'],
  '/energy': ['energy usage', 'consumption', 'kwh'],
  '/energy-flow': ['flow', 'energy graph', 'power path'],
  '/power-flow': ['power', 'flow', 'dashboard'],
  '/energy-products': ['powerwall', 'solar', 'home energy'],
  '/efficiency': ['efficiency', 'wh per mile', 'consumption'],
  '/route-efficiency': ['route', 'efficiency', 'trip energy'],
  '/projected-range': ['range', 'forecast', 'projection'],
  '/mileage': ['odometer', 'miles', 'distance'],
  '/temperature-impact': ['temperature', 'weather', 'climate impact'],
  '/cost-analysis': ['cost', 'money', 'expense', 'savings'],
  '/tco': ['ownership', 'total cost', 'tco'],
  '/digital-twin': ['digital twin', 'vehicle state', 'doors', 'windows', 'lights'],
  '/tire-pressure': ['tires', 'tpms', 'pressure'],
  '/climate-control': ['climate', 'temperature', 'hvac', 'ac', 'heat'],
  '/drivetrain-health': ['motor', 'drive unit', 'health'],
  '/vampire-drain': ['vampire', 'phantom drain', 'idle drain'],
  '/sleep-efficiency': ['sleep', 'standby', 'idle'],
  '/software-updates': ['software', 'firmware', 'ota'],
  '/maintenance': ['service', 'maintenance', 'repairs'],
  '/analytics': ['analytics', 'insights', 'charts'],
  '/statistics': ['stats', 'numbers', 'metrics'],
  '/lifetime-stats': ['lifetime', 'all time', 'totals'],
  '/vehicle-comparison': ['compare vehicles', 'fleet comparison'],
  '/timeline': ['timeline', 'events', 'history'],
  '/locations': ['places', 'locations', 'visited'],
  '/commands': ['commands', 'control', 'remote'],
  '/command-history': ['command log', 'remote history'],
  '/automations': ['automation', 'rules', 'workflows'],
  '/alerts': ['alerts', 'warnings', 'notifications'],
  '/alert-studio': ['alert rules', 'studio', 'conditions'],
  '/geofences': ['geofence', 'zones', 'places'],
  '/notifications': ['notifications', 'messages'],
  '/guard-mode': ['guard', 'sentry', 'security'],
  '/chatbot': ['ai', 'assistant', 'chat'],
  '/media-player': ['media', 'music', 'player'],
  '/tesla-account': ['account', 'tesla login', 'oauth'],
  '/system-status': ['system', 'status', 'health'],
  '/api-logs': ['api logs', 'requests', 'debug'],
  '/fleet-api': ['fleet api', 'tesla api'],
  '/settings': ['settings', 'preferences', 'configuration'],
  '/api-keys': ['keys', 'tokens', 'api key'],
  '/admin': ['admin', 'administration'],
  '/data-export': ['export', 'download', 'csv'],
  '/backup': ['backup', 'restore'],
  '/data-repair': ['repair', 'data repair', 'fix sessions'],
  '/dev-tools': ['developer', 'tools', 'debug'],
  '/api-playground': ['playground', 'api test'],
  '/roadmap': ['roadmap', 'plans'],
  '/changelog': ['changes', 'release notes'],
  '/live-monitor': ['live signals', 'monitor', 'telemetry'],
  '/signal-log': ['signals', 'signal log', 'telemetry log'],
  '/signal-explorer': ['explore signals', 'signal explorer'],
  '/signal-diff': ['diff', 'signal compare'],
  '/signal-gaps': ['gaps', 'missing signals'],
  '/state-debugger': ['state machine', 'debugger', 'fsm'],
  '/mqtt-inspector': ['mqtt', 'broker', 'telemetry stream'],
  '/redis-signals': ['redis', 'cache', 'signals'],
  '/db-health': ['database', 'db', 'postgres'],
  '/anomaly-detection': ['anomaly', 'outliers', 'diagnostics'],
}

const DEFAULT_PINNED_NAV_PATHS = ['/', '/digital-twin', '/vehicles', '/charging', '/live']
const MAX_PINNED_NAV_ITEMS = 8
const MAX_RECENT_NAV_ITEMS = 3
const EXPANDED_NAV_STORAGE_KEY = 'teslasync-expanded-nav-sections'
const RECENT_NAV_STORAGE_KEY = 'teslasync-recent-nav-paths'
const PINNED_NAV_STORAGE_KEY = 'teslasync-pinned-nav-paths'

const SECTION_ICON_STYLES: Record<string, { accent: string; surface: string; ring: string; dot: string }> = {
  Overview: { accent: 'text-sky-300', surface: 'bg-sky-400/10', ring: 'ring-sky-400/20', dot: 'bg-sky-400' },
  Fleet: { accent: 'text-cyan-300', surface: 'bg-cyan-400/10', ring: 'ring-cyan-400/20', dot: 'bg-cyan-400' },
  Driving: { accent: 'text-violet-300', surface: 'bg-violet-400/10', ring: 'ring-violet-400/20', dot: 'bg-violet-400' },
  'Driving Insights': { accent: 'text-purple-300', surface: 'bg-purple-400/10', ring: 'ring-purple-400/20', dot: 'bg-purple-400' },
  Charging: { accent: 'text-emerald-300', surface: 'bg-emerald-400/10', ring: 'ring-emerald-400/20', dot: 'bg-emerald-400' },
  Battery: { accent: 'text-rose-300', surface: 'bg-rose-400/10', ring: 'ring-rose-400/20', dot: 'bg-rose-400' },
  Energy: { accent: 'text-amber-300', surface: 'bg-amber-400/10', ring: 'ring-amber-400/20', dot: 'bg-amber-400' },
  Efficiency: { accent: 'text-lime-300', surface: 'bg-lime-400/10', ring: 'ring-lime-400/20', dot: 'bg-lime-400' },
  Costs: { accent: 'text-green-300', surface: 'bg-green-400/10', ring: 'ring-green-400/20', dot: 'bg-green-400' },
  'Vehicle State': { accent: 'text-teal-300', surface: 'bg-teal-400/10', ring: 'ring-teal-400/20', dot: 'bg-teal-400' },
  'Health & Service': { accent: 'text-red-300', surface: 'bg-red-400/10', ring: 'ring-red-400/20', dot: 'bg-red-400' },
  Analytics: { accent: 'text-indigo-300', surface: 'bg-indigo-400/10', ring: 'ring-indigo-400/20', dot: 'bg-indigo-400' },
  Controls: { accent: 'text-fuchsia-300', surface: 'bg-fuchsia-400/10', ring: 'ring-fuchsia-400/20', dot: 'bg-fuchsia-400' },
  'Automations & Alerts': { accent: 'text-orange-300', surface: 'bg-orange-400/10', ring: 'ring-orange-400/20', dot: 'bg-orange-400' },
  'Security & Safety': { accent: 'text-yellow-300', surface: 'bg-yellow-400/10', ring: 'ring-yellow-400/20', dot: 'bg-yellow-400' },
  'Assistant & Media': { accent: 'text-pink-300', surface: 'bg-pink-400/10', ring: 'ring-pink-400/20', dot: 'bg-pink-400' },
  'Account & Integration': { accent: 'text-blue-300', surface: 'bg-blue-400/10', ring: 'ring-blue-400/20', dot: 'bg-blue-400' },
  'Settings & Admin': { accent: 'text-slate-300', surface: 'bg-slate-400/10', ring: 'ring-slate-400/20', dot: 'bg-slate-400' },
  'Data Management': { accent: 'text-teal-300', surface: 'bg-teal-400/10', ring: 'ring-teal-400/20', dot: 'bg-teal-400' },
  'Signal Diagnostics': { accent: 'text-neon-cyan', surface: 'bg-cyan-400/10', ring: 'ring-cyan-400/20', dot: 'bg-neon-cyan' },
  Infrastructure: { accent: 'text-emerald-300', surface: 'bg-emerald-400/10', ring: 'ring-emerald-400/20', dot: 'bg-emerald-400' },
  Developer: { accent: 'text-orange-300', surface: 'bg-orange-400/10', ring: 'ring-orange-400/20', dot: 'bg-orange-400' },
  'Project Info': { accent: 'text-white/60', surface: 'bg-white/5', ring: 'ring-white/10', dot: 'bg-white/40' },
}

// NOTE: The legacy `SSEStatusDot` component lived here and rendered a bare
// colored dot tied to the SSE wire state. It was replaced by the shared
// `<LiveIndicator variant="dot">` (see import above) so the sidebar status
// dot, page-level badges, and stale-data banner all derive from a single
// `useLiveConnection` source of truth.

export const navSections = [
  {
    title: 'Overview',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', color: 'text-blue-400' },
      { to: '/live', icon: Radar, label: 'Live Map', color: 'text-emerald-400' },
      { to: '/weekly-digest', icon: CalendarCheck, label: 'Weekly Digest', color: 'text-purple-400' },
      { to: '/timeline', icon: Clock, label: 'Timeline', color: 'text-sky-400' },
    ],
  },
  {
    title: 'Fleet',
    items: [
      { to: '/vehicles', icon: Car, label: 'Fleet', color: 'text-sky-400', dataTour: 'vehicle-section' },
      { to: '/compare', icon: GitCompare, label: 'Compare', color: 'text-orange-400' },
      { to: '/vehicle-comparison', icon: ArrowLeftRight, label: 'Vehicle Comparison', color: 'text-orange-400', minVehicles: 2 },
      { to: '/locations', icon: MapPin, label: 'Locations', color: 'text-emerald-400' },
      { to: '/navigation', icon: Signpost, label: 'Navigation', color: 'text-teal-400' },
    ],
  },
  {
    title: 'Driving',
    items: [
      { to: '/drives', icon: Route, label: 'Drives', color: 'text-violet-400' },
      { to: '/trips', icon: Milestone, label: 'Trips', color: 'text-teal-400' },
      { to: '/trip-planner', icon: MapPinned, label: 'Trip Planner', color: 'text-emerald-400' },
      { to: '/mileage', icon: Milestone, label: 'Mileage', color: 'text-teal-400' },
      { to: '/lifetime-stats', icon: Award, label: 'Lifetime Stats', color: 'text-yellow-400' },
    ],
  },
  {
    title: 'Driving Insights',
    items: [
      { to: '/drive-score', icon: Trophy, label: 'Drive Score', color: 'text-yellow-400' },
      { to: '/speed-profile', icon: Gauge, label: 'Speed Profile', color: 'text-rose-400' },
      { to: '/driving-dynamics', icon: Activity, label: 'Driving Dynamics', color: 'text-red-400' },
      { to: '/regen-efficiency', icon: Recycle, label: 'Regen Braking', color: 'text-green-400' },
    ],
  },
  {
    title: 'Charging',
    items: [
      { to: '/charging', icon: BatteryCharging, label: 'Charging', color: 'text-green-400' },
      { to: '/tesla-charging-history', icon: Receipt, label: 'Tesla Charge History', color: 'text-emerald-400' },
      { to: '/charging-heatmap', icon: CalendarClock, label: 'Charging Patterns', color: 'text-cyan-400' },
      { to: '/charging-curve', icon: TrendingUp, label: 'Charging Curve', color: 'text-lime-400' },
      { to: '/smart-charge', icon: CalendarClock, label: 'Smart Charge', color: 'text-cyan-400' },
      { to: '/powershare', icon: Zap, label: 'Powershare', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Battery',
    items: [
      { to: '/battery', icon: HeartPulse, label: 'Battery Health', color: 'text-rose-400' },
      { to: '/battery-cells', icon: Battery, label: 'Battery Cells', color: 'text-purple-400' },
      { to: '/battery-degradation', icon: TrendingDown, label: 'Degradation', color: 'text-orange-400' },
    ],
  },
  {
    title: 'Energy',
    items: [
      { to: '/energy', icon: Bolt, label: 'Energy', color: 'text-yellow-400' },
      { to: '/energy-flow', icon: ArrowRightLeft, label: 'Energy Flow', color: 'text-yellow-400' },
      { to: '/power-flow', icon: Zap, label: 'Power Flow', color: 'text-orange-400' },
      { to: '/energy-products', icon: Home, label: 'Energy Products', color: 'text-lime-400' },
      { to: '/projected-range', icon: Target, label: 'Projected Range', color: 'text-pink-400' },
    ],
  },
  {
    title: 'Efficiency',
    items: [
      { to: '/efficiency', icon: Leaf, label: 'Efficiency', color: 'text-amber-400' },
      { to: '/route-efficiency', icon: Navigation2, label: 'Route Efficiency', color: 'text-emerald-400' },
      { to: '/temperature-impact', icon: ThermometerSun, label: 'Temperature Impact', color: 'text-blue-400' },
      { to: '/vampire-drain', icon: Moon, label: 'Vampire Drain', color: 'text-indigo-400' },
      { to: '/sleep-efficiency', icon: BedDouble, label: 'Sleep Efficiency', color: 'text-purple-400' },
    ],
  },
  {
    title: 'Costs',
    items: [
      { to: '/cost-analysis', icon: DollarSign, label: 'Cost Analysis', color: 'text-emerald-400' },
      { to: '/tco', icon: Wallet, label: 'Cost of Ownership', color: 'text-green-400' },
    ],
  },
  {
    title: 'Vehicle State',
    items: [
      { to: '/digital-twin', icon: Monitor, label: 'Digital Twin', color: 'text-cyan-400' },
      { to: '/tire-pressure', icon: CircleDot, label: 'Tire Pressure', color: 'text-orange-400' },
      { to: '/climate-control', icon: Thermometer, label: 'Climate Control', color: 'text-sky-400' },
    ],
  },
  {
    title: 'Health & Service',
    items: [
      { to: '/drivetrain-health', icon: Cpu, label: 'Drivetrain Health', color: 'text-red-400' },
      { to: '/software-updates', icon: Download, label: 'Software Updates', color: 'text-teal-400' },
      { to: '/maintenance', icon: Wrench, label: 'Maintenance', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Analytics',
    items: [
      { to: '/analytics', icon: BarChart3, label: 'Analytics', color: 'text-indigo-400' },
      { to: '/statistics', icon: PieChart, label: 'Statistics', color: 'text-cyan-400' },
    ],
  },
  {
    title: 'Controls',
    items: [
      { to: '/commands', icon: Gamepad2, label: 'Commands', color: 'text-fuchsia-400', dataTour: 'commands-section' },
      { to: '/command-history', icon: History, label: 'Command History', color: 'text-violet-400' },
    ],
  },
  {
    title: 'Automations & Alerts',
    items: [
      { to: '/automations', icon: Workflow, label: 'Automations', color: 'text-neon-cyan' },
      { to: '/alerts', icon: Bell, label: 'Alerts', color: 'text-red-400' },
      { to: '/alert-studio', icon: BellPlus, label: 'Alert Studio', color: 'text-neon-cyan' },
      { to: '/geofences', icon: Fence, label: 'Geofences', color: 'text-lime-400' },
      { to: '/notifications', icon: BellRing, label: 'Notifications', color: 'text-purple-400' },
    ],
  },
  {
    title: 'Security & Safety',
    items: [
      { to: '/security-access', icon: Lock, label: 'Security & Access', color: 'text-emerald-400' },
      { to: '/safety-settings', icon: ShieldCheck, label: 'Safety Settings', color: 'text-amber-400' },
      { to: '/guard-mode', icon: ShieldAlert, label: 'Guard Mode', color: 'text-red-400' },
    ],
  },
  {
    title: 'Assistant & Media',
    items: [
      { to: '/chatbot', icon: Bot, label: 'Chatbot', color: 'text-cyan-400' },
      { to: '/media-player', icon: Headphones, label: 'Media Player', color: 'text-pink-400' },
    ],
  },
  {
    title: 'Account & Integration',
    items: [
      { to: '/tesla-account', icon: User, label: 'Tesla Account', color: 'text-blue-400' },
      { to: '/fleet-api', icon: Cloud, label: 'Fleet API', color: 'text-sky-400' },
      { to: '/api-logs', icon: FileText, label: 'API Logs', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Settings & Admin',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings', color: 'text-[var(--text-muted)]' },
      { to: '/admin', icon: KeyRound, label: 'Admin', color: 'text-red-400' },
      { to: '/api-keys', icon: Key, label: 'API Keys', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Data Management',
    items: [
      { to: '/data-export', icon: HardDriveDownload, label: 'Data Export', color: 'text-lime-400' },
      { to: '/backup', icon: DatabaseBackup, label: 'Backup & Restore', color: 'text-teal-400' },
      { to: '/data-repair', icon: Stethoscope, label: 'Data Repair', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Signal Diagnostics',
    items: [
      { to: '/live-monitor', icon: RadioTower, label: 'Live Monitor', color: 'text-neon-green', dataTour: 'live-signals-section' },
      { to: '/signal-log', icon: Database, label: 'Signal Log', color: 'text-cyan-400' },
      { to: '/signal-explorer', icon: SlidersHorizontal, label: 'Signal Explorer', color: 'text-neon-cyan' },
      { to: '/signal-diff', icon: Split, label: 'Signal Diff', color: 'text-violet-400' },
      { to: '/signal-gaps', icon: Wifi, label: 'Gap Detector', color: 'text-amber-400' },
      { to: '/state-debugger', icon: Bug, label: 'State Machine', color: 'text-purple-400' },
      { to: '/mqtt-inspector', icon: Radio, label: 'MQTT Inspector', color: 'text-blue-400' },
      { to: '/redis-signals', icon: Server, label: 'Redis Signals', color: 'text-orange-400' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { to: '/system-status', icon: Activity, label: 'Status', color: 'text-emerald-400' },
      { to: '/db-health', icon: HardDrive, label: 'DB Health', color: 'text-emerald-400' },
      { to: '/anomaly-detection', icon: ScanSearch, label: 'Anomaly Detection', color: 'text-red-400' },
    ],
  },
  {
    title: 'Developer',
    items: [
      { to: '/dev-tools', icon: Hammer, label: 'Dev Tools', color: 'text-cyan-400' },
      { to: '/api-playground', icon: Terminal, label: 'API Playground', color: 'text-emerald-400' },
    ],
  },
  {
    title: 'Project Info',
    items: [
      { to: '/roadmap', icon: Signpost, label: 'Roadmap', color: 'text-violet-400' },
      { to: '/changelog', icon: FileText, label: 'Changelog', color: 'text-white/50' },
    ],
  },
]

type NavSection = (typeof navSections)[number]
type NavItem = NavSection['items'][number]

function isVisibleNavItem(item: NavItem, vehicleCount: number) {
  return !('minVehicles' in item) || vehicleCount >= (item as { minVehicles?: number }).minVehicles!
}

function isActiveNavPath(pathname: string, to: string) {
  return to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(to + '/')
}

function findNavItemByPath(pathname: string) {
  for (const section of navSections) {
    const item = section.items.find(candidate => isActiveNavPath(pathname, candidate.to))
    if (item) return { section, item }
  }
  return null
}

function findNavItemByExactPath(to: string) {
  for (const section of navSections) {
    const item = section.items.find(candidate => candidate.to === to)
    if (item) return { section, item }
  }
  return null
}

/**
 * Tiny header link that renders the bell icon and an unread-count badge.
 * Polls `/notifications/unread-count` via TanStack Query every 30s. Used in
 * both the desktop sidebar header and the mobile top bar.
 */
function NotificationBell({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { data: count = 0 } = useUnreadCount()
  const display = count > 99 ? '99+' : String(count)
  const label = count > 0
    ? t('nav.notificationsUnread', '{{count}} unread notifications', { count })
    : t('nav.notifications', 'Notifications')
  return (
    <NavLink
      to="/notifications"
      aria-label={label}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${className ?? ''}`}
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 -right-0.5 inline-flex min-w-[1rem] h-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow ring-1 ring-rose-300/60"
        >
          {display}
        </span>
      )}
    </NavLink>
  )
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem(EXPANDED_NAV_STORAGE_KEY)
      const parsed = stored ? JSON.parse(stored) as string[] : []
      return new Set(parsed.length > 0 ? parsed : ['Overview'])
    } catch {
      return new Set(['Overview'])
    }
  })
  const [recentNavPaths, setRecentNavPaths] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem(RECENT_NAV_STORAGE_KEY)
      const parsed = stored ? JSON.parse(stored) as string[] : []
      return parsed.slice(0, MAX_RECENT_NAV_ITEMS)
    } catch {
      return []
    }
  })
  const [pinnedNavPaths, setPinnedNavPaths] = useState<string[]>(() => {
    try {
      const stored = window.localStorage.getItem(PINNED_NAV_STORAGE_KEY)
      const parsed = stored ? JSON.parse(stored) as string[] : []
      return (stored ? parsed : DEFAULT_PINNED_NAV_PATHS).slice(0, MAX_PINNED_NAV_ITEMS)
    } catch {
      return DEFAULT_PINNED_NAV_PATHS
    }
  })
  const location = useLocation()
  const { t } = useTranslation()

  // SSE alert toasts. Live-pipe health is rendered by `<LiveIndicator>`
  // via `useLiveConnection`; here we only need the alert callback.
  const toast = useToast()
  useRealtimeEvents({
    onAlert: (data) => {
      const alert = data as Partial<Alert>
      const severity = alert.severity ?? 'info'
      // Build a drill-through link if we have enough metadata to deep-link.
      // Falls back to /signal-explorer when only a timestamp is known.
      const href = (alert.created_at || alert.rule_signal || alert.vehicle_id)
        ? getAlertDrillthroughHref({
            id: alert.id ?? 0,
            vehicle_id: alert.vehicle_id ?? 0,
            type: alert.type ?? 'notification',
            severity: alert.severity ?? 'info',
            title: alert.title ?? '',
            message: alert.message ?? '',
            is_read: false,
            created_at: alert.created_at ?? new Date().toISOString(),
            rule_id: alert.rule_id ?? null,
            rule_signal: alert.rule_signal ?? null,
            rule_severity: alert.rule_severity ?? null,
          })
        : null
      const title = alert.title ?? t('alerts.toast.title', 'Alert')
      const message = alert.message ?? ''
      const toastType: 'error' | 'warning' | 'info' =
        severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info'
      if (href) {
        toast.toast({
          type: toastType,
          title,
          message,
          action: { label: t('alerts.toast.view', 'View'), to: href },
        })
      } else {
        const method = toastType === 'error' ? toast.error : toastType === 'warning' ? toast.warning : toast.info
        method(title, message)
      }
    },
  })
  useNotificationListener()
  const { convertDistance, distanceUnit } = useSettings()
  const { mode: shortcutMode, showCheatSheet, toggleCheatSheet } = useKeyboardShortcuts()

  // The CommandPalette's "Show keyboard shortcuts" command (and any other
  // caller) toggles the cheat sheet by dispatching this custom event so the
  // shortcut layer stays decoupled from the React tree.
  useEffect(() => {
    const handler = () => toggleCheatSheet()
    window.addEventListener('toggle-keyboard-shortcuts', handler)
    return () => window.removeEventListener('toggle-keyboard-shortcuts', handler)
  }, [toggleCheatSheet])

  // Onboarding tour
  const tour = useTour(MAIN_TOUR_STEPS)
  useEffect(() => {
    if (!isTourCompleted()) {
      const timer = setTimeout(() => tour.start(), 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  // Auto-skip tour steps whose target element is missing (e.g. sidebar items on mobile)
  useEffect(() => {
    if (tour.isActive && tour.step && !tour.targetRect) {
      const timer = setTimeout(() => tour.next(), 400)
      return () => clearTimeout(timer)
    }
  }, [tour.isActive, tour.currentStep, tour.targetRect])

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
  const vehicleCount = vehicles?.length ?? 0
  const onlineVehicles = vehicles?.filter(v => v.state === 'online').length ?? 0
  const isConnected = !!primaryState?.live

  // Stale sessions count for Data Repair badge
  const { data: staleSessions } = useQuery({ queryKey: ['stale-sessions-sidebar'], queryFn: () => request<StaleSessionsResponse>('/data-repair/stale-sessions'), refetchInterval: 60_000, retry: 1 })
  const staleCount = (staleSessions?.stale_charging?.length ?? 0) + (staleSessions?.stale_drives?.length ?? 0)

  const activeNavEntry = useMemo(() => findNavItemByPath(location.pathname), [location.pathname])
  const activeSectionTitle = activeNavEntry?.section.title
  const activeSectionStyle = activeSectionTitle ? SECTION_ICON_STYLES[activeSectionTitle] : undefined
  const visibleNavSections = useMemo(() =>
    navSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => isVisibleNavItem(item, vehicleCount)),
      }))
      .filter(section => section.items.length > 0),
    [vehicleCount],
  )
  const pinnedNavItems = useMemo(() =>
    pinnedNavPaths
      .map(path => findNavItemByExactPath(path))
      .filter((entry): entry is { section: NavSection; item: NavItem } => Boolean(entry))
      .map(entry => entry.item)
      .filter(item => isVisibleNavItem(item, vehicleCount)),
    [pinnedNavPaths, vehicleCount],
  )
  const recentNavItems = useMemo(() =>
    recentNavPaths
      .map(path => findNavItemByExactPath(path))
      .filter((entry): entry is { section: NavSection; item: NavItem } => Boolean(entry))
      .map(entry => entry.item)
      .filter(item => isVisibleNavItem(item, vehicleCount)),
    [recentNavPaths, vehicleCount],
  )

  useEffect(() => {
    if (!activeSectionTitle) return
    setExpandedSections(prev => {
      if (prev.has(activeSectionTitle)) return prev
      const next = new Set(prev)
      next.add(activeSectionTitle)
      return next
    })
  }, [activeSectionTitle])

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPANDED_NAV_STORAGE_KEY, JSON.stringify([...expandedSections]))
    } catch {
      // Ignore storage failures; navigation still works without persisted sections.
    }
  }, [expandedSections])

  useEffect(() => {
    const activeTo = activeNavEntry?.item.to
    if (!activeTo || activeTo === '/' || pinnedNavPaths.includes(activeTo)) return
    setRecentNavPaths(prev => {
      const next = [activeTo, ...prev.filter(path => path !== activeTo)].slice(0, MAX_RECENT_NAV_ITEMS)
      return next.join('|') === prev.join('|') ? prev : next
    })
  }, [activeNavEntry, pinnedNavPaths])

  useEffect(() => {
    try {
      window.localStorage.setItem(RECENT_NAV_STORAGE_KEY, JSON.stringify(recentNavPaths))
    } catch {
      // Ignore storage failures; recent links are convenience-only.
    }
  }, [recentNavPaths])

  useEffect(() => {
    try {
      window.localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(pinnedNavPaths))
    } catch {
      // Ignore storage failures; pinned links still work for the current session.
    }
  }, [pinnedNavPaths])

  const toggleSection = useCallback((title: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(title) && title !== activeSectionTitle) {
        next.delete(title)
      } else {
        next.add(title)
      }
      return next
    })
  }, [activeSectionTitle])
  const expandedSectionCount = visibleNavSections.filter(section => expandedSections.has(section.title)).length
  const expandAllSections = useCallback(() => {
    setExpandedSections(new Set(visibleNavSections.map(section => section.title)))
  }, [visibleNavSections])
  const collapseAllSections = useCallback(() => {
    setExpandedSections(new Set())
  }, [])

  const navLabel = useCallback((label: string) => {
    if (!navI18nKeys[label]) return label
    const translated = t(navI18nKeys[label])
    return translated === navI18nKeys[label] ? label : translated
  }, [t])
  const activeNavPath = activeNavEntry?.item.to
  const activeIsPinned = activeNavPath ? pinnedNavPaths.includes(activeNavPath) : false
  const pinNavPath = useCallback((to: string) => {
    setPinnedNavPaths(prev => {
      if (prev.includes(to)) return prev
      return [to, ...prev].slice(0, MAX_PINNED_NAV_ITEMS)
    })
    setRecentNavPaths(prev => prev.filter(path => path !== to))
  }, [])
  const unpinNavPath = useCallback((to: string) => {
    setPinnedNavPaths(prev => prev.filter(path => path !== to))
  }, [])
  const currentPageTitle = activeNavEntry ? navLabel(activeNavEntry.item.label) : t('nav.currentPage', 'Current page')
  const breadcrumbItems = activeNavEntry
    ? [
        { label: activeNavEntry.section.title },
        { label: currentPageTitle },
      ]
    : []

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
  const versionLabel = versionInfo?.chart_version && versionInfo.chart_version !== 'unknown'
    ? `v${versionInfo.chart_version}`
    : versionInfo?.app_version && versionInfo.app_version !== 'unknown'
      ? versionInfo.app_version
      : ''

  const mainRef = useRef<HTMLElement>(null)
  const renderNavLink = (item: NavItem, compact = false, activeScope = 'main') => {
    const { to, icon: Icon, label, color, ...rest } = item
    const dataTour = 'dataTour' in rest ? (rest as { dataTour?: string }).dataTour : undefined
    const isActive = isActiveNavPath(location.pathname, to)
    const isInTabBar = BOTTOM_TAB_PATHS.has(to)
    const sectionStyle = SECTION_ICON_STYLES[findNavItemByExactPath(to)?.section.title ?? '']
    return (
      <NavLink
        key={to}
        to={to}
        onClick={() => setSidebarOpen(false)}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        data-tour={dataTour}
        className={cn(
          'group relative flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] font-medium transition-all duration-200',
          isInTabBar && 'opacity-50 lg:opacity-100'
        )}
      >
        {isActive && (
          <motion.div
            layoutId={compact ? `nav-active-${activeScope}-${to}` : 'nav-active'}
            className="absolute inset-0 rounded-xl bg-white/[0.06] border border-white/[0.08]"
            style={{ boxShadow: '0 0 20px rgba(0, 240, 255, 0.05)' }}
            transition={{ type: 'spring', bounce: 0.15, duration: 0.5 }}
          />
        )}
        <span
          className={cn(
            'relative z-10 grid shrink-0 place-items-center border border-white/[0.06] transition-all duration-200',
            'h-7 w-7 rounded-lg',
            sectionStyle?.surface ?? 'bg-white/[0.035]',
            sectionStyle?.ring && 'ring-1',
            sectionStyle?.ring,
            isActive ? 'bg-white/[0.09] ring-white/20' : 'group-hover:bg-white/[0.07] group-hover:ring-white/15'
          )}
        >
          <Icon className={cn('h-4 w-4 transition-all duration-200', color, isActive ? 'opacity-100 drop-shadow-[0_0_8px_currentColor]' : 'opacity-75 group-hover:opacity-100')} />
        </span>
        <span className={cn('relative z-10 min-w-0 truncate transition-colors', isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]')}>
          {navLabel(label)}
        </span>
        {to === '/alerts' && unreadAlerts > 0 && (
          <span className="relative z-10 ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-red/20 px-1.5 text-[10px] font-bold text-neon-red ring-1 ring-neon-red/30">
            {unreadAlerts > 9 ? '9+' : unreadAlerts}
          </span>
        )}
        {to === '/vehicles' && vehicles && vehicles.length > 0 && (
          <span className="relative z-10 ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-cyan/10 px-1.5 text-[10px] font-bold text-neon-cyan ring-1 ring-neon-cyan/20">
            {vehicles.length}
          </span>
        )}
        {to === '/data-repair' && staleCount > 0 && (
          <span className="relative z-10 ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-amber/20 px-1.5 text-[10px] font-bold text-neon-amber ring-1 ring-neon-amber/30">
            {staleCount > 9 ? '9+' : staleCount}
          </span>
        )}
        {isActive && !compact && (
          <span className="absolute right-3 h-1.5 w-1.5 rounded-full bg-neon-cyan shadow-[0_0_6px_rgba(0,240,255,0.5)]" />
        )}
      </NavLink>
    )
  }

  return (
    <div className="flex h-dvh bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Skip to content (WCAG 2.4.1). Hidden until focused; sends focus
          straight to <main id="main-content"> so keyboard users don't have
          to tab through the entire sidebar to reach the page body. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[300] focus:rounded-lg focus:bg-neon-cyan focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--bg)] focus:ring-neon-cyan"
        onClick={(e) => { e.preventDefault(); mainRef.current?.focus() }}
      >
        {t('a11y.skipToMain', 'Skip to main content')}
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
            className="fixed inset-0 z-[65] bg-slate-950/35 backdrop-blur-sm dark:bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        role="navigation"
        aria-label={t('a11y.primaryNav', 'Primary')}
        data-tour="sidebar"
        data-sidebar-open={sidebarOpen}
        className={cn(
          'fixed left-0 bottom-0 z-[66] w-[clamp(240px,70vw,256px)] transform transition-transform duration-300 ease-out lg:top-0 lg:static lg:z-auto lg:w-64 lg:translate-x-0',
          'flex flex-col border-r border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl lg:shadow-none',
          sidebarOpen ? 'top-0 translate-x-0' : 'top-14 -translate-x-full'
        )}
      >
        {/* Mobile sidebar brand, shown only while the drawer is open */}
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-5 py-4 shrink-0 lg:hidden">
          <NavLink to="/" className="min-w-0 flex flex-1 items-center gap-3 rounded-xl transition-colors" onClick={() => setSidebarOpen(false)}>
            <Logo size={32} showWordmark />
          </NavLink>
          {versionLabel && (
            <span className="rounded-md bg-neon-cyan/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neon-cyan">
              {versionLabel}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('nav.closeSidebar', 'Close sidebar')}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(false)}
            className="h-10 w-10 shrink-0 rounded-xl p-0 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Logo — desktop sidebar header */}
        <div className="hidden lg:flex items-center gap-2 px-5 py-5 border-b border-[var(--glass-border)] shrink-0">
          <NavLink to="/" className="flex flex-1 items-center gap-3 hover:bg-[var(--surface-2)] -mx-2 px-2 py-1 rounded-md transition-colors" onClick={() => setSidebarOpen(false)}>
            <Logo size={32} showWordmark />
            {versionLabel && (
              <span className="ml-auto rounded-md bg-neon-cyan/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-neon-cyan">
                {versionLabel}
              </span>
            )}
          </NavLink>
          <NotificationBell />
        </div>

        {/* Sticky search trigger */}
        <div className="px-3 py-2 lg:px-4 lg:py-3 border-b border-[var(--glass-border)] shrink-0">
          <CommandPaletteTrigger />
        </div>

        {/* Persistent vehicle scope picker — Phase 40 / Prompt 16.
            Renders its own bordered wrapper; returns null for single-vehicle
            owners so no empty padding is visible. */}
        <VehiclePicker />

        {/* Navigation */}
        <nav
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2 lg:py-4 px-3 space-y-3 scrollbar-thin"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehaviorY: 'contain' }}
        >
          {activeNavEntry && (
            <div
              className={cn(
                'rounded-2xl border border-[var(--glass-border)] px-3 py-2.5 ring-1',
                activeSectionStyle?.surface ?? 'bg-[rgba(var(--theme-primary-rgb),0.07)]',
                activeSectionStyle?.ring ?? 'ring-[rgba(var(--theme-primary-rgb),0.18)]',
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                    {t('nav.currentSection', 'Current')}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
                    {navLabel(activeNavEntry.item.label)}
                  </p>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">
                    {activeNavEntry.section.title}
                  </p>
                </div>
                {activeNavPath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={activeIsPinned}
                    aria-label={activeIsPinned ? t('nav.unpinCurrent', 'Remove current page from pinned') : t('nav.pinCurrent', 'Pin current page')}
                    onClick={() => activeIsPinned ? unpinNavPath(activeNavPath) : pinNavPath(activeNavPath)}
                    className={cn(
                      'h-8 shrink-0 rounded-lg px-2 text-[11px] hover:bg-white/[0.08]',
                      activeIsPinned ? 'text-amber-300' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Star className={cn('h-3.5 w-3.5', activeIsPinned && 'fill-current')} />
                    <span>{activeIsPinned ? t('nav.pinnedAction', 'Pinned') : t('nav.pinAction', 'Pin')}</span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {pinnedNavItems.length > 0 && (
            <div>
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t('nav.pinned', 'Pinned')}
              </p>
              <div className="space-y-0.5">
                {pinnedNavItems.map(item => (
                  <div key={item.to} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      {renderNavLink(item, true, 'pinned')}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('nav.unpinPage', { page: navLabel(item.label), defaultValue: `Unpin ${navLabel(item.label)}` })}
                      onClick={() => unpinNavPath(item.to)}
                      className="h-7 w-7 shrink-0 rounded-lg p-0 text-[var(--text-muted)] opacity-80 hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recentNavItems.length > 0 && (
            <div>
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t('nav.recentlyUsed', 'Recently Used')}
              </p>
              <div className="space-y-0.5">
                {recentNavItems.map(item => renderNavLink(item, true, 'recent'))}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="mb-1 flex items-center justify-between gap-2 px-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t('nav.sections', 'Sections')}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('nav.expandAll', 'Expand all sections')}
                  title={t('nav.expandAll', 'Expand all sections')}
                  disabled={expandedSectionCount === visibleNavSections.length}
                  onClick={expandAllSections}
                  className="h-7 w-7 shrink-0 rounded-lg p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  <ChevronsDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={t('nav.collapseAll', 'Collapse all sections')}
                  title={t('nav.collapseAll', 'Collapse all sections')}
                  disabled={expandedSectionCount === 0}
                  onClick={collapseAllSections}
                  className="h-7 w-7 shrink-0 rounded-lg p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  <ChevronsUp className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
            {visibleNavSections.map(section => {
              const isExpanded = expandedSections.has(section.title)
              const isActiveSection = section.title === activeSectionTitle
              const sectionStyle = SECTION_ICON_STYLES[section.title]
              return (
                <div key={section.title}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={isExpanded}
                    aria-controls={`nav-section-${section.title.replace(/\W+/g, '-').toLowerCase()}`}
                    onClick={() => toggleSection(section.title)}
                    className={cn(
                      'mb-1 h-8 w-full justify-between rounded-xl px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
                      isActiveSection && [
                        'text-[var(--text-primary)] ring-1',
                        sectionStyle?.surface ?? 'bg-[rgba(var(--theme-primary-rgb),0.07)]',
                        sectionStyle?.ring ?? 'ring-[rgba(var(--theme-primary-rgb),0.16)]',
                      ]
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('h-1.5 w-1.5 rounded-full opacity-80', sectionStyle?.dot ?? 'bg-neon-cyan')} />
                      <span>{section.title}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[9px] font-bold ring-1',
                          isActiveSection
                            ? [
                              'text-[var(--text-primary)]',
                              sectionStyle?.surface ?? 'bg-[rgba(var(--theme-primary-rgb),0.12)]',
                              sectionStyle?.ring ?? 'ring-[rgba(var(--theme-primary-rgb),0.24)]',
                            ]
                            : 'bg-[var(--surface-2)] text-[var(--text-secondary)] ring-[var(--glass-border)]'
                        )}
                      >
                        {section.items.length}
                      </span>
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')} />
                    </span>
                  </Button>
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        id={`nav-section-${section.title.replace(/\W+/g, '-').toLowerCase()}`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <div className="space-y-0.5 pb-2">
                          {section.items.map(item => renderNavLink(item, true, `section-${section.title}`))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        </nav>

        {/* Bottom status */}
        <div className="border-t border-[var(--glass-border)] px-4 py-3 space-y-2 shrink-0 safe-bottom">
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
              <div className={cn('h-2 w-2 rounded-full', primaryState.state.battery_level > 20 ? 'bg-neon-green' : 'bg-neon-red')}
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
            <LiveIndicator variant="dot" />
          </GlassPanel>
          <p data-tour="keyboard-hint" className="text-center text-[10px] text-[var(--text-muted)] mt-1">
            {t('shortcuts.hint', 'Press')} <kbd className="px-1 rounded bg-[var(--surface-2)] text-[var(--text-secondary)]">?</kbd> {t('shortcuts.hintSuffix', 'for shortcuts')}
          </p>
        </div>
      </aside>

      {/* Mobile top bar */}
      {!sidebarOpen && (
        <header className="fixed top-0 left-0 right-0 z-[60] flex items-center border-b border-[var(--glass-border)] bg-[var(--surface-1)] backdrop-blur-xl px-4 py-3 lg:hidden [touch-action:manipulation]">
          <Button
            onClick={() => setSidebarOpen(true)}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('nav.openSidebar', 'Open sidebar')}
            aria-expanded={false}
            className="relative z-10 h-11 w-11 -ml-1 rounded-xl p-0 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
          >
            <Menu className="h-6 w-6" />
          </Button>
          <div className="flex-1 flex justify-center -ml-10">
            <Logo size={26} showWordmark />
          </div>
          <NotificationBell className="ml-auto" />
        </header>
      )}

      {/* Main content */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Spacer for fixed mobile header */}
        <div className="h-14 shrink-0 lg:hidden" />

        <ServiceStatusBanner />
        <main id="main-content" ref={mainRef} role="main" tabIndex={-1} className="flex-1 overflow-y-auto outline-none pb-16 lg:pb-0">
          <div className="mx-auto max-w-[1600px] px-3 py-4 pb-safe sm:px-5 sm:py-5 lg:px-8 lg:py-8">
            {activeNavEntry && (
              <div className="mb-3 flex min-h-8 items-center justify-between gap-3 border-b border-white/[0.06] pb-2">
                <Breadcrumbs items={breadcrumbItems} className="min-w-0 text-xs" />
                <p className="hidden shrink-0 text-[10px] text-[var(--text-muted)] lg:block">
                  {t('nav.quickSearchHint', 'Ctrl+K to jump')}
                </p>
              </div>
            )}
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
      <CommandPalette onOpen={() => setSidebarOpen(false)} />

      {/* PWA Install Prompt */}
      <InstallPrompt />

      {/* Keyboard shortcut overlays */}
      <GotoIndicator visible={shortcutMode === 'goto'} />
      <KeyboardShortcutsModal open={showCheatSheet} onClose={toggleCheatSheet} />

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
