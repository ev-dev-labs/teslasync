import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { GuardedNavLink } from '../feedback/GuardedLink'
import InstallPrompt from '../feedback/InstallPrompt'
import { OfflineBanner } from '../feedback/OfflineBanner'
import { NewVersionBanner } from '../feedback/NewVersionBanner'
import { TeslaReauthBanner } from '../feedback/TeslaReauthBanner'
import { RateLimitBanner } from '../feedback/RateLimitBanner'
import { MaintenanceBanner } from '../feedback/MaintenanceBanner'
import { ImpersonationBanner } from '../feedback/ImpersonationBanner'
import { TopProgress } from '../feedback/TopProgress'
import { SessionExpiringModal } from '../feedback/SessionExpiringModal'
import { SessionExpiredModal } from '../feedback/SessionExpiredModal'
import { AnnouncerRegion } from '@/components/a11y'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { GlobalShortcuts } from '@/lib/globalShortcuts'
import { useTour } from '@/hooks/useTour'
import { GotoIndicator } from '../feedback/GotoIndicator'
import { KeyboardShortcutsModal } from '../feedback/KeyboardShortcutsModal'
import { FeedbackModal } from '../feedback/FeedbackModal'
import { TourOverlay } from '../feedback/TourOverlay'
import { ChangelogModal } from '../feedback/ChangelogModal'
import { DraftRestorePrompt } from '../feedback/DraftRestorePrompt'
import { SkipToContent } from '../feedback/SkipToContent'
import { BrowserCompatBanner } from '../feedback/BrowserCompatBanner'
import { TimeMachineBanner } from '../feedback/TimeMachineBanner'
import { CookieConsentBanner } from '../feedback/CookieConsentBanner'
import { TourLauncher } from '@/features/onboarding/TourLauncher'
import {
  TOUR_START_EVENT,
  TOURS,
  dispatchTourStart,
  isTourCompleted as isTourCompletedById,
  completedTourToken,
  seedCompletedFromServer,
  markTourCompleted,
  type TourStartEventDetail,
} from '@/lib/tourRegistry'
import { subscribe as subscribeToBroadcast } from '@/lib/broadcast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { RouteTransition } from '@/components/motion'
import { BottomTabBar, BOTTOM_TAB_PATHS } from './BottomTabBar'
import { LinearSidebar } from './sidebar/LinearSidebar'
import { NotionSidebar } from './sidebar/NotionSidebar'
import { useSidebarStyle } from '@/hooks/useSidebarStyle'
import { StatusBar, useStatusBarPrefs } from './StatusBar'
import { CommandPalette, CommandPaletteTrigger } from '../ui/CommandPalette'
import { ServiceStatusBanner } from '../data-display/ServiceStatus'
import Logo from '../ui/Logo'
import { Button, ThemePicker } from '@/components/ui'
import {
  BreadcrumbOverridesProvider,
} from './BreadcrumbOverridesContext'
import { LayoutBreadcrumbs } from './LayoutBreadcrumbs'
import { VehiclePicker } from './VehiclePicker'
import { NavSectionHeader } from './sidebar/NavSectionHeader'
import { request } from '@/api/client'
import { useIsForwardAuth } from '@/api/hooks/useAuthMode'
import { useSettings, settingsKeys } from '@/api/hooks/useSettings'
import type { Alert, Vehicle, StaleSessionsResponse } from '@/api/types'
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents'
import { useNotificationListener } from '../../hooks/useNotificationListener'
import { useTitleBadge } from '../../hooks/useTitleBadge'
import { useFaviconBadge } from '../../hooks/useFaviconBadge'
import { useDynamicAppIcon } from '../../hooks/useDynamicAppIcon'
import { useCriticalAlertFlash } from '../../hooks/useCriticalAlertFlash'
import { useToast } from '../feedback/Toast'
import { NotificationBellPopover } from './NotificationBellPopover'
import { getAlertDrillthroughHref } from '@/lib/alertDrillthrough'
import { Icons } from '@/lib/icons';
import { HelixMark } from '@/components/branding/HelixMark';

const navI18nKeys: Record<string, string> = {
  // Sidebar nav labels are rendered verbatim from `navSections` below. The
  // legacy i18n key map (`'Charging Overview' → 'nav.charging'`, etc.)
  // accidentally rewrote the descriptive labels back to their short legacy
  // strings (`"Charging"`, `"Fleet"`, `"Energy"`, `"Inbox"`, `"Channels"`,
  // ...), creating duplicate section/item names like the CHARGING header
  // with a "Charging" item directly under it. Keep the map empty so the
  // `label` field is always shown as authored.
}

export const navSearchKeywords: Record<string, string[]> = {
  '/': ['home', 'overview', 'start', 'summary'],
  '/live': ['map', 'location', 'tracking', 'realtime', 'vehicle position'],
  '/vehicles': ['cars', 'fleet', 'garage', 'vehicle list'],
  '/period-compare': ['comparison', 'period', 'time', 'this month vs last month', 'trends'],
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
  '/vehicle-comparison': ['compare vehicles', 'fleet comparison', 'side by side', 'two vehicles'],
  '/timeline': ['timeline', 'events', 'history'],
  '/locations': ['places', 'locations', 'visited'],
  '/commands': ['commands', 'control', 'remote'],
  '/command-history': ['command log', 'remote history'],
  '/automations': ['automation', 'rules', 'workflows'],
  '/notifications': ['notifications', 'messages', 'inbox'],
  '/notifications/inbox': ['inbox', 'notifications', 'messages'],
  '/notifications/archived': ['archived', 'notifications'],
  '/notifications/alerts': ['alerts', 'warnings', 'critical'],
  '/notifications/channels': ['channels', 'discord', 'slack', 'telegram', 'email', 'ntfy', 'pushover', 'webhook'],
  '/notifications/webhooks': ['webhooks', 'hmac', 'http endpoint'],
  '/notifications/browser': ['browser notifications', 'desktop push', 'permission'],
  '/notifications/quiet-hours': ['quiet hours', 'do not disturb', 'dnd', 'schedule'],
  '/notifications/rules': ['alert rules', 'rules', 'conditions'],
  '/notifications/studio': ['alert studio', 'studio', 'rule builder'],
  '/geofences': ['geofence', 'zones', 'places'],
  '/guard-mode': ['guard', 'sentry', 'security'],
  '/chatbot': ['ai', 'assistant', 'chat'],
  '/media-player': ['media', 'music', 'player'],
  '/tesla-account': ['account', 'tesla login', 'oauth'],
  '/system-status': ['system', 'status', 'health', 'admin', 'administration', 'overview'],
  '/api-logs': ['api logs', 'requests', 'debug'],
  '/fleet-api': ['fleet api', 'tesla api'],
  '/tesla-features': ['feature flags', 'tesla features', 'feature config', 'flags'],
  '/tesla-region': ['region', 'tesla region', 'fleet api endpoint', 'api region'],
  '/tesla-orders': ['orders', 'tesla orders', 'active orders', 'delivery', 'vehicle delivery'],
  '/gas-price': ['gas price', 'fuel', 'eia', 'gasoline', 'auto poll', 'comparison'],
  '/settings': ['settings', 'preferences', 'configuration'],
  '/api-keys': ['keys', 'tokens', 'api key'],
  '/notifications/audit': ['audit', 'audit log', 'activity log', 'admin'],
  '/data-export': ['export', 'download', 'csv'],
  '/backup': ['backup', 'restore'],
  '/data-repair': ['repair', 'data repair', 'fix sessions'],
  '/dev-tools': ['developer', 'tools', 'debug'],
  '/api-playground': ['playground', 'api test'],
  '/roadmap': ['roadmap', 'plans'],
  '/signals': ['signals', 'live monitor', 'signal log', 'signal explorer', 'signal diff', 'gap detector', 'telemetry workspace'],
  '/account/2fa': ['2fa', 'two factor', 'two-factor', 'mfa', 'totp', 'authenticator', 'security', 'account', 'verify', 'enroll'],
  '/account/sessions': ['sessions', 'devices', 'sign out', 'logout', 'revoke', 'active sessions', 'security', 'account'],
  '/account/privacy': ['privacy', 'recent pages', 'recently viewed', 'cookies', 'consent', 'gdpr', 'analytics', 'tracking', 'account'],
  '/integrations/helix': ['helix', 'ai', 'assistant', 'llm', 'gpt', 'openai', 'anthropic', 'integration', 'provider', 'cost cap', 'api key'],
  '/live-monitor': ['live signals', 'monitor', 'telemetry'],
  '/signal-log': ['signals', 'signal log', 'telemetry log'],
  '/signal-explorer': ['explore signals', 'signal explorer'],
  '/signal-diff': ['diff', 'signal compare'],
  '/signal-gaps': ['gaps', 'missing signals'],
  '/state-debugger': ['state machine', 'debugger', 'fsm'],
  '/mqtt-inspector': ['mqtt', 'broker', 'telemetry stream'],
  '/redis-signals': ['redis', 'cache', 'signals'],
  '/db-health': ['database', 'db', 'postgres'],
  '/anomaly-detection': ['anomaly', 'outliers', 'analytics', 'detection'],
}

const DEFAULT_PINNED_NAV_PATHS = ['/', '/digital-twin', '/vehicles', '/charging', '/live']
const MAX_PINNED_NAV_ITEMS = 8
const MAX_RECENT_NAV_ITEMS = 3
const EXPANDED_NAV_STORAGE_KEY = 'teslasync-expanded-nav-sections'
const RECENT_NAV_STORAGE_KEY = 'teslasync-recent-nav-paths'
const PINNED_NAV_STORAGE_KEY = 'teslasync-pinned-nav-paths'

const SECTION_ICON_STYLES: Record<string, { accent: string; surface: string; ring: string; dot: string; icon: typeof Icons.home; gradient: string }> = {
  Home:           { accent: 'text-sky-700 dark:text-sky-300',         surface: 'bg-sky-400/10',     ring: 'ring-sky-400/20',     dot: 'bg-sky-400',     icon: Icons.home,            gradient: 'from-sky-500/20 via-sky-400/5 to-transparent' },
  Vehicles:       { accent: 'text-cyan-700 dark:text-cyan-300',       surface: 'bg-cyan-400/10',    ring: 'ring-cyan-400/20',    dot: 'bg-cyan-400',    icon: Icons.vehicle,         gradient: 'from-cyan-500/20 via-cyan-400/5 to-transparent' },
  Driving:        { accent: 'text-violet-700 dark:text-violet-300',   surface: 'bg-violet-400/10',  ring: 'ring-violet-400/20',  dot: 'bg-violet-400',  icon: Icons.drive,           gradient: 'from-violet-500/25 via-violet-400/8 to-transparent' },
  Charging:       { accent: 'text-emerald-700 dark:text-emerald-300', surface: 'bg-emerald-400/10', ring: 'ring-emerald-400/20', dot: 'bg-emerald-400', icon: Icons.batteryCharging, gradient: 'from-emerald-500/20 via-emerald-400/5 to-transparent' },
  Battery:        { accent: 'text-amber-700 dark:text-amber-300',     surface: 'bg-amber-400/10',   ring: 'ring-amber-400/20',   dot: 'bg-amber-400',   icon: Icons.battery,         gradient: 'from-amber-500/20 via-amber-400/5 to-transparent' },
  Energy:         { accent: 'text-lime-700 dark:text-lime-300',       surface: 'bg-lime-400/10',    ring: 'ring-lime-400/20',    dot: 'bg-lime-400',    icon: Icons.bolt,            gradient: 'from-lime-500/20 via-lime-400/5 to-transparent' },
  Service:        { accent: 'text-rose-700 dark:text-rose-300',       surface: 'bg-rose-400/10',    ring: 'ring-rose-400/20',    dot: 'bg-rose-400',    icon: Icons.maintenance,     gradient: 'from-rose-500/20 via-rose-400/5 to-transparent' },
  Reports:        { accent: 'text-green-700 dark:text-green-300',     surface: 'bg-green-400/10',   ring: 'ring-green-400/20',   dot: 'bg-green-400',   icon: Icons.analytics,       gradient: 'from-green-500/20 via-green-400/5 to-transparent' },
  Cabin:          { accent: 'text-sky-700 dark:text-sky-300',         surface: 'bg-sky-400/10',     ring: 'ring-sky-400/20',     dot: 'bg-sky-400',     icon: Icons.cabin,           gradient: 'from-sky-500/20 via-sky-400/5 to-transparent' },
  Commands:       { accent: 'text-fuchsia-700 dark:text-fuchsia-300', surface: 'bg-fuchsia-400/10', ring: 'ring-fuchsia-400/20', dot: 'bg-fuchsia-400', icon: Icons.gamepad,         gradient: 'from-fuchsia-500/20 via-fuchsia-400/5 to-transparent' },
  Controls:       { accent: 'text-fuchsia-700 dark:text-fuchsia-300', surface: 'bg-fuchsia-400/10', ring: 'ring-fuchsia-400/20', dot: 'bg-fuchsia-400', icon: Icons.gamepad,         gradient: 'from-fuchsia-500/20 via-fuchsia-400/5 to-transparent' },
  Automation:     { accent: 'text-purple-700 dark:text-purple-300',   surface: 'bg-purple-400/10',  ring: 'ring-purple-400/20',  dot: 'bg-purple-400',  icon: Icons.workflow,        gradient: 'from-purple-500/25 via-purple-400/8 to-transparent' },
  Notifications:  { accent: 'text-orange-700 dark:text-orange-300',   surface: 'bg-orange-400/10',  ring: 'ring-orange-400/20',  dot: 'bg-orange-400',  icon: Icons.notifications,   gradient: 'from-orange-500/20 via-orange-400/5 to-transparent' },
  Security:       { accent: 'text-yellow-700 dark:text-yellow-300',   surface: 'bg-yellow-400/10',  ring: 'ring-yellow-400/20',  dot: 'bg-yellow-400',  icon: Icons.security,        gradient: 'from-yellow-500/20 via-yellow-400/5 to-transparent' },
  Account:        { accent: 'text-blue-700 dark:text-blue-300',       surface: 'bg-blue-400/10',    ring: 'ring-blue-400/20',    dot: 'bg-blue-400',    icon: Icons.user,            gradient: 'from-blue-500/20 via-blue-400/5 to-transparent' },
  Integrations:   { accent: 'text-pink-700 dark:text-pink-300',       surface: 'bg-pink-400/10',    ring: 'ring-pink-400/20',    dot: 'bg-pink-400',    icon: Icons.link,            gradient: 'from-pink-500/20 via-pink-400/5 to-transparent' },
  Settings:       { accent: 'text-slate-700 dark:text-slate-300',     surface: 'bg-slate-400/10',   ring: 'ring-slate-400/20',   dot: 'bg-slate-400',   icon: Icons.settings,        gradient: 'from-slate-500/20 via-slate-400/5 to-transparent' },
  Data:           { accent: 'text-teal-700 dark:text-teal-300',       surface: 'bg-teal-400/10',    ring: 'ring-teal-400/20',    dot: 'bg-teal-400',    icon: Icons.database,        gradient: 'from-teal-500/20 via-teal-400/5 to-transparent' },
  Diagnostics:    { accent: 'text-cyan-700 dark:text-neon-cyan',      surface: 'bg-cyan-400/10',    ring: 'ring-cyan-400/20',    dot: 'bg-neon-cyan',   icon: Icons.activity,        gradient: 'from-cyan-500/25 via-cyan-400/8 to-transparent' },
  About:          { accent: 'text-slate-600 dark:text-[var(--text-secondary)]', surface: 'bg-[var(--surface-2)]', ring: 'ring-white/10', dot: 'bg-[var(--surface-2)]', icon: Icons.info, gradient: 'from-white/[0.06] via-white/[0.02] to-transparent' },
}

// NOTE: The legacy `SSEStatusDot` component lived here and rendered a bare
// colored dot tied to the SSE wire state. It was replaced by the shared
// `<LiveIndicator variant="dot">` (see import above) so the sidebar status
// dot, page-level badges, and stale-data banner all derive from a single
// `useLiveConnection` source of truth.

/**
 * Feature switch for the sidebar "Recently Used" surface — disabled per
 * UX review on 2026-05-26 (duplicated items across Pinned + Recently
 * Used + canonical section added noise). Code is kept in place so we
 * can re-enable it by flipping this flag back to `true` without a diff.
 * Recent-page tracking itself still runs (it's wired into the command
 * palette + the dashboard widget) — only the sidebar render is muted.
 */
const SHOW_RECENTLY_USED_NAV = false;

/**
 * Sidebar style is now a user preference (Settings → Appearance →
 * Sidebar style). Backed by localStorage via `useSidebarStyle`, with
 * cross-tab sync via the `storage` event. Default is 'linear'.
 *
 * The legacy `<nav>` block below is preserved verbatim so users can
 * choose 'legacy' at any time and get a byte-identical sidebar.
 */
// Trial flag retained for cmd+line debugging — uncomment to force a
// specific style regardless of the user's saved preference.
// const FORCE_SIDEBAR_STYLE: SidebarStyle | null = null;

export const navSections = [
  {
    title: 'Home',
    items: [
      { to: '/', icon: Icons.layoutDashboard, label: 'Dashboard', color: 'text-blue-400' },
      { to: '/explore', icon: Icons.sparkles, label: 'Explore Features', color: 'text-amber-400' },
      { to: '/live', icon: Icons.radar, label: 'Live Map', color: 'text-emerald-400' },
      { to: '/timeline', icon: Icons.clock, label: 'Timeline', color: 'text-sky-400' },
      { to: '/weekly-digest', icon: Icons.calendarCheck, label: 'Weekly Digest', color: 'text-purple-400' },
    ],
  },
  {
    title: 'Vehicles',
    items: [
      { to: '/vehicles', icon: Icons.vehicle, label: 'My Vehicles', color: 'text-sky-400', dataTour: 'vehicle-section' },
      { to: '/digital-twin', icon: Icons.monitor, label: 'Vehicle Live View', color: 'text-cyan-400' },
      { to: '/vehicle-comparison', icon: Icons.arrowLeftRight, label: 'Compare Vehicles', color: 'text-orange-400', minVehicles: 2 },
      { to: '/locations', icon: Icons.location, label: 'Saved Locations', color: 'text-emerald-400' },
    ],
  },
  {
    title: 'Driving',
    items: [
      { to: '/drives', icon: Icons.drive, label: 'Drives', color: 'text-violet-400' },
      { to: '/trips', icon: Icons.trip, label: 'Trips', color: 'text-teal-400' },
      { to: '/trip-planner', icon: Icons.mapPinned, label: 'Trip Planner', color: 'text-emerald-400' },
      { to: '/navigation', icon: Icons.signpost, label: 'Navigation', color: 'text-teal-400' },
      { to: '/geofences', icon: Icons.fence, label: 'Geofences', color: 'text-lime-400' },
      { to: '/mileage', icon: Icons.trip, label: 'Mileage Log', color: 'text-teal-400' },
      { to: '/lifetime-stats', icon: Icons.award, label: 'Lifetime Stats', color: 'text-yellow-400' },
      { to: '/drive-score', icon: Icons.trophy, label: 'Drive Score', color: 'text-yellow-400' },
      { to: '/speed-profile', icon: Icons.speed, label: 'Speed Profile', color: 'text-rose-400' },
      { to: '/driving-dynamics', icon: Icons.efficiency, label: 'Driving Dynamics', color: 'text-red-400' },
      { to: '/regen-efficiency', icon: Icons.recycle, label: 'Regen Braking', color: 'text-green-400' },
      { to: '/route-efficiency', icon: Icons.navigationAlt, label: 'Route Efficiency', color: 'text-emerald-400' },
    ],
  },
  {
    title: 'Charging',
    items: [
      { to: '/charging', icon: Icons.batteryCharging, label: 'Charging Overview', color: 'text-green-400' },
      { to: '/tesla-charging-history', icon: Icons.receipt, label: 'Charge History', color: 'text-emerald-400' },
      { to: '/charging-curve', icon: Icons.trendUp, label: 'Charging Curve', color: 'text-lime-400' },
      { to: '/charging-heatmap', icon: Icons.calendarClock, label: 'Charging Patterns', color: 'text-cyan-400' },
      { to: '/smart-charge', icon: Icons.calendarClock, label: 'Smart Charging', color: 'text-cyan-400' },
      { to: '/powershare', icon: Icons.charging, label: 'Powershare', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Battery',
    items: [
      { to: '/battery', icon: Icons.heartPulse, label: 'Battery Health', color: 'text-rose-400' },
      { to: '/battery-cells', icon: Icons.battery, label: 'Battery Cells', color: 'text-purple-400' },
      { to: '/battery-degradation', icon: Icons.trendDown, label: 'Battery Degradation', color: 'text-orange-400' },
      { to: '/projected-range', icon: Icons.target, label: 'Projected Range', color: 'text-pink-400' },
      { to: '/vampire-drain', icon: Icons.moon, label: 'Vampire Drain', color: 'text-indigo-400' },
      { to: '/sleep-efficiency', icon: Icons.bedDouble, label: 'Sleep Efficiency', color: 'text-purple-400' },
    ],
  },
  {
    title: 'Energy',
    items: [
      { to: '/energy', icon: Icons.bolt, label: 'Energy Usage', color: 'text-yellow-400' },
      { to: '/energy-flow', icon: Icons.arrowRightLeft, label: 'Energy Flow', color: 'text-yellow-400' },
      { to: '/power-flow', icon: Icons.charging, label: 'Power Flow', color: 'text-orange-400' },
      { to: '/energy-products', icon: Icons.home, label: 'Solar & Powerwall', color: 'text-lime-400' },
    ],
  },
  {
    title: 'Service',
    items: [
      { to: '/tire-pressure', icon: Icons.tirePressure, label: 'Tire Pressure', color: 'text-orange-400' },
      { to: '/drivetrain-health', icon: Icons.cpu, label: 'Drivetrain Health', color: 'text-red-400' },
      { to: '/software-updates', icon: Icons.download, label: 'Software Updates', color: 'text-teal-400' },
      { to: '/maintenance', icon: Icons.maintenance, label: 'Maintenance', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Cabin',
    items: [
      { to: '/climate-control', icon: Icons.climate, label: 'Climate Control', color: 'text-sky-400' },
      { to: '/media-player', icon: Icons.headphones, label: 'Media Player', color: 'text-pink-400' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/statistics', icon: Icons.pieChart, label: 'Statistics', color: 'text-cyan-400' },
      { to: '/analytics', icon: Icons.analytics, label: 'Analytics', color: 'text-indigo-400' },
      { to: '/period-compare', icon: Icons.calendar, label: 'Period Comparison', color: 'text-orange-400' },
      { to: '/efficiency', icon: Icons.leaf, label: 'Efficiency', color: 'text-amber-400' },
      { to: '/temperature-impact', icon: Icons.climateHot, label: 'Temperature Impact', color: 'text-blue-400' },
      { to: '/cost-analysis', icon: Icons.dollarSign, label: 'Cost Analysis', color: 'text-emerald-400' },
      { to: '/tco', icon: Icons.wallet, label: 'Cost of Ownership', color: 'text-green-400' },
    ],
  },
  {
    title: 'Commands',
    items: [
      { to: '/commands', icon: Icons.gamepad, label: 'Send Commands', color: 'text-fuchsia-400', dataTour: 'commands-section' },
      { to: '/command-history', icon: Icons.history, label: 'Command History', color: 'text-violet-400' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { to: '/automations', icon: Icons.workflow, label: 'Automations', color: 'text-purple-400' },
      { to: '/notifications/studio', icon: Icons.notificationsAdd, label: 'Alert Studio', color: 'text-fuchsia-400' },
      { to: '/notifications/rules', icon: Icons.filter, label: 'Alert Rules', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Notifications',
    items: [
      { to: '/notifications/inbox', icon: Icons.notifications, label: 'Notification Inbox', color: 'text-purple-400' },
      { to: '/notifications/alerts', icon: Icons.notificationsActive, label: 'Alert Center', color: 'text-red-400' },
      { to: '/notifications/channels', icon: Icons.send, label: 'Notification Channels', color: 'text-cyan-400' },
      { to: '/notifications/webhooks', icon: Icons.cloud, label: 'Webhooks', color: 'text-sky-400' },
      { to: '/notifications/browser', icon: Icons.notificationsActive, label: 'Browser Notifications', color: 'text-fuchsia-400' },
      { to: '/notifications/quiet-hours', icon: Icons.clock, label: 'Quiet Hours', color: 'text-indigo-400' },
    ],
  },
  {
    title: 'Security',
    items: [
      { to: '/security-access', icon: Icons.locked, label: 'Security & Access', color: 'text-emerald-400' },
      { to: '/safety-settings', icon: Icons.securityCheck, label: 'Safety Settings', color: 'text-amber-400' },
      { to: '/guard-mode', icon: Icons.securityAlert, label: 'Guard Mode', color: 'text-red-400' },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/tesla-account', icon: Icons.user, label: 'Tesla Account', color: 'text-blue-400' },
      { to: '/tesla-orders', icon: Icons.shoppingCart, label: 'Active Orders', color: 'text-teal-400' },
      { to: '/fleet-api', icon: Icons.cloud, label: 'Fleet API', color: 'text-sky-400' },
      { to: '/tesla-region', icon: Icons.globe, label: 'Region & API', color: 'text-emerald-400' },
      { to: '/tesla-features', icon: Icons.flag, label: 'Feature Flags', color: 'text-purple-400' },
      { to: '/account/2fa',      icon: Icons.securityCheck, label: 'Two-Factor Auth',  color: 'text-yellow-400', requiresAuth: true },
      { to: '/account/sessions', icon: Icons.monitor,       label: 'Active Sessions',  color: 'text-cyan-400',   requiresAuth: true },
      { to: '/account/privacy',  icon: Icons.security,      label: 'Privacy',          color: 'text-emerald-400' },
      { to: '/me/activity',      icon: Icons.history,       label: 'My Activity',      color: 'text-cyan-400',   requiresAuth: true },
    ],
  },
  {
    title: 'Settings',
    items: [
      { to: '/settings', icon: Icons.settings, label: 'General Settings', color: 'text-[var(--text-muted)]' },
      { to: '/chatbot', icon: HelixMark, label: 'Helix Chat', color: 'text-purple-400' },
      { to: '/dev-tools', icon: Icons.hammer, label: 'Developer Tools', color: 'text-cyan-400' },
    ],
  },
  {
    title: 'Integrations',
    items: [
      { to: '/integrations/helix', icon: HelixMark, label: 'Helix', color: 'text-purple-400' },
      { to: '/api-keys', icon: Icons.key, label: 'API Keys', color: 'text-amber-400' },
      { to: '/gas-price', icon: Icons.fuel, label: 'Gas Prices', color: 'text-orange-400' },
    ],
  },
  {
    title: 'Data',
    items: [
      { to: '/data-export', icon: Icons.hardDriveDownload, label: 'Data Export', color: 'text-lime-400' },
      { to: '/backup', icon: Icons.databaseBackup, label: 'Backup & Restore', color: 'text-teal-400' },
      { to: '/data-repair', icon: Icons.stethoscope, label: 'Data Repair', color: 'text-amber-400' },
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      { to: '/system-status', icon: Icons.efficiency, label: 'System Status', color: 'text-emerald-400' },
      { to: '/db-health', icon: Icons.hardDrive, label: 'Database Health', color: 'text-emerald-400' },
      { to: '/anomaly-detection', icon: Icons.scanSearch, label: 'Anomaly Detection', color: 'text-red-400' },
      { to: '/signals', icon: Icons.activity, label: 'Live Signals', color: 'text-neon-cyan', dataTour: 'live-signals-section' },
      { to: '/admin/live-signals', icon: Icons.radioTower, label: 'Live Signal Inspector', color: 'text-cyan-400' },
      { to: '/admin/ingest-xray', icon: Icons.scanSearch, label: 'Ingest X-Ray', color: 'text-sky-400' },
      { to: '/admin/dlq', icon: Icons.severityCritical, label: 'DLQ Inspector', color: 'text-red-400' },
      { to: '/admin/flags', icon: Icons.flag, label: 'Feature Flags', color: 'text-purple-400' },
      { to: '/admin/schema-drift', icon: Icons.fingerprint, label: 'Schema Drift', color: 'text-purple-400' },
      { to: '/admin/slow-queries', icon: Icons.timer, label: 'Slow Queries', color: 'text-amber-400' },
      { to: '/admin/vehicle-cost', icon: Icons.wallet, label: 'Vehicle Cost', color: 'text-lime-400' },
      { to: '/admin/disk-forecast', icon: Icons.hardDrive, label: 'Disk Forecast', color: 'text-teal-400' },
      { to: '/admin/secret-rotation', icon: Icons.securityCheck, label: 'Secret Rotation', color: 'text-cyan-400' },
      { to: '/admin/audit-log', icon: Icons.history, label: 'Audit Log', color: 'text-indigo-400' },
      { to: '/admin/gdpr-exports', icon: Icons.hardDriveDownload, label: 'GDPR Exports', color: 'text-emerald-400' },
      { to: '/state-debugger', icon: Icons.bug, label: 'State Debugger', color: 'text-purple-400' },
      { to: '/mqtt-inspector', icon: Icons.radio, label: 'MQTT Inspector', color: 'text-blue-400' },
      { to: '/redis-signals', icon: Icons.server, label: 'Redis Signals', color: 'text-orange-400' },
      { to: '/admin/telemetry/coverage', icon: Icons.cloud, label: 'Telemetry Coverage', color: 'text-sky-400' },
      { to: '/api-logs', icon: Icons.fileText, label: 'API Logs', color: 'text-amber-400' },
      { to: '/api-playground', icon: Icons.terminal, label: 'API Playground', color: 'text-emerald-400' },
    ],
  },
  {
    title: 'About',
    items: [
      { to: '/roadmap', icon: Icons.signpost, label: 'Roadmap', color: 'text-violet-400' },
    ],
  },
]

type NavSection = (typeof navSections)[number]
type NavItem = NavSection['items'][number]

function isVisibleNavItem(item: NavItem, vehicleCount: number, isForwardAuth: boolean) {
  if ('minVehicles' in item && vehicleCount < (item as { minVehicles?: number }).minVehicles!) return false
  // Items marked `requiresAuth` are useless without a configured ForwardAuth
  // identity provider (per-user state, audit feeds, etc.) — hide them in
  // open mode rather than route the user to a 503-style empty state.
  if ('requiresAuth' in item && (item as { requiresAuth?: boolean }).requiresAuth && !isForwardAuth) return false
  return true
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
 * Header bell trigger.
 *
 * Replaced the original NavLink-only bell with `NotificationBellPopover`,
 * which renders the same bell + badge but opens an in-place triage panel
 * on desktop click (latest 10 unread + Mark-all-read + View-all). On
 * mobile (viewport ≤ 640 px) the popover is bypassed and the trigger
 * navigates straight to /notifications/inbox, preserving the original UX
 * where popover positioning would clip on narrow viewports.
 */

/**
 * Top-bar quick theme switcher.
 *
 * A small palette icon button that opens a popover containing a compact
 * `<ThemePicker>`. The popover hides the custom-color builder to keep it
 * small; users who want to build a custom theme follow the "Customize…"
 * link to /settings/appearance.
 *
 * Listens for `open-theme-popover` window events so other surfaces (the
 * command palette, the dashboard first-run banner) can open the popover
 * without prop drilling.
 */
function ThemeQuickSwitcher({
  className,
  placement = 'right',
}: {
  className?: string
  /**
   * Which side of the trigger to anchor the popover to. The popover
   * grows AWAY from the anchored side, so use 'left' when the trigger
   * sits near the left edge of the viewport (sidebar header) and
   * 'right' when it sits near the right edge (mobile header).
   */
  placement?: 'left' | 'right'
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Position is computed from the trigger's bbox so the popover can be
  // portaled into <body>. Portaling is required because the sidebar
  // (which contains the trigger) creates a stacking context via
  // backdrop-filter, and the main content area (`relative z-10`) sits
  // above it — without a portal the popover renders BEHIND dashboard
  // content that overflows into its area.
  const [coords, setCoords] = useState<{ top: number; left?: number; right?: number } | null>(null)

  // Outside-click + Escape dismissal — same pattern as SavedViewMenu.
  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (containerRef.current?.contains(target)) return
      if (popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Cross-component opener — wired by the command palette + first-run banner.
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('open-theme-popover', handler)
    return () => window.removeEventListener('open-theme-popover', handler)
  }, [])

  // Recompute popover coordinates whenever it opens or the viewport
  // changes (resize, scroll). Uses capture-phase scroll so nested
  // scroll containers also reposition the popover.
  useEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    const update = () => {
      const el = triggerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const top = rect.bottom + 8 // matches the previous mt-2 spacing
      if (placement === 'left') {
        setCoords({ top, left: rect.left })
      } else {
        setCoords({ top, right: window.innerWidth - rect.right })
      }
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, placement])

  return (
    <div ref={containerRef} className={`relative inline-block ${className ?? ''}`} data-role="theme-popover">
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('theme.openPicker', 'Open theme picker')}
        onClick={() => setOpen(v => !v)}
        className="h-9 w-9 rounded-lg p-0 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)]"
      >
        <Icons.palette className="h-5 w-5" aria-hidden="true" />
      </Button>
      {open && coords && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={t('theme.openPicker', 'Open theme picker')}
          style={{
            position: 'fixed',
            top: coords.top,
            ...(coords.left !== undefined ? { left: coords.left } : {}),
            ...(coords.right !== undefined ? { right: coords.right } : {}),
          }}
          className="z-[80] w-[22rem] max-w-[calc(100vw-1rem)] rounded-xl border border-[var(--glass-border)] bg-[var(--surface-1)] p-4 shadow-2xl"
        >
          <ThemePicker compact showMode showCustom={false} onChange={() => setOpen(false)} onModeChange={() => setOpen(false)} />
          <div className="mt-3 flex justify-end border-t border-[var(--glass-border)] pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                navigate('/settings#appearance')
              }}
              className="h-auto px-2 py-1 text-xs font-medium text-cyan-300 hover:bg-transparent hover:text-cyan-200"
            >
              {t('theme.customize', 'Customize…')}
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

export default function Layout() {
  // Sidebar style preference — localStorage-backed, cross-tab synced.
  // Defaults to 'linear'; user can change via Settings → Appearance.
  const sidebarStyle = useSidebarStyle()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    try {
      const stored = window.localStorage.getItem(EXPANDED_NAV_STORAGE_KEY)
      const parsed = stored ? JSON.parse(stored) as string[] : []
      return new Set(parsed.length > 0 ? parsed : ['Home'])
    } catch {
      return new Set(['Home'])
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
  // Browser tab badging. These three hooks
  // share the SSE singleton with `useNotificationListener` above; no
  // additional EventSource connection is opened.
  // `useDynamicAppIcon` MUST run before `useFaviconBadge` so the badge
  // composites its unread-count dot over the freshly-themed favicon
  // rather than the build-time static SVG.
  useDynamicAppIcon()
  useTitleBadge()
  useFaviconBadge()
  useCriticalAlertFlash()
  const { mode: shortcutMode, showCheatSheet, toggleCheatSheet } = useKeyboardShortcuts()
  // Footer status bar. When the user has hidden the
  // bar the main content reclaims the space — track the prefs reactively
  // so the layout reflows on toggle.
  const statusBarPrefs = useStatusBarPrefs()

  // The CommandPalette's "Show keyboard shortcuts" command (and any other
  // caller) toggles the cheat sheet by dispatching this custom event so the
  // shortcut layer stays decoupled from the React tree.
  useEffect(() => {
    const handler = () => toggleCheatSheet()
    window.addEventListener('toggle-keyboard-shortcuts', handler)
    return () => window.removeEventListener('toggle-keyboard-shortcuts', handler)
  }, [toggleCheatSheet])

  // In-app feedback modal. Same decoupled-event
  // pattern as the cheat sheet above so the Cmd+K palette ("feedback.open")
  // and the sidebar footer button can both open it without prop-drilling.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  useEffect(() => {
    const handler = () => setFeedbackOpen(true)
    window.addEventListener('open-feedback-modal', handler)
    return () => window.removeEventListener('open-feedback-modal', handler)
  }, [])

  // Onboarding tour.
  // Only one tour can be active at a time. The launcher (or a CustomEvent
  // dispatched from anywhere) sets `activeTourId`; we wire the matching
  // definition into useTour so completion is persisted under the per-tour
  // storage key. Auto-start is intentionally limited to the dashboard tour.
  const [activeTourId, setActiveTourId] = useState<string | null>(null)
  const activeTourDef = activeTourId ? TOURS[activeTourId] ?? null : null
  const tour = useTour(
    activeTourDef?.steps ?? [],
    activeTourDef ? { id: activeTourDef.id, version: activeTourDef.version } : undefined,
  )

  // DB-backed tour completion. The per-tour "seen" flags live in localStorage,
  // which is wiped when the user clears cookies/site data — so the intro tour
  // used to re-appear after every clear. Mirror the flags into the persisted
  // settings row (like theme/units) so completion survives a clear and syncs
  // across devices.
  const { data: settings, isFetched: settingsFetched } = useSettings()
  const queryClient = useQueryClient()
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const activeTourDefRef = useRef(activeTourDef)
  activeTourDefRef.current = activeTourDef

  const persistTourDone = useCallback((id: string, version: number) => {
    const base = settingsRef.current
    if (!base) return
    const token = completedTourToken(id, version)
    const current = base.completed_tours ?? []
    if (current.includes(token)) return
    const next = { ...base, completed_tours: [...current, token] }
    // Optimistically update the cache so a second tour in the same session
    // sees the first token, then persist (fire-and-forget — localStorage
    // already suppresses a re-prompt this session).
    queryClient.setQueryData(settingsKeys.settings, next)
    request('/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {})
  }, [queryClient])

  // Seed local per-tour flags from the server list so a cleared browser does
  // not re-trigger a tour the user already finished. Idempotent.
  useEffect(() => {
    if (settings?.completed_tours) seedCompletedFromServer(settings.completed_tours)
  }, [settings?.completed_tours])

  // Listen for "start tour" events from the launcher / palette / settings.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TourStartEventDetail>).detail
      if (!detail?.id || !TOURS[detail.id]) return
      setActiveTourId(detail.id)
    }
    window.addEventListener(TOUR_START_EVENT, handler)
    return () => window.removeEventListener(TOUR_START_EVENT, handler)
  }, [])

  // Cross-tab replay sync. When a sibling tab calls
  // `startTour(id)` from `@/lib/tourLauncher`, it broadcasts
  // `tour.replay-requested`. The bus filters self-broadcasts (per
  // `subscribe()` in `broadcast.ts`), so this only fires for peer tabs;
  // the originating tab already received the local `TOUR_START_EVENT`
  // CustomEvent above. Re-issue the same window event here so peer tabs
  // funnel through the existing state machine instead of duplicating it.
  useEffect(() => {
    return subscribeToBroadcast((msg) => {
      // Mirror a peer tab's completion into this tab's local flags so it does
      // not re-auto-start the same tour.
      if (msg.type === 'tour.completed') {
        markTourCompleted(msg.tourId, msg.version)
        return
      }
      if (msg.type !== 'tour.replay-requested') return
      if (!msg.tourId || !TOURS[msg.tourId]) return
      dispatchTourStart(msg.tourId)
    })
  }, [])

  // When activeTourId changes (event-triggered) start the tour.
  const tourStartRef = useRef(tour.start)
  tourStartRef.current = tour.start
  useEffect(() => {
    if (!activeTourId) return
    const timer = window.setTimeout(() => tourStartRef.current(), 50)
    return () => window.clearTimeout(timer)
  }, [activeTourId])

  // When the tour finishes / is skipped, clear activeTourId so a future
  // launch can re-trigger the same tour.
  const wasTourActiveRef = useRef(false)
  useEffect(() => {
    if (wasTourActiveRef.current && !tour.isActive) {
      // Tour just finished or was skipped — mirror completion into the DB so
      // it survives a cookies/site-data clear (useTour already wrote the local
      // flag). Then clear so a future launch can re-trigger it.
      const def = activeTourDefRef.current
      if (def) persistTourDone(def.id, def.version)
      setActiveTourId(null)
    }
    wasTourActiveRef.current = tour.isActive
  }, [tour.isActive, persistTourDone])

  // Auto-skip steps whose target element is missing (e.g. mobile hides them).
  useEffect(() => {
    if (tour.isActive && tour.step && !tour.targetRect) {
      const timer = setTimeout(() => tour.next(), 400)
      return () => clearTimeout(timer)
    }
  }, [tour.isActive, tour.currentStep, tour.targetRect])

  // Build version intentionally not fetched here; canonical provenance lives
  // in the footer <VersionSegment>.

  // Live data for sidebar
  const { data: alerts } = useQuery({ queryKey: ['alerts-sidebar'], queryFn: () => request<Alert[]>('/alerts?limit=50&offset=0'), refetchInterval: 30_000, retry: 1 })
  const { data: vehicles } = useQuery({ queryKey: ['vehicles-sidebar'], queryFn: () => request<Vehicle[]>('/vehicles'), refetchInterval: 60_000, retry: 1 })
  const unreadAlerts = alerts?.filter(a => !a.is_read).length ?? 0
  const vehicleCount = vehicles?.length ?? 0

  // Auto-start the dashboard tour the first time a user lands on `/` with at
  // least one vehicle linked. Per-feature tours stay launcher-only — see
  // `tourRegistry.TOURS[*].autoStart` for the predicate. Re-evaluates when
  // the route or fleet size changes; the per-tour completion key (versioned)
  // prevents duplicate prompts.
  useEffect(() => {
    if (activeTourId) return
    // Wait until settings have loaded (and thus the server-side completion
    // list has been seeded into localStorage) before auto-starting, so a
    // cleared browser that already finished the tour on the server does not
    // flash it again before the seed lands.
    if (!settingsFetched) return
    for (const def of Object.values(TOURS)) {
      if (!def.autoStart) continue
      if (isTourCompletedById(def.id, def.version)) continue
      if (def.autoStart({ pathname: location.pathname, vehicleCount })) {
        const timer = window.setTimeout(() => setActiveTourId(def.id), 1500)
        return () => window.clearTimeout(timer)
      }
    }
  }, [location.pathname, vehicleCount, activeTourId, settingsFetched])

  // Stale sessions count for Data Repair badge
  const { data: staleSessions } = useQuery({ queryKey: ['stale-sessions-sidebar'], queryFn: () => request<StaleSessionsResponse>('/data-repair/stale-sessions'), refetchInterval: 60_000, retry: 1 })
  const staleCount = (staleSessions?.stale_charging?.length ?? 0) + (staleSessions?.stale_drives?.length ?? 0)

  // Hide auth-gated nav items (e.g. "My Activity") when the deployment isn't
  // running behind a ForwardAuth identity provider — the underlying endpoints
  // 503 in open mode and there is nothing useful to show.
  const isForwardAuth = useIsForwardAuth()

  const activeNavEntry = useMemo(() => findNavItemByPath(location.pathname), [location.pathname])
  const activeSectionTitle = activeNavEntry?.section.title
  const activeSectionStyle = activeSectionTitle ? SECTION_ICON_STYLES[activeSectionTitle] : undefined
  const visibleNavSections = useMemo(() =>
    navSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => isVisibleNavItem(item, vehicleCount, isForwardAuth)),
      }))
      .filter(section => section.items.length > 0),
    [vehicleCount, isForwardAuth],
  )
  const pinnedNavItems = useMemo(() =>
    pinnedNavPaths
      .map(path => findNavItemByExactPath(path))
      .filter((entry): entry is { section: NavSection; item: NavItem } => Boolean(entry))
      .map(entry => entry.item)
      .filter(item => isVisibleNavItem(item, vehicleCount, isForwardAuth)),
    [pinnedNavPaths, vehicleCount, isForwardAuth],
  )
  const recentNavItems = useMemo(() =>
    recentNavPaths
      .map(path => findNavItemByExactPath(path))
      .filter((entry): entry is { section: NavSection; item: NavItem } => Boolean(entry))
      .map(entry => entry.item)
      .filter(item => isVisibleNavItem(item, vehicleCount, isForwardAuth))
      // Don't echo the current page in "Recently Used" — it's already
      // highlighted in its canonical section below, so duplicating it
      // here just adds visual noise and a confusing two-column "active"
      // indicator. Quick-jump rows for *other* recent pages remain.
      .filter(item => !isActiveNavPath(location.pathname, item.to)),
    [recentNavPaths, vehicleCount, isForwardAuth, location.pathname],
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

  // Scroll the active sidebar link into view whenever the route changes.
  // Runs on the next tick so the section-expansion effect above has a
  // chance to mount the active link before we look it up. Honours
  // `prefers-reduced-motion` and uses `block: 'nearest'` so the surrounding
  // sections stay put when the active link is already visible.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = window.requestAnimationFrame(() => {
      const sidebar = document.querySelector('[data-role="sidebar"]')
      if (!sidebar) return
      const active = sidebar.querySelector<HTMLElement>('a[aria-current="page"]')
      if (!active) return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      try {
        active.scrollIntoView({
          block: 'nearest',
          inline: 'nearest',
          // Honour prefers-reduced-motion: instant jump when the user has
          // asked for reduced motion, smooth scroll otherwise. (Both branches
          // were previously 'auto', silently discarding the `reduced` check.)
          behavior: reduced ? 'auto' : 'smooth',
        })
      } catch {
        // Older Safari throws on scrollIntoViewOptions; some headless
        // environments don't implement scrollIntoView at all. Fall back to the
        // boolean form and swallow if even that is unavailable so a missing
        // scroll primitive never breaks navigation.
        try {
          active.scrollIntoView(false)
        } catch {
          /* scrollIntoView unavailable — navigation still works without it */
        }
      }
    })
    return () => window.cancelAnimationFrame(id)
  }, [location.pathname, expandedSections])

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
  const mainRef = useRef<HTMLElement>(null)
  const renderNavLink = (item: NavItem, compact = false, activeScope = 'main') => {
    const { to, icon: Icon, label, color, ...rest } = item
    const dataTour = 'dataTour' in rest ? (rest as { dataTour?: string }).dataTour : undefined
    const isActive = isActiveNavPath(location.pathname, to)
    const isInTabBar = BOTTOM_TAB_PATHS.has(to)
    const sectionStyle = SECTION_ICON_STYLES[findNavItemByExactPath(to)?.section.title ?? '']
    return (
      <GuardedNavLink
        key={to}
        to={to}
        onClick={() => setSidebarOpen(false)}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        data-tour={dataTour}
        className={cn(
          'group relative flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm font-medium transition-all duration-normal',
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
            'relative z-10 grid shrink-0 place-items-center border border-white/[0.06] transition-all duration-normal',
            'h-7 w-7 rounded-lg',
            sectionStyle?.surface ?? 'bg-white/[0.035]',
            sectionStyle?.ring && 'ring-1',
            sectionStyle?.ring,
            isActive ? 'bg-white/[0.09] ring-white/20' : 'group-hover:bg-white/[0.07] group-hover:ring-white/15'
          )}
        >
          <Icon className={cn('h-4 w-4 transition-all duration-normal', color, isActive ? 'opacity-100 drop-shadow-[0_0_8px_currentColor]' : 'opacity-75 group-hover:opacity-100')} />
        </span>
        <span className={cn('relative z-10 min-w-0 truncate transition-colors', isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]')}>
          {navLabel(label)}
        </span>
        {to === '/notifications/alerts' && unreadAlerts > 0 && (
          <span className="relative z-10 ms-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-red/20 px-1.5 text-2xs font-bold text-neon-red ring-1 ring-neon-red/30">
            {unreadAlerts > 9 ? '9+' : unreadAlerts}
          </span>
        )}
        {to === '/vehicles' && vehicles && vehicles.length > 0 && (
          <span className="relative z-10 ms-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-cyan/10 px-1.5 text-2xs font-bold text-neon-cyan ring-1 ring-neon-cyan/20">
            {vehicles.length}
          </span>
        )}
        {to === '/data-repair' && staleCount > 0 && (
          <span className="relative z-10 ms-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neon-amber/20 px-1.5 text-2xs font-bold text-neon-amber ring-1 ring-neon-amber/30">
            {staleCount > 9 ? '9+' : staleCount}
          </span>
        )}
        {isActive && !compact && (
          <span className="absolute end-3 h-1.5 w-1.5 rounded-full bg-neon-cyan shadow-[0_0_6px_rgba(0,240,255,0.5)]" />
        )}
      </GuardedNavLink>
    )
  }

  return (
    <>
      {/* Skip to content (WCAG 2.4.1). MUST be the very first interactive
          element in the DOM so a single Tab press from page load reveals
          it before any sidebar / header / banner control. Supersedes the
          previous `a11y.skipToMain` link.
          Audit anchor: skipToContent|skip.to.content */}
      <SkipToContent />
      <BreadcrumbOverridesProvider>
      <div className="flex h-dvh bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Global SR announcer. Mounted once here
          so any component can fire imperative live-region messages via
          `useAnnouncer()` without rendering its own hidden region. */}
      <AnnouncerRegion />

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
            // Not migrated to <Modal>.
            // Rationale: drawer scrim — pure backdrop with no content. Pairs
            // with the <aside> sidebar (drawer pattern), not a dialog. New
            // interactive dialogs MUST use <Modal>.
            // eslint-disable-next-line no-restricted-syntax
            className="fixed inset-0 z-[65] bg-[var(--bg-app)] backdrop-blur-sm dark:bg-[var(--surface-overlay)] lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        role="navigation"
        aria-label={t('a11y.primaryNav', 'Primary')}
        data-tour="sidebar"
        data-role="sidebar"
        data-sidebar-open={sidebarOpen}
        className={cn(
          'fixed start-0 bottom-0 z-[66] w-[clamp(240px,70vw,256px)] transform transition-transform duration-normal ease-out lg:top-0 lg:static lg:z-auto lg:w-64 lg:translate-x-0',
          'flex flex-col border-r border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-2xl backdrop-blur-xl lg:shadow-none',
          sidebarOpen ? 'top-0 translate-x-0' : 'top-14 -translate-x-full',
          // Reserve space for the fixed footer StatusBar
          // so the bottom "Take a tour / Report bug" row never slides under
          // it. Mobile open-state already overlays StatusBar (sidebar z-66 >
          // StatusBar z-55), so the reservation only matters on desktop where
          // the sidebar is `lg:static` and shares layout space with <main>.
          statusBarPrefs.enabled && 'lg:pb-7'
        )}
      >
        {/* Mobile sidebar brand. Build version intentionally not rendered
            here; canonical provenance lives in the footer <VersionSegment>. */}
        <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-5 py-4 shrink-0 lg:hidden">
          <GuardedNavLink to="/" className="min-w-0 flex flex-1 items-center gap-3 rounded-xl transition-colors" onClick={() => setSidebarOpen(false)}>
            <Logo size={32} showWordmark />
          </GuardedNavLink>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('nav.closeSidebar', 'Close sidebar')}
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(false)}
            className="h-10 w-10 shrink-0 rounded-xl p-0 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
          >
            <Icons.close className="h-5 w-5" />
          </Button>
        </div>

        {/* Logo — desktop sidebar header. Build version intentionally not
            rendered here; canonical provenance lives in the footer
            <VersionSegment>. */}
        <div className="hidden lg:flex items-center gap-2 px-5 py-5 border-b border-[var(--glass-border)] shrink-0">
          <GuardedNavLink to="/" className="flex flex-1 items-center gap-3 hover:bg-[var(--surface-2)] -mx-2 px-2 py-1 rounded-md transition-colors" onClick={() => setSidebarOpen(false)}>
            <Logo size={32} showWordmark />
          </GuardedNavLink>
          <ThemeQuickSwitcher placement="left" />
          <NotificationBellPopover />
        </div>

        {/* Sticky search trigger */}
        <div className="px-3 py-2 lg:px-4 lg:py-3 border-b border-[var(--glass-border)] shrink-0">
          <CommandPaletteTrigger />
        </div>

        {/* Persistent vehicle scope picker.
            Renders its own bordered wrapper; returns null for single-vehicle
            owners so no empty padding is visible. */}
        <VehiclePicker />

        {/* Navigation */}
        {sidebarStyle === 'linear' ? (
          <LinearSidebar
            sections={visibleNavSections}
            pinnedItems={pinnedNavItems}
            pathname={location.pathname}
            navLabel={navLabel}
            onPin={pinNavPath}
            onUnpin={unpinNavPath}
            onItemSelect={() => setSidebarOpen(false)}
            activeSectionTitle={activeSectionTitle}
            alertCount={unreadAlerts}
            vehicleCount={vehicleCount}
            staleCount={staleCount}
          />
        ) : sidebarStyle === 'notion' ? (
          <NotionSidebar
            sections={visibleNavSections}
            pinnedItems={pinnedNavItems}
            pathname={location.pathname}
            navLabel={navLabel}
            onPin={pinNavPath}
            onUnpin={unpinNavPath}
            onItemSelect={() => setSidebarOpen(false)}
            activeSectionTitle={activeSectionTitle}
            alertCount={unreadAlerts}
            vehicleCount={vehicleCount}
            staleCount={staleCount}
          />
        ) : (
        <nav
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-2 lg:py-4 px-3 space-y-3 scrollbar-thin"
          style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', overscrollBehaviorY: 'contain' }}
        >
          {activeNavEntry && (
            <div
              className={cn(
                'rounded-2xl border border-[var(--glass-border)] px-3 py-2 ring-1',
                activeSectionStyle?.surface ?? 'bg-[rgba(var(--theme-primary-rgb),0.07)]',
                activeSectionStyle?.ring ?? 'ring-[rgba(var(--theme-primary-rgb),0.18)]',
              )}
              aria-label={t('nav.currentSection', 'Current')}
            >
              <div className="flex items-center gap-2">
                <p
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]"
                  title={`${navLabel(activeNavEntry.item.label)} — ${activeNavEntry.section.title}`}
                >
                  {navLabel(activeNavEntry.item.label)}
                </p>
                {activeNavPath && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={activeIsPinned}
                    aria-label={activeIsPinned ? t('nav.unpinCurrent', 'Remove current page from pinned') : t('nav.pinCurrent', 'Pin current page')}
                    onClick={() => activeIsPinned ? unpinNavPath(activeNavPath) : pinNavPath(activeNavPath)}
                    className={cn(
                      'h-7 shrink-0 rounded-lg px-2 text-xs hover:bg-white/[0.08]',
                      activeIsPinned ? 'text-amber-300' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    <Icons.star className={cn('h-3.5 w-3.5', activeIsPinned && 'fill-current')} />
                    <span>{activeIsPinned ? t('nav.pinnedAction', 'Pinned') : t('nav.pinAction', 'Pin')}</span>
                  </Button>
                )}
              </div>
            </div>
          )}

          {pinnedNavItems.length > 0 && (
            <div>
              <NavSectionHeader
                id="nav-pinned-label"
                label={t('nav.pinned', 'Pinned')}
              />
              <div className="space-y-0.5" aria-labelledby="nav-pinned-label">
                {pinnedNavItems.map(item => (
                  <div key={item.to} className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      {renderNavLink(item, true, 'pinned')}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('nav.unpinPage', { page: navLabel(item.label), defaultValue: 'Unpin {{page}}' })}
                      onClick={() => unpinNavPath(item.to)}
                      className="h-7 w-7 shrink-0 rounded-lg p-0 text-[var(--text-muted)] opacity-80 hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                    >
                      <Icons.close className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {SHOW_RECENTLY_USED_NAV && recentNavItems.length > 0 && (
            <div>
              <NavSectionHeader
                id="nav-recent-label"
                label={t('nav.recentlyUsed', 'Recently Used')}
              />
              <div className="space-y-0.5" aria-labelledby="nav-recent-label">
                {recentNavItems.map(item => renderNavLink(item, true, 'recent'))}
              </div>
            </div>
          )}

          <div className="space-y-1" aria-labelledby="nav-sections-label">
            <NavSectionHeader
              id="nav-sections-label"
              label={t('nav.sections', 'Sections')}
              action={
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('nav.expandAll', 'Expand all sections')}
                    title={t('nav.expandAll', 'Expand all sections')}
                    disabled={expandedSectionCount === visibleNavSections.length}
                    onClick={expandAllSections}
                    className="h-6 w-6 shrink-0 rounded p-0 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    <Icons.expandAll className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('nav.collapseAll', 'Collapse all sections')}
                    title={t('nav.collapseAll', 'Collapse all sections')}
                    disabled={expandedSectionCount === 0}
                    onClick={collapseAllSections}
                    className="h-6 w-6 shrink-0 rounded p-0 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] disabled:opacity-40"
                  >
                    <Icons.collapseAll className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              }
            />
            {visibleNavSections.map(section => {
              const isExpanded = expandedSections.has(section.title)
              const isActiveSection = section.title === activeSectionTitle
              const sectionStyle = SECTION_ICON_STYLES[section.title]
              const SectionIcon = sectionStyle?.icon ?? Icons.sparkles
              return (
                <div key={section.title} className="mt-3 first:mt-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-expanded={isExpanded}
                    aria-controls={`nav-section-${section.title.replace(/\W+/g, '-').toLowerCase()}`}
                    onClick={() => toggleSection(section.title)}
                    className={cn(
                      'group/section relative mb-1.5 flex h-7 w-full items-center justify-between gap-2 rounded-md px-1.5 hover:bg-transparent'
                    )}
                  >
                    {isActiveSection && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'pointer-events-none absolute inset-x-0 -inset-y-0.5 rounded-md bg-gradient-to-r opacity-80',
                          sectionStyle?.gradient ?? 'from-[rgba(var(--theme-primary-rgb),0.18)] via-[rgba(var(--theme-primary-rgb),0.05)] to-transparent'
                        )}
                      />
                    )}
                    <span className="relative z-10 flex min-w-0 flex-1 items-center gap-2">
                      <SectionIcon
                        className={cn(
                          'h-3 w-3 shrink-0 transition-all duration-200',
                          sectionStyle?.accent ?? 'text-neon-cyan',
                          isActiveSection && 'drop-shadow-[0_0_6px_currentColor]'
                        )}
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          'truncate text-2xs font-bold uppercase tracking-[0.16em] transition-colors',
                          sectionStyle?.accent ?? 'text-[var(--text-secondary)]',
                          isActiveSection ? 'opacity-100' : 'opacity-85 group-hover/section:opacity-100'
                        )}
                        title={section.title}
                      >
                        {section.title}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'ms-1 h-px flex-1 bg-gradient-to-r from-black/15 to-transparent transition-opacity dark:from-white/15',
                          isActiveSection ? 'opacity-60' : 'opacity-25 group-hover/section:opacity-40'
                        )}
                      />
                    </span>
                    <span className="relative z-10 flex shrink-0 items-center gap-1.5">
                      <span
                        className={cn(
                          'flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-2xs font-semibold tabular-nums',
                          isActiveSection
                            ? cn(sectionStyle?.surface ?? 'bg-white/[0.08]', sectionStyle?.accent ?? 'text-[var(--text-primary)]')
                            : 'bg-black/[0.05] text-[var(--text-muted)] dark:bg-white/[0.04]'
                        )}
                      >
                        {section.items.length}
                      </span>
                      <Icons.expand
                        className={cn(
                          'h-3 w-3 transition-transform',
                          isActiveSection ? (sectionStyle?.accent ?? 'text-[var(--text-primary)]') : 'text-[var(--text-muted)]',
                          isExpanded && 'rotate-180'
                        )}
                      />
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
        )}

        {/* Sidebar footer note:
            "Press ? for shortcuts · Take a tour · Report bug" was moved to
            the global StatusBar (`HelpSegment`) so the sidebar bottom is no
            longer reserved for ambient help affordances. The previous
            "Update available" banner, "Live vehicle mini-status", and
            "Connection / vehicles / uptime" panels were already removed
            because their info is surfaced in the StatusBar (VersionSegment
            shows the update dot + uptime, ConnectionSegment shows API
            status, ActiveVehicleSegment shows the active vehicle). */}
      </aside>

      {/* Mobile top bar */}
      {!sidebarOpen && (
        <header data-role="appbar" role="banner" aria-label={t('a11y.primaryHeader', 'Site header')} className="fixed inset-x-0 top-0 z-[60] flex items-center border-b border-[var(--glass-border)] bg-[var(--surface-1)] backdrop-blur-xl px-4 py-3 lg:hidden [touch-action:manipulation]">
          <Button
            onClick={() => setSidebarOpen(true)}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t('nav.openSidebar', 'Open sidebar')}
            aria-expanded={false}
            className="relative z-10 h-11 w-11 -ml-1 rounded-xl p-0 text-[var(--text-secondary)] hover:bg-white/[0.08] hover:text-[var(--text-primary)] active:scale-95 [-webkit-tap-highlight-color:transparent] [touch-action:manipulation]"
          >
            <Icons.menu className="h-6 w-6" />
          </Button>
          <div className="flex-1 flex justify-center -ml-10">
            <Logo size={26} showWordmark />
          </div>
          <NotificationBellPopover className="ms-auto" />
          <ThemeQuickSwitcher />
        </header>
      )}

      {/* Main content */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Spacer for fixed mobile header */}
        <div className="h-14 shrink-0 lg:hidden" />

        {/* Browser-compat warning — topmost banner
            in the main content column so users on outdated browsers see
            WHY the SPA is breaking instead of staring at a white page.
            Sits BELOW the SkipToContent link in DOM order so keyboard
            users still hit the WCAG bypass-blocks link first. */}
        <BrowserCompatBanner />
        {/* Time-machine "viewing data as of …" banner — visible only
            when ?as_of= is set or the inline picker is
            open. Stacked between BrowserCompatBanner and ServiceStatusBanner
            so the historical-mode warning sits at the top of the main
            content column without displacing the higher-priority compat
            and service status notices. */}
        <TimeMachineBanner />
        <ServiceStatusBanner />
        <main
          id="main-content"
          data-role="main-content"
          ref={mainRef}
          role="main"
          tabIndex={-1}
          className={cn(
            'flex-1 overflow-y-auto outline-none pb-16 lg:pb-0',
            // Reserve space for the footer status bar
            // so it never overlaps page content. On mobile it stacks ABOVE
            // the BottomTabBar (which already adds 56px via pb-16), so we
            // bump pb-16 → pb-20 (24px footer + tab bar). On desktop a
            // single 28px reservation is enough.
            statusBarPrefs.enabled && 'lg:pb-7 pb-20',
          )}
        >
          <div className="w-full px-3 py-4 pb-safe sm:px-5 sm:py-5 lg:px-8 lg:py-8 2xl:px-10 3xl:px-12">
            {activeNavEntry && (
              <div className="mb-3 flex min-h-8 items-center justify-between gap-3 border-b border-white/[0.06] pb-2">
                <LayoutBreadcrumbs className="min-w-0 text-xs" />
                <p className="hidden shrink-0 text-2xs text-[var(--text-muted)] lg:block">
                  {t('nav.quickSearchHint', 'Ctrl+K to jump')}
                </p>
              </div>
            )}
            <RouteTransition>
              <Outlet />
            </RouteTransition>
          </div>
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <BottomTabBar />

      {/* Footer status bar — always-on health/version
          surface pinned to the bottom of the viewport. Hides itself when the
          user toggles it off in Settings → Appearance. */}
      <StatusBar />

      {/* Command Palette */}
      <CommandPalette onOpen={() => setSidebarOpen(false)} />

      {/* PWA Install Prompt */}
      <InstallPrompt />

      {/* Route-change / mutation progress bar —
          mounted ABOVE every banner so the slim 2 px strip at the very
          top of the viewport is never occluded by a stacked banner.
          Activated by SuspenseProgressBoundary at every lazy() route
          boundary in App.tsx, plus opt-in useGlobalProgress() in
          long-running mutations. */}
      <TopProgress />

      {/* Offline status banner (PWA / mobile) */}
      <OfflineBanner />

      {/* Impersonation banner — security context,
          highest priority. Mounted ABOVE every other banner because an
          admin viewing the app as another subject must see the
          impersonation flag at all times; everything else (maintenance,
          rate-limit, etc.) is secondary while a session is active. */}
      <ImpersonationBanner />

      {/* Service-mode banner — operator-controlled
          maintenance/degraded banner. Mounted ABOVE the rate-limit and
          version banners because an operator-declared outage is the
          highest-priority operational message and should not be hidden
          under transient client-side notices. */}
      <MaintenanceBanner />

      {/* Rate-limit / circuit-breaker banner —
          most-transient surface, sits on top so the user sees the
          countdown before any of the slower-cycling banners. Stack
          order from top to bottom: rate-limit → tesla-reauth →
          new-version. Each banner is ≤ 48 px tall so the stack stays
          under 144 px even when all three fire simultaneously. */}
      <RateLimitBanner />

      {/* New-version banner — proactive reload nudge
          when the backend redeploys mid-session, before the next chunk-load
          failure surfaces as an ErrorBoundary fallback. */}
      <NewVersionBanner />

      {/* Tesla third-party token expiry banner —
          sticky top-of-page recovery surface for the partial-failure case
          where Tesla-backed calls 401 but non-Tesla data still loads. */}
      <TeslaReauthBanner />

      {/* ForwardAuth session-expiry modals —
          SessionExpiringModal opens ~60s before the proxy cookie ages
          out (soft-dismissible countdown with unsaved-draft list).
          SessionExpiredModal hard-blocks the UI when the cookie has
          actually expired (or any API call returned 401), preserving
          the current URL so the user can resume after re-auth.
          Both are no-ops in open mode (no FORWARD_AUTH_HEADER). */}
      <SessionExpiringModal />
      <SessionExpiredModal />

      {/* Keyboard shortcut overlays */}
      <GlobalShortcuts />
      <GotoIndicator visible={shortcutMode === 'goto'} />
      <KeyboardShortcutsModal open={showCheatSheet} onClose={toggleCheatSheet} />

      {/* In-app feedback modal — opened via the
          sidebar footer button, the Cmd+K palette ("feedback.open"
          command), or any other surface that dispatches the
          `open-feedback-modal` window event. */}
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

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

      {/* Tour launcher — opens via TOUR_OPEN_LAUNCHER_EVENT */}
      <TourLauncher />

      {/* "What's new since last visit" modal — auto-shows
          once-per-24h after the OnboardingWizard, or on demand via the command
          palette ("What's new") and footer status bar version segment. */}
      <ChangelogModal />

      {/* Surfaces unsaved form drafts after a
          tab close, browser crash, PWA reload, or auth redirect. The
          component is a no-op when no drafts exist and self-throttles
          via a per-session sessionStorage flag. */}
      <DraftRestorePrompt />

      {/* Cookie / GDPR consent banner. Renders
          ONLY when the deployment opts in via TESLASYNC_REQUIRE_COOKIE_CONSENT
          (default OFF on self-hosted installs) AND the user has not
          recorded a decision. Mounted last so the bottom-of-screen
          banner sits above every sticky surface but below modal
          dialogs the user is interacting with. */}
      <CookieConsentBanner />
      </div>
      </BreadcrumbOverridesProvider>
    </>
  )
}
