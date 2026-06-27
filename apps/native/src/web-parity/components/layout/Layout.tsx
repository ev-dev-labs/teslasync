// Native parity port of web/src/components/layout/Layout.tsx.
//
// The web file is the top-level application shell: a react-router-dom <Outlet>
// host wrapped by a collapsible sidebar (Home/Vehicles/Driving/... sections),
// a mobile drawer + top bar, a stack of operational banners
// (Offline/Maintenance/RateLimit/NewVersion/TeslaReauth/Impersonation/...),
// session-expiry modals, the Cmd+K command palette, the onboarding tour engine,
// keyboard-shortcut overlays, and per-tab badge/favicon side effects. It also
// owns the durable sidebar nav state: which sections are expanded, which pages
// are pinned, and a "recently used" MRU list, all persisted to localStorage and
// synced across browser tabs.
//
// What ports 1:1 (the genuinely portable core, preserved verbatim here):
//   - navI18nKeys (intentionally empty — labels render as authored).
//   - navSearchKeywords (every command-palette keyword map entry).
//   - DEFAULT_PINNED_NAV_PATHS / MAX_PINNED_NAV_ITEMS / MAX_RECENT_NAV_ITEMS and
//     the three localStorage key constants.
//   - SECTION_ICON_STYLES (every section's accent/surface/ring/dot/gradient
//     class tokens are kept verbatim as data for visual-intent parity; the web
//     `icon: typeof Icons.home` component reference becomes a SemanticIconName).
//   - SHOW_RECENTLY_USED_NAV feature flag (still false).
//   - navSections — the full Home..About navigation tree, every { to, icon,
//     label, color } plus minVehicles / requiresAuth / dataTour flags.
//   - isVisibleNavItem / isActiveNavPath / findNavItemByPath /
//     findNavItemByExactPath — pure routing helpers, behaviour-identical.
//   - The sidebar nav state machine (expanded sections, pinned + recent paths,
//     toggle/expand-all/collapse-all/pin/unpin, active-section auto-expand,
//     recent-MRU recording) lives in useSidebarNavState() below with the same
//     state names and persistence-key constants.
//   - The realtime-alert -> toast decision logic (severity -> toast type, and
//     the "build a drill-through href only when created_at|rule_signal|
//     vehicle_id is known" branch) lives in deriveAlertToast().
//   - The canonical sidebar useQuery descriptors (query keys, API paths,
//     refetch intervals) are kept verbatim in SIDEBAR_QUERIES.
//
// Native adaptations (every reduction is documented in BROWSER_ONLY_ADAPTATIONS
// below and in the .parity.json sidecar):
//   - react-router-dom (Outlet/useLocation/useNavigate) has no native analog:
//     the active path arrives as the `currentPath` prop, navigation is delegated
//     to the `onNavigate` bridge prop, and <Outlet> becomes the `children` prop
//     (the route content the native navigator renders into the shell).
//   - @tanstack/react-query useQuery sidebar fetches: the alerts / vehicles /
//     stale-sessions live data arrives as props (alerts / vehicles /
//     staleSessions) so the shell renders deterministically; SIDEBAR_QUERIES
//     preserves the exact query keys, paths, and 30s/60s refetch cadences a host
//     wires into the native query layer.
//   - localStorage + the cross-tab `storage` event: React Native has no Web
//     Storage API, so the persisted nav preferences use an in-process Map
//     (navPreferenceStore) that mirrors localStorage's read/write/try-catch
//     shape and lives for the app process (a real host swaps in AsyncStorage).
//   - framer-motion (motion/AnimatePresence layout animations), createPortal,
//     window CustomEvents, getBoundingClientRect popover coords, scrollIntoView,
//     matchMedia, document.querySelector, and every DOM-only banner/modal/overlay
//     sub-component are represented by the documented LAYOUT_GLOBAL_SURFACES /
//     BROWSER_ONLY_ADAPTATIONS panels instead of being imported (they are
//     browser-only and/or separately ported feedback components).
//   - lucide-style Icons.* become SemanticIcon glyphs; the Helix brand mark
//     keeps its dedicated native HelixMark via the item's brandMark flag.
//   - i18n: react-i18next useTranslation() -> a native t(key, default, params)
//     fallback that interpolates {{name}} placeholders, preserving every key +
//     default string the web shell passes.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {StatusPill} from '../../../components/ui/StatusPill';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../components/icons/SemanticIcon';
import {HelixMark} from '../branding/HelixMark';
import type {Alert, StaleSessionsResponse, Vehicle} from '../../api/types';

// ---------------------------------------------------------------------------
// i18n fallback (react-i18next has no native runtime in the parity layer).
// ---------------------------------------------------------------------------

type NativeTParams = Record<string, string | number>;

export type NativeTFunction = (
  key: string,
  fallback: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, params?: NativeTParams) =>
      interpolate(fallback, params),
    [],
  );
}

// ---------------------------------------------------------------------------
// navI18nKeys — kept empty so sidebar labels render verbatim from navSections.
// (The legacy key map accidentally rewrote descriptive labels back to short
// legacy strings; keeping it empty means `label` is always shown as authored.)
// ---------------------------------------------------------------------------

const navI18nKeys: Record<string, string> = {};

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
};

const DEFAULT_PINNED_NAV_PATHS = ['/', '/digital-twin', '/vehicles', '/charging', '/live'];
const MAX_PINNED_NAV_ITEMS = 8;
const MAX_RECENT_NAV_ITEMS = 3;
const EXPANDED_NAV_STORAGE_KEY = 'teslasync-expanded-nav-sections';
const RECENT_NAV_STORAGE_KEY = 'teslasync-recent-nav-paths';
const PINNED_NAV_STORAGE_KEY = 'teslasync-pinned-nav-paths';

interface SectionIconStyle {
  accent: string;
  surface: string;
  ring: string;
  dot: string;
  icon: SemanticIconName;
  gradient: string;
}

// Section accent tokens preserved verbatim from web for visual-intent parity.
// The web `icon` was a lucide component reference; here it is the matching
// SemanticIconName so the native SemanticIcon renders the same intent.
const SECTION_ICON_STYLES: Record<string, SectionIconStyle> = {
  Home:          {accent: 'text-sky-700 dark:text-sky-300',         surface: 'bg-sky-400/10',     ring: 'ring-sky-400/20',     dot: 'bg-sky-400',     icon: 'home',            gradient: 'from-sky-500/20 via-sky-400/5 to-transparent'},
  Vehicles:      {accent: 'text-cyan-700 dark:text-cyan-300',       surface: 'bg-cyan-400/10',    ring: 'ring-cyan-400/20',    dot: 'bg-cyan-400',    icon: 'vehicle',         gradient: 'from-cyan-500/20 via-cyan-400/5 to-transparent'},
  Driving:       {accent: 'text-violet-700 dark:text-violet-300',   surface: 'bg-violet-400/10',  ring: 'ring-violet-400/20',  dot: 'bg-violet-400',  icon: 'drive',           gradient: 'from-violet-500/25 via-violet-400/8 to-transparent'},
  Charging:      {accent: 'text-emerald-700 dark:text-emerald-300', surface: 'bg-emerald-400/10', ring: 'ring-emerald-400/20', dot: 'bg-emerald-400', icon: 'batteryCharging', gradient: 'from-emerald-500/20 via-emerald-400/5 to-transparent'},
  Battery:       {accent: 'text-amber-700 dark:text-amber-300',     surface: 'bg-amber-400/10',   ring: 'ring-amber-400/20',   dot: 'bg-amber-400',   icon: 'battery',         gradient: 'from-amber-500/20 via-amber-400/5 to-transparent'},
  Energy:        {accent: 'text-lime-700 dark:text-lime-300',       surface: 'bg-lime-400/10',    ring: 'ring-lime-400/20',    dot: 'bg-lime-400',    icon: 'bolt',            gradient: 'from-lime-500/20 via-lime-400/5 to-transparent'},
  Service:       {accent: 'text-rose-700 dark:text-rose-300',       surface: 'bg-rose-400/10',    ring: 'ring-rose-400/20',    dot: 'bg-rose-400',    icon: 'maintenance',     gradient: 'from-rose-500/20 via-rose-400/5 to-transparent'},
  Reports:       {accent: 'text-green-700 dark:text-green-300',     surface: 'bg-green-400/10',   ring: 'ring-green-400/20',   dot: 'bg-green-400',   icon: 'analytics',       gradient: 'from-green-500/20 via-green-400/5 to-transparent'},
  Cabin:         {accent: 'text-sky-700 dark:text-sky-300',         surface: 'bg-sky-400/10',     ring: 'ring-sky-400/20',     dot: 'bg-sky-400',     icon: 'cabin',           gradient: 'from-sky-500/20 via-sky-400/5 to-transparent'},
  Commands:      {accent: 'text-fuchsia-700 dark:text-fuchsia-300', surface: 'bg-fuchsia-400/10', ring: 'ring-fuchsia-400/20', dot: 'bg-fuchsia-400', icon: 'gamepad',         gradient: 'from-fuchsia-500/20 via-fuchsia-400/5 to-transparent'},
  Controls:      {accent: 'text-fuchsia-700 dark:text-fuchsia-300', surface: 'bg-fuchsia-400/10', ring: 'ring-fuchsia-400/20', dot: 'bg-fuchsia-400', icon: 'gamepad',         gradient: 'from-fuchsia-500/20 via-fuchsia-400/5 to-transparent'},
  Automation:    {accent: 'text-purple-700 dark:text-purple-300',   surface: 'bg-purple-400/10',  ring: 'ring-purple-400/20',  dot: 'bg-purple-400',  icon: 'workflow',        gradient: 'from-purple-500/25 via-purple-400/8 to-transparent'},
  Notifications: {accent: 'text-orange-700 dark:text-orange-300',   surface: 'bg-orange-400/10',  ring: 'ring-orange-400/20',  dot: 'bg-orange-400',  icon: 'notifications',   gradient: 'from-orange-500/20 via-orange-400/5 to-transparent'},
  Security:      {accent: 'text-yellow-700 dark:text-yellow-300',   surface: 'bg-yellow-400/10',  ring: 'ring-yellow-400/20',  dot: 'bg-yellow-400',  icon: 'security',        gradient: 'from-yellow-500/20 via-yellow-400/5 to-transparent'},
  Account:       {accent: 'text-blue-700 dark:text-blue-300',       surface: 'bg-blue-400/10',    ring: 'ring-blue-400/20',    dot: 'bg-blue-400',    icon: 'user',            gradient: 'from-blue-500/20 via-blue-400/5 to-transparent'},
  Integrations:  {accent: 'text-pink-700 dark:text-pink-300',       surface: 'bg-pink-400/10',    ring: 'ring-pink-400/20',    dot: 'bg-pink-400',    icon: 'link',            gradient: 'from-pink-500/20 via-pink-400/5 to-transparent'},
  Settings:      {accent: 'text-slate-700 dark:text-slate-300',     surface: 'bg-slate-400/10',   ring: 'ring-slate-400/20',   dot: 'bg-slate-400',   icon: 'settings',        gradient: 'from-slate-500/20 via-slate-400/5 to-transparent'},
  Data:          {accent: 'text-teal-700 dark:text-teal-300',       surface: 'bg-teal-400/10',    ring: 'ring-teal-400/20',    dot: 'bg-teal-400',    icon: 'database',        gradient: 'from-teal-500/20 via-teal-400/5 to-transparent'},
  Diagnostics:   {accent: 'text-cyan-700 dark:text-neon-cyan',      surface: 'bg-cyan-400/10',    ring: 'ring-cyan-400/20',    dot: 'bg-neon-cyan',   icon: 'activity',        gradient: 'from-cyan-500/25 via-cyan-400/8 to-transparent'},
  About:         {accent: 'text-slate-600 dark:text-[var(--text-secondary)]', surface: 'bg-[var(--surface-2)]', ring: 'ring-white/10', dot: 'bg-[var(--surface-2)]', icon: 'info', gradient: 'from-white/[0.06] via-white/[0.02] to-transparent'},
};

// Feature switch for the sidebar "Recently Used" surface — disabled per UX
// review (duplicated items across Pinned + Recently Used + canonical section
// added noise). Recent-page tracking itself still runs; only the sidebar render
// is muted. Kept so it can be flipped back to `true` without a diff.
const SHOW_RECENTLY_USED_NAV = false;

export interface NavItem {
  to: string;
  icon: SemanticIconName;
  label: string;
  color: string;
  /** Items flagged 'helix' render the dedicated HelixMark brand glyph. */
  brandMark?: 'helix';
  dataTour?: string;
  minVehicles?: number;
  requiresAuth?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: 'Home',
    items: [
      {to: '/', icon: 'layoutDashboard', label: 'Dashboard', color: 'text-blue-400'},
      {to: '/explore', icon: 'sparkles', label: 'Explore Features', color: 'text-amber-400'},
      {to: '/live', icon: 'radar', label: 'Live Map', color: 'text-emerald-400'},
      {to: '/timeline', icon: 'clock', label: 'Timeline', color: 'text-sky-400'},
      {to: '/weekly-digest', icon: 'calendarCheck', label: 'Weekly Digest', color: 'text-purple-400'},
    ],
  },
  {
    title: 'Vehicles',
    items: [
      {to: '/vehicles', icon: 'vehicle', label: 'My Vehicles', color: 'text-sky-400', dataTour: 'vehicle-section'},
      {to: '/digital-twin', icon: 'monitor', label: 'Vehicle Live View', color: 'text-cyan-400'},
      {to: '/vehicle-comparison', icon: 'arrowLeftRight', label: 'Compare Vehicles', color: 'text-orange-400', minVehicles: 2},
      {to: '/locations', icon: 'location', label: 'Saved Locations', color: 'text-emerald-400'},
    ],
  },
  {
    title: 'Driving',
    items: [
      {to: '/drives', icon: 'drive', label: 'Drives', color: 'text-violet-400'},
      {to: '/trips', icon: 'trip', label: 'Trips', color: 'text-teal-400'},
      {to: '/trip-planner', icon: 'mapPinned', label: 'Trip Planner', color: 'text-emerald-400'},
      {to: '/navigation', icon: 'signpost', label: 'Navigation', color: 'text-teal-400'},
      {to: '/geofences', icon: 'fence', label: 'Geofences', color: 'text-lime-400'},
      {to: '/mileage', icon: 'trip', label: 'Mileage Log', color: 'text-teal-400'},
      {to: '/lifetime-stats', icon: 'award', label: 'Lifetime Stats', color: 'text-yellow-400'},
      {to: '/drive-score', icon: 'trophy', label: 'Drive Score', color: 'text-yellow-400'},
      {to: '/speed-profile', icon: 'speed', label: 'Speed Profile', color: 'text-rose-400'},
      {to: '/driving-dynamics', icon: 'efficiency', label: 'Driving Dynamics', color: 'text-red-400'},
      {to: '/regen-efficiency', icon: 'recycle', label: 'Regen Braking', color: 'text-green-400'},
      {to: '/route-efficiency', icon: 'navigationAlt', label: 'Route Efficiency', color: 'text-emerald-400'},
    ],
  },
  {
    title: 'Charging',
    items: [
      {to: '/charging', icon: 'batteryCharging', label: 'Charging Overview', color: 'text-green-400'},
      {to: '/tesla-charging-history', icon: 'receipt', label: 'Charge History', color: 'text-emerald-400'},
      {to: '/charging-curve', icon: 'trendUp', label: 'Charging Curve', color: 'text-lime-400'},
      {to: '/charging-heatmap', icon: 'calendarClock', label: 'Charging Patterns', color: 'text-cyan-400'},
      {to: '/smart-charge', icon: 'calendarClock', label: 'Smart Charging', color: 'text-cyan-400'},
      {to: '/powershare', icon: 'charging', label: 'Powershare', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Battery',
    items: [
      {to: '/battery', icon: 'heartPulse', label: 'Battery Health', color: 'text-rose-400'},
      {to: '/battery-cells', icon: 'battery', label: 'Battery Cells', color: 'text-purple-400'},
      {to: '/battery-degradation', icon: 'trendDown', label: 'Battery Degradation', color: 'text-orange-400'},
      {to: '/projected-range', icon: 'target', label: 'Projected Range', color: 'text-pink-400'},
      {to: '/vampire-drain', icon: 'moon', label: 'Vampire Drain', color: 'text-indigo-400'},
      {to: '/sleep-efficiency', icon: 'bedDouble', label: 'Sleep Efficiency', color: 'text-purple-400'},
    ],
  },
  {
    title: 'Energy',
    items: [
      {to: '/energy', icon: 'bolt', label: 'Energy Usage', color: 'text-yellow-400'},
      {to: '/energy-flow', icon: 'arrowRightLeft', label: 'Energy Flow', color: 'text-yellow-400'},
      {to: '/power-flow', icon: 'charging', label: 'Power Flow', color: 'text-orange-400'},
      {to: '/energy-products', icon: 'home', label: 'Solar & Powerwall', color: 'text-lime-400'},
    ],
  },
  {
    title: 'Service',
    items: [
      {to: '/tire-pressure', icon: 'tirePressure', label: 'Tire Pressure', color: 'text-orange-400'},
      {to: '/drivetrain-health', icon: 'cpu', label: 'Drivetrain Health', color: 'text-red-400'},
      {to: '/software-updates', icon: 'download', label: 'Software Updates', color: 'text-teal-400'},
      {to: '/maintenance', icon: 'maintenance', label: 'Maintenance', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Cabin',
    items: [
      {to: '/climate-control', icon: 'climate', label: 'Climate Control', color: 'text-sky-400'},
      {to: '/media-player', icon: 'headphones', label: 'Media Player', color: 'text-pink-400'},
    ],
  },
  {
    title: 'Reports',
    items: [
      {to: '/statistics', icon: 'pieChart', label: 'Statistics', color: 'text-cyan-400'},
      {to: '/analytics', icon: 'analytics', label: 'Analytics', color: 'text-indigo-400'},
      {to: '/period-compare', icon: 'calendar', label: 'Period Comparison', color: 'text-orange-400'},
      {to: '/efficiency', icon: 'leaf', label: 'Efficiency', color: 'text-amber-400'},
      {to: '/temperature-impact', icon: 'climateHot', label: 'Temperature Impact', color: 'text-blue-400'},
      {to: '/cost-analysis', icon: 'dollarSign', label: 'Cost Analysis', color: 'text-emerald-400'},
      {to: '/tco', icon: 'wallet', label: 'Cost of Ownership', color: 'text-green-400'},
    ],
  },
  {
    title: 'Commands',
    items: [
      {to: '/commands', icon: 'gamepad', label: 'Send Commands', color: 'text-fuchsia-400', dataTour: 'commands-section'},
      {to: '/command-history', icon: 'history', label: 'Command History', color: 'text-violet-400'},
    ],
  },
  {
    title: 'Automation',
    items: [
      {to: '/automations', icon: 'workflow', label: 'Automations', color: 'text-purple-400'},
      {to: '/notifications/studio', icon: 'notificationsAdd', label: 'Alert Studio', color: 'text-fuchsia-400'},
      {to: '/notifications/rules', icon: 'filter', label: 'Alert Rules', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Notifications',
    items: [
      {to: '/notifications/inbox', icon: 'notifications', label: 'Notification Inbox', color: 'text-purple-400'},
      {to: '/notifications/alerts', icon: 'notificationsActive', label: 'Alert Center', color: 'text-red-400'},
      {to: '/notifications/channels', icon: 'send', label: 'Notification Channels', color: 'text-cyan-400'},
      {to: '/notifications/webhooks', icon: 'cloud', label: 'Webhooks', color: 'text-sky-400'},
      {to: '/notifications/browser', icon: 'notificationsActive', label: 'Browser Notifications', color: 'text-fuchsia-400'},
      {to: '/notifications/quiet-hours', icon: 'clock', label: 'Quiet Hours', color: 'text-indigo-400'},
    ],
  },
  {
    title: 'Security',
    items: [
      {to: '/security-access', icon: 'locked', label: 'Security & Access', color: 'text-emerald-400'},
      {to: '/safety-settings', icon: 'securityCheck', label: 'Safety Settings', color: 'text-amber-400'},
      {to: '/guard-mode', icon: 'securityAlert', label: 'Guard Mode', color: 'text-red-400'},
    ],
  },
  {
    title: 'Account',
    items: [
      {to: '/tesla-account', icon: 'user', label: 'Tesla Account', color: 'text-blue-400'},
      {to: '/tesla-orders', icon: 'shoppingCart', label: 'Active Orders', color: 'text-teal-400'},
      {to: '/fleet-api', icon: 'cloud', label: 'Fleet API', color: 'text-sky-400'},
      {to: '/tesla-region', icon: 'globe', label: 'Region & API', color: 'text-emerald-400'},
      {to: '/tesla-features', icon: 'flag', label: 'Feature Flags', color: 'text-purple-400'},
      {to: '/account/2fa', icon: 'securityCheck', label: 'Two-Factor Auth', color: 'text-yellow-400', requiresAuth: true},
      {to: '/account/sessions', icon: 'monitor', label: 'Active Sessions', color: 'text-cyan-400', requiresAuth: true},
      {to: '/account/privacy', icon: 'security', label: 'Privacy', color: 'text-emerald-400'},
      {to: '/me/activity', icon: 'history', label: 'My Activity', color: 'text-cyan-400', requiresAuth: true},
    ],
  },
  {
    title: 'Settings',
    items: [
      {to: '/settings', icon: 'settings', label: 'General Settings', color: 'text-[var(--text-muted)]'},
      {to: '/chatbot', icon: 'bot', label: 'Helix Chat', color: 'text-purple-400', brandMark: 'helix'},
      {to: '/dev-tools', icon: 'hammer', label: 'Developer Tools', color: 'text-cyan-400'},
    ],
  },
  {
    title: 'Integrations',
    items: [
      {to: '/integrations/helix', icon: 'bot', label: 'Helix', color: 'text-purple-400', brandMark: 'helix'},
      {to: '/api-keys', icon: 'key', label: 'API Keys', color: 'text-amber-400'},
      {to: '/gas-price', icon: 'fuel', label: 'Gas Prices', color: 'text-orange-400'},
    ],
  },
  {
    title: 'Data',
    items: [
      {to: '/data-export', icon: 'hardDriveDownload', label: 'Data Export', color: 'text-lime-400'},
      {to: '/backup', icon: 'databaseBackup', label: 'Backup & Restore', color: 'text-teal-400'},
      {to: '/data-repair', icon: 'stethoscope', label: 'Data Repair', color: 'text-amber-400'},
    ],
  },
  {
    title: 'Diagnostics',
    items: [
      {to: '/system-status', icon: 'efficiency', label: 'System Status', color: 'text-emerald-400'},
      {to: '/db-health', icon: 'hardDrive', label: 'Database Health', color: 'text-emerald-400'},
      {to: '/anomaly-detection', icon: 'scanSearch', label: 'Anomaly Detection', color: 'text-red-400'},
      {to: '/signals', icon: 'activity', label: 'Live Signals', color: 'text-neon-cyan', dataTour: 'live-signals-section'},
      {to: '/admin/live-signals', icon: 'radioTower', label: 'Live Signal Inspector', color: 'text-cyan-400'},
      {to: '/admin/ingest-xray', icon: 'scanSearch', label: 'Ingest X-Ray', color: 'text-sky-400'},
      {to: '/admin/dlq', icon: 'severityCritical', label: 'DLQ Inspector', color: 'text-red-400'},
      {to: '/admin/flags', icon: 'flag', label: 'Feature Flags', color: 'text-purple-400'},
      {to: '/admin/schema-drift', icon: 'fingerprint', label: 'Schema Drift', color: 'text-purple-400'},
      {to: '/admin/slow-queries', icon: 'timer', label: 'Slow Queries', color: 'text-amber-400'},
      {to: '/admin/vehicle-cost', icon: 'wallet', label: 'Vehicle Cost', color: 'text-lime-400'},
      {to: '/admin/disk-forecast', icon: 'hardDrive', label: 'Disk Forecast', color: 'text-teal-400'},
      {to: '/admin/secret-rotation', icon: 'securityCheck', label: 'Secret Rotation', color: 'text-cyan-400'},
      {to: '/admin/audit-log', icon: 'history', label: 'Audit Log', color: 'text-indigo-400'},
      {to: '/admin/gdpr-exports', icon: 'hardDriveDownload', label: 'GDPR Exports', color: 'text-emerald-400'},
      {to: '/state-debugger', icon: 'bug', label: 'State Debugger', color: 'text-purple-400'},
      {to: '/mqtt-inspector', icon: 'radio', label: 'MQTT Inspector', color: 'text-blue-400'},
      {to: '/redis-signals', icon: 'server', label: 'Redis Signals', color: 'text-orange-400'},
      {to: '/admin/telemetry/coverage', icon: 'cloud', label: 'Telemetry Coverage', color: 'text-sky-400'},
      {to: '/api-logs', icon: 'fileText', label: 'API Logs', color: 'text-amber-400'},
      {to: '/api-playground', icon: 'terminal', label: 'API Playground', color: 'text-emerald-400'},
    ],
  },
  {
    title: 'About',
    items: [{to: '/roadmap', icon: 'signpost', label: 'Roadmap', color: 'text-violet-400'}],
  },
];

// ---------------------------------------------------------------------------
// Pure routing helpers (ported verbatim — behaviour-identical to the web file).
// ---------------------------------------------------------------------------

export function isVisibleNavItem(
  item: NavItem,
  vehicleCount: number,
  isForwardAuth: boolean,
): boolean {
  if (item.minVehicles !== undefined && vehicleCount < item.minVehicles) {
    return false;
  }
  // Items marked `requiresAuth` are useless without a configured ForwardAuth
  // identity provider (per-user state, audit feeds, etc.) — hide them in open
  // mode rather than route the user to a 503-style empty state.
  if (item.requiresAuth && !isForwardAuth) {
    return false;
  }
  return true;
}

export function isActiveNavPath(pathname: string, to: string): boolean {
  return to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(to + '/');
}

export function findNavItemByPath(
  pathname: string,
): {section: NavSection; item: NavItem} | null {
  for (const section of navSections) {
    const item = section.items.find(candidate =>
      isActiveNavPath(pathname, candidate.to),
    );
    if (item) {
      return {section, item};
    }
  }
  return null;
}

export function findNavItemByExactPath(
  to: string,
): {section: NavSection; item: NavItem} | null {
  for (const section of navSections) {
    const item = section.items.find(candidate => candidate.to === to);
    if (item) {
      return {section, item};
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sidebar live-data query descriptors.
//
// The web shell loads these three feeds with @tanstack/react-query useQuery +
// request<T>(). React Native receives the resolved data as props, but the
// canonical query keys, API paths, and refetch cadences are preserved verbatim
// here so the native query layer can wire them up identically.
// ---------------------------------------------------------------------------

export interface SidebarQueryDescriptor {
  queryKey: readonly string[];
  /** Path passed to request(); the client auto-prefixes /api/v1. */
  path: string;
  refetchIntervalMs: number;
  retry: number;
}

export const SIDEBAR_QUERIES: Record<
  'alerts' | 'vehicles' | 'staleSessions',
  SidebarQueryDescriptor
> = {
  alerts: {queryKey: ['alerts-sidebar'], path: '/alerts?limit=50&offset=0', refetchIntervalMs: 30_000, retry: 1},
  vehicles: {queryKey: ['vehicles-sidebar'], path: '/vehicles', refetchIntervalMs: 60_000, retry: 1},
  staleSessions: {queryKey: ['stale-sessions-sidebar'], path: '/data-repair/stale-sessions', refetchIntervalMs: 60_000, retry: 1},
};

// ---------------------------------------------------------------------------
// Native-safe persisted nav preferences.
//
// The web shell persists expanded sections, pinned paths, and the recent-MRU
// list to window.localStorage and reacts to the cross-tab `storage` event.
// React Native has no Web Storage API, so this in-process Map mirrors
// localStorage's getItem/setItem + try/catch shape; it lives for the app
// process (a real host swaps in AsyncStorage for cross-session durability).
// ---------------------------------------------------------------------------

const navPreferenceStore = new Map<string, string>();

function readStoredJSON<T>(key: string, fallback: T): {raw: string | null; value: T} {
  try {
    const raw = navPreferenceStore.get(key) ?? null;
    if (raw === null) {
      return {raw, value: fallback};
    }
    return {raw, value: JSON.parse(raw) as T};
  } catch {
    return {raw: null, value: fallback};
  }
}

function writeStoredJSON(key: string, value: unknown): void {
  try {
    navPreferenceStore.set(key, JSON.stringify(value));
  } catch {
    // Ignore storage failures; navigation still works without persisted prefs.
  }
}

/** Test/host hook: clears the in-process nav preference store (cold-start analog). */
export function resetNavPreferenceStore(): void {
  navPreferenceStore.clear();
}

// ---------------------------------------------------------------------------
// Sidebar nav state machine (ported from the Layout() body).
// Preserves state names (sidebarOpen, expandedSections, recentNavPaths,
// pinnedNavPaths) and all derived selectors + callbacks.
// ---------------------------------------------------------------------------

export interface SidebarNavState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  expandedSections: Set<string>;
  recentNavPaths: string[];
  pinnedNavPaths: string[];
  activeNavEntry: {section: NavSection; item: NavItem} | null;
  activeSectionTitle: string | undefined;
  visibleNavSections: NavSection[];
  pinnedNavItems: NavItem[];
  recentNavItems: NavItem[];
  expandedSectionCount: number;
  activeNavPath: string | undefined;
  activeIsPinned: boolean;
  toggleSection: (title: string) => void;
  expandAllSections: () => void;
  collapseAllSections: () => void;
  pinNavPath: (to: string) => void;
  unpinNavPath: (to: string) => void;
  navLabel: (label: string) => string;
}

export function useSidebarNavState(params: {
  pathname: string;
  vehicleCount: number;
  isForwardAuth: boolean;
  t: NativeTFunction;
}): SidebarNavState {
  const {pathname, vehicleCount, isForwardAuth, t} = params;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => {
    const {value} = readStoredJSON<string[]>(EXPANDED_NAV_STORAGE_KEY, []);
    return new Set(value.length > 0 ? value : ['Home']);
  });
  const [recentNavPaths, setRecentNavPaths] = useState<string[]>(() => {
    const {value} = readStoredJSON<string[]>(RECENT_NAV_STORAGE_KEY, []);
    return value.slice(0, MAX_RECENT_NAV_ITEMS);
  });
  const [pinnedNavPaths, setPinnedNavPaths] = useState<string[]>(() => {
    const {raw, value} = readStoredJSON<string[]>(PINNED_NAV_STORAGE_KEY, []);
    return (raw ? value : DEFAULT_PINNED_NAV_PATHS).slice(0, MAX_PINNED_NAV_ITEMS);
  });

  const activeNavEntry = useMemo(() => findNavItemByPath(pathname), [pathname]);
  const activeSectionTitle = activeNavEntry?.section.title;

  const visibleNavSections = useMemo(
    () =>
      navSections
        .map(section => ({
          ...section,
          items: section.items.filter(item =>
            isVisibleNavItem(item, vehicleCount, isForwardAuth),
          ),
        }))
        .filter(section => section.items.length > 0),
    [vehicleCount, isForwardAuth],
  );

  const pinnedNavItems = useMemo(
    () =>
      pinnedNavPaths
        .map(path => findNavItemByExactPath(path))
        .filter((entry): entry is {section: NavSection; item: NavItem} =>
          Boolean(entry),
        )
        .map(entry => entry.item)
        .filter(item => isVisibleNavItem(item, vehicleCount, isForwardAuth)),
    [pinnedNavPaths, vehicleCount, isForwardAuth],
  );

  const recentNavItems = useMemo(
    () =>
      recentNavPaths
        .map(path => findNavItemByExactPath(path))
        .filter((entry): entry is {section: NavSection; item: NavItem} =>
          Boolean(entry),
        )
        .map(entry => entry.item)
        .filter(item => isVisibleNavItem(item, vehicleCount, isForwardAuth))
        // Don't echo the current page in "Recently Used" — it's already
        // highlighted in its canonical section, so duplicating it adds noise.
        .filter(item => !isActiveNavPath(pathname, item.to)),
    [recentNavPaths, vehicleCount, isForwardAuth, pathname],
  );

  // Auto-expand the section that owns the active route.
  useEffect(() => {
    if (!activeSectionTitle) {
      return;
    }
    setExpandedSections(prev => {
      if (prev.has(activeSectionTitle)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(activeSectionTitle);
      return next;
    });
  }, [activeSectionTitle]);

  // Persist expanded sections (web wrote JSON to localStorage on every change).
  useEffect(() => {
    writeStoredJSON(EXPANDED_NAV_STORAGE_KEY, [...expandedSections]);
  }, [expandedSections]);

  // Record the active page into the recent-MRU list (skip '/' and pinned).
  useEffect(() => {
    const activeTo = activeNavEntry?.item.to;
    if (!activeTo || activeTo === '/' || pinnedNavPaths.includes(activeTo)) {
      return;
    }
    setRecentNavPaths(prev => {
      const next = [activeTo, ...prev.filter(path => path !== activeTo)].slice(
        0,
        MAX_RECENT_NAV_ITEMS,
      );
      return next.join('|') === prev.join('|') ? prev : next;
    });
  }, [activeNavEntry, pinnedNavPaths]);

  useEffect(() => {
    writeStoredJSON(RECENT_NAV_STORAGE_KEY, recentNavPaths);
  }, [recentNavPaths]);

  useEffect(() => {
    writeStoredJSON(PINNED_NAV_STORAGE_KEY, pinnedNavPaths);
  }, [pinnedNavPaths]);

  const toggleSection = useCallback(
    (title: string) => {
      setExpandedSections(prev => {
        const next = new Set(prev);
        if (next.has(title) && title !== activeSectionTitle) {
          next.delete(title);
        } else {
          next.add(title);
        }
        return next;
      });
    },
    [activeSectionTitle],
  );

  const expandAllSections = useCallback(() => {
    setExpandedSections(new Set(visibleNavSections.map(section => section.title)));
  }, [visibleNavSections]);

  const collapseAllSections = useCallback(() => {
    setExpandedSections(new Set());
  }, []);

  const pinNavPath = useCallback((to: string) => {
    setPinnedNavPaths(prev => {
      if (prev.includes(to)) {
        return prev;
      }
      return [to, ...prev].slice(0, MAX_PINNED_NAV_ITEMS);
    });
    setRecentNavPaths(prev => prev.filter(path => path !== to));
  }, []);

  const unpinNavPath = useCallback((to: string) => {
    setPinnedNavPaths(prev => prev.filter(path => path !== to));
  }, []);

  // navI18nKeys is intentionally empty, so navLabel is effectively identity —
  // ported verbatim so re-enabling the key map needs no call-site change.
  const navLabel = useCallback(
    (label: string) => {
      if (!navI18nKeys[label]) {
        return label;
      }
      const translated = t(navI18nKeys[label], label);
      return translated === navI18nKeys[label] ? label : translated;
    },
    [t],
  );

  const expandedSectionCount = visibleNavSections.filter(section =>
    expandedSections.has(section.title),
  ).length;
  const activeNavPath = activeNavEntry?.item.to;
  const activeIsPinned = activeNavPath
    ? pinnedNavPaths.includes(activeNavPath)
    : false;

  return {
    sidebarOpen,
    setSidebarOpen,
    expandedSections,
    recentNavPaths,
    pinnedNavPaths,
    activeNavEntry,
    activeSectionTitle,
    visibleNavSections,
    pinnedNavItems,
    recentNavItems,
    expandedSectionCount,
    activeNavPath,
    activeIsPinned,
    toggleSection,
    expandAllSections,
    collapseAllSections,
    pinNavPath,
    unpinNavPath,
    navLabel,
  };
}

// ---------------------------------------------------------------------------
// Realtime alert -> toast decision logic (from useRealtimeEvents onAlert).
// The SSE wiring + toast presentation are runtime-coupled and host-owned; the
// pure branch logic (when to build a drill-through action, severity -> toast
// type) is preserved here and is independently testable.
// ---------------------------------------------------------------------------

export type AlertToastType = 'error' | 'warning' | 'info';

export interface AlertToastDescriptor {
  type: AlertToastType;
  title: string;
  message: string;
  action?: {label: string; to: string};
}

export function deriveAlertToast(
  alert: Partial<Alert>,
  t: NativeTFunction,
  resolveHref: (alert: Partial<Alert>) => string = () => '/signal-explorer',
): AlertToastDescriptor {
  const severity = alert.severity ?? 'info';
  // Build a drill-through link only when we have enough metadata to deep-link;
  // the actual target resolution is delegated to resolveHref (the web shell
  // used getAlertDrillthroughHref, which falls back to /signal-explorer).
  const href =
    alert.created_at || alert.rule_signal || alert.vehicle_id
      ? resolveHref(alert)
      : null;
  const title = alert.title ?? t('alerts.toast.title', 'Alert');
  const message = alert.message ?? '';
  const type: AlertToastType =
    severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'info';

  if (href) {
    return {type, title, message, action: {label: t('alerts.toast.view', 'View'), to: href}};
  }
  return {type, title, message};
}

// ---------------------------------------------------------------------------
// Documentation of the global surfaces the web Layout mounts and the
// browser-only adaptations applied in this native port.
// ---------------------------------------------------------------------------

export interface GlobalSurface {
  name: string;
  role: string;
}

/** Every banner/modal/overlay the web Layout JSX mounts, in stacking order. */
export const LAYOUT_GLOBAL_SURFACES: GlobalSurface[] = [
  {name: 'SkipToContent', role: 'WCAG 2.4.1 bypass-blocks link (first focusable element)'},
  {name: 'AnnouncerRegion', role: 'Global SR live-region for imperative announcements'},
  {name: 'BrowserCompatBanner', role: 'Outdated-browser warning at top of main column'},
  {name: 'TimeMachineBanner', role: '"Viewing data as of …" historical-mode banner'},
  {name: 'ServiceStatusBanner', role: 'Backend service-status notice'},
  {name: 'BottomTabBar', role: 'Mobile bottom tab navigation'},
  {name: 'StatusBar', role: 'Footer health/version/connection bar'},
  {name: 'CommandPalette', role: 'Cmd+K global navigation + actions'},
  {name: 'InstallPrompt', role: 'PWA install affordance'},
  {name: 'TopProgress', role: 'Route-change / mutation progress strip'},
  {name: 'OfflineBanner', role: 'Offline / PWA connectivity banner'},
  {name: 'ImpersonationBanner', role: 'Admin impersonation context (highest priority)'},
  {name: 'MaintenanceBanner', role: 'Operator maintenance / degraded banner'},
  {name: 'RateLimitBanner', role: 'Rate-limit / circuit-breaker countdown'},
  {name: 'NewVersionBanner', role: 'Backend-redeploy reload nudge'},
  {name: 'TeslaReauthBanner', role: 'Tesla token-expiry recovery banner'},
  {name: 'SessionExpiringModal', role: 'ForwardAuth soft session-expiry countdown'},
  {name: 'SessionExpiredModal', role: 'ForwardAuth hard session-expiry block'},
  {name: 'GlobalShortcuts', role: 'Keyboard shortcut engine'},
  {name: 'GotoIndicator', role: 'Goto-mode keyboard indicator'},
  {name: 'KeyboardShortcutsModal', role: 'Shortcut cheat sheet (press ?)'},
  {name: 'FeedbackModal', role: 'In-app feedback modal'},
  {name: 'TourOverlay', role: 'Onboarding tour spotlight overlay'},
  {name: 'TourLauncher', role: 'Tour launcher menu'},
  {name: 'ChangelogModal', role: '"What\'s new since last visit" modal'},
  {name: 'DraftRestorePrompt', role: 'Unsaved-draft recovery prompt'},
  {name: 'CookieConsentBanner', role: 'GDPR cookie-consent banner (opt-in)'},
];

export const BROWSER_ONLY_ADAPTATIONS: string[] = [
  'react-router-dom Outlet/useLocation/useNavigate -> children + currentPath + onNavigate props (native navigator owns history).',
  '@tanstack/react-query useQuery sidebar fetches -> alerts/vehicles/staleSessions props; SIDEBAR_QUERIES keeps the exact keys, paths, and 30s/60s refetch cadences.',
  'window.localStorage + cross-tab `storage` event -> in-process navPreferenceStore Map (AsyncStorage in a real host).',
  'framer-motion motion/AnimatePresence -> static native sections (no layout/height spring animations).',
  'createPortal + getBoundingClientRect popover coords + window CustomEvents (open-theme-popover, open-feedback-modal, toggle-keyboard-shortcuts, tour events) -> inline native popover + documented host wiring.',
  'document.querySelector + scrollIntoView active-link auto-scroll, matchMedia prefers-reduced-motion -> dropped (no DOM in native).',
  'The 27 global banners/modals/overlays in LAYOUT_GLOBAL_SURFACES are browser-only or separately ported feedback components; they are documented rather than re-imported here.',
  'lucide Icons.* -> SemanticIcon glyphs; the Helix brand mark keeps its native HelixMark via the item brandMark flag.',
  'Browser tab side effects (useTitleBadge/useFaviconBadge/useDynamicAppIcon/useCriticalAlertFlash) have no native analog and are omitted.',
];

// ---------------------------------------------------------------------------
// Render layer (native primitives only).
// ---------------------------------------------------------------------------

const COMPACT_LAYOUT_WIDTH = 900;

/** Tone for the count badges shown on Alerts / Vehicles / Data Repair rows. */
type NavBadgeTone = 'danger' | 'accent' | 'warning';

interface NavBadge {
  count: number;
  tone: NavBadgeTone;
}

/**
 * Top-bar quick theme switcher.
 *
 * Web used createPortal + getBoundingClientRect coords + an `open-theme-popover`
 * window event and a full <ThemePicker>. Native renders an inline anchored
 * popover (no portal/coords needed) with a documented ThemePicker placeholder,
 * preserving the open/close state, the `placement` prop, and the "Customize…"
 * action that navigates to /settings#appearance.
 */
function ThemeQuickSwitcher({
  placement = 'right',
  onNavigate,
  t,
}: {
  placement?: 'left' | 'right';
  onNavigate?: (to: string) => void;
  t: NativeTFunction;
}) {
  const [open, setOpen] = useState(false);
  const openLabel = t('theme.openPicker', 'Open theme picker');

  return (
    <View style={styles.themeSwitcher}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(value => !value)}
        style={({pressed}) => [styles.iconButton, pressed && styles.iconButtonPressed]}>
        <SemanticIcon name="palette" size="sm" decorative />
      </Pressable>
      {open ? (
        <View
          accessibilityRole="menu"
          accessibilityLabel={openLabel}
          style={[
            styles.themePopover,
            placement === 'left' ? styles.themePopoverLeft : styles.themePopoverRight,
          ]}>
          <AppText variant="caption" tone="muted">
            {t('theme.pickerPlaceholder', 'Theme + mode picker (native-safe placeholder)')}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setOpen(false);
              onNavigate?.('/settings#appearance');
            }}
            style={({pressed}) => [styles.themeCustomize, pressed && styles.iconButtonPressed]}>
            <AppText variant="caption" tone="accent" weight="semibold">
              {t('theme.customize', 'Customize…')}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function NavCountBadge({badge}: {badge: NavBadge}) {
  const display = badge.count > 9 ? '9+' : String(badge.count);
  return (
    <View style={[styles.navBadge, navBadgeToneStyles[badge.tone]]}>
      <AppText variant="caption" weight="bold" style={navBadgeTextStyles[badge.tone]}>
        {display}
      </AppText>
    </View>
  );
}

function NavLinkRow({
  item,
  isActive,
  label,
  badge,
  onPress,
}: {
  item: NavItem;
  isActive: boolean;
  label: string;
  badge?: NavBadge;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityState={{selected: isActive}}
      onPress={onPress}
      style={({pressed}) => [
        styles.navRow,
        isActive && styles.navRowActive,
        pressed && styles.navRowPressed,
      ]}>
      <View style={styles.navRowIcon}>
        {item.brandMark === 'helix' ? (
          <HelixMark size={18} color={colors.accent} aria-hidden />
        ) : (
          <SemanticIcon name={item.icon} size="sm" decorative />
        )}
      </View>
      <AppText
        numberOfLines={1}
        weight={isActive ? 'semibold' : 'regular'}
        tone={isActive ? 'primary' : 'secondary'}
        style={styles.navRowLabel}>
        {label}
      </AppText>
      {badge ? <NavCountBadge badge={badge} /> : null}
      {isActive ? <View style={styles.navActiveDot} /> : null}
    </Pressable>
  );
}

export interface LayoutProps {
  /** Active route path (replaces react-router-dom useLocation().pathname). */
  currentPath?: string;
  /** Navigation bridge (replaces useNavigate); fires on every nav row press. */
  onNavigate?: (to: string) => void;
  /** Route content host (replaces <Outlet />). */
  children?: ReactNode;
  /** Sidebar alerts feed (replaces the alerts-sidebar useQuery). */
  alerts?: Alert[];
  /** Sidebar vehicles feed (replaces the vehicles-sidebar useQuery). */
  vehicles?: Vehicle[];
  /** Stale-session feed for the Data Repair badge (replaces its useQuery). */
  staleSessions?: StaleSessionsResponse | null;
  /** ForwardAuth mode (replaces useIsForwardAuth()). */
  isForwardAuth?: boolean;
  /** Sidebar style preference (replaces useSidebarStyle()). */
  sidebarStyle?: 'linear' | 'notion' | 'legacy';
  /** Whether the footer StatusBar is enabled (replaces useStatusBarPrefs()). */
  statusBarEnabled?: boolean;
}

export default function Layout({
  currentPath = '/',
  onNavigate,
  children,
  alerts,
  vehicles,
  staleSessions = null,
  isForwardAuth = false,
  sidebarStyle = 'linear',
  statusBarEnabled = true,
}: LayoutProps) {
  const t = useNativeTranslationFallback();
  const {width} = useWindowDimensions();
  const compact = width < COMPACT_LAYOUT_WIDTH;

  const alertList = alerts ?? [];
  const vehicleList = vehicles ?? [];
  const unreadAlerts = alertList.filter(alert => !alert.is_read).length;
  const vehicleCount = vehicleList.length;
  const staleCount =
    (staleSessions?.stale_charging?.length ?? 0) +
    (staleSessions?.stale_drives?.length ?? 0);

  const nav = useSidebarNavState({
    pathname: currentPath,
    vehicleCount,
    isForwardAuth,
    t,
  });
  const {setSidebarOpen} = nav;

  const handleNavigate = useCallback(
    (to: string) => {
      setSidebarOpen(false);
      onNavigate?.(to);
    },
    [setSidebarOpen, onNavigate],
  );

  const badgeForItem = useCallback(
    (to: string): NavBadge | undefined => {
      if (to === '/notifications/alerts' && unreadAlerts > 0) {
        return {count: unreadAlerts, tone: 'danger'};
      }
      if (to === '/vehicles' && vehicleCount > 0) {
        return {count: vehicleCount, tone: 'accent'};
      }
      if (to === '/data-repair' && staleCount > 0) {
        return {count: staleCount, tone: 'warning'};
      }
      return undefined;
    },
    [unreadAlerts, vehicleCount, staleCount],
  );

  const renderNavRow = useCallback(
    (item: NavItem) => (
      <NavLinkRow
        key={item.to}
        item={item}
        isActive={isActiveNavPath(currentPath, item.to)}
        label={nav.navLabel(item.label)}
        badge={badgeForItem(item.to)}
        onPress={() => handleNavigate(item.to)}
      />
    ),
    [currentPath, nav, badgeForItem, handleNavigate],
  );

  const sidebar = (
    <ScrollView
      accessibilityLabel={t('a11y.primaryNav', 'Primary')}
      style={[styles.sidebar, compact && styles.sidebarCompact]}
      contentContainerStyle={styles.sidebarContent}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled>
      {/* Brand header + quick theme switcher (web: Logo + ThemeQuickSwitcher +
          NotificationBellPopover). */}
      <View style={styles.brandRow}>
        <AppText variant="title" weight="bold">
          TeslaSync
        </AppText>
        <ThemeQuickSwitcher placement="left" onNavigate={handleNavigate} t={t} />
      </View>

      {/* Sticky command-palette trigger (web: CommandPaletteTrigger). */}
      <Pressable
        accessibilityRole="search"
        accessibilityLabel={t('nav.quickSearchHint', 'Ctrl+K to jump')}
        onPress={() => handleNavigate('/signals')}
        style={({pressed}) => [styles.searchTrigger, pressed && styles.navRowPressed]}>
        <SemanticIcon name="search" size="sm" decorative />
        <AppText tone="muted" style={styles.searchTriggerText}>
          {t('nav.quickSearchHint', 'Ctrl+K to jump')}
        </AppText>
      </Pressable>

      {/* Persistent vehicle scope picker (web: VehiclePicker, null for single
          vehicle owners). */}
      {vehicleCount > 1 ? (
        <View style={styles.vehiclePicker}>
          <SemanticIcon name="vehicle" size="sm" decorative />
          <AppText variant="caption" tone="secondary">
            {t('nav.vehicleScope', '{{count}} vehicles', {count: vehicleCount})}
          </AppText>
        </View>
      ) : null}

      {/* Active-section card (web: highlighted current section + pin toggle). */}
      {nav.activeNavEntry ? (
        <View style={styles.activeCard}>
          <AppText numberOfLines={1} weight="semibold" style={styles.activeCardLabel}>
            {nav.navLabel(nav.activeNavEntry.item.label)}
          </AppText>
          {nav.activeNavPath ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{selected: nav.activeIsPinned}}
              accessibilityLabel={
                nav.activeIsPinned
                  ? t('nav.unpinCurrent', 'Remove current page from pinned')
                  : t('nav.pinCurrent', 'Pin current page')
              }
              onPress={() =>
                nav.activeIsPinned
                  ? nav.unpinNavPath(nav.activeNavPath as string)
                  : nav.pinNavPath(nav.activeNavPath as string)
              }
              style={({pressed}) => [styles.pinButton, pressed && styles.iconButtonPressed]}>
              <SemanticIcon name="star" size="sm" decorative />
              <AppText variant="caption" tone={nav.activeIsPinned ? 'accent' : 'muted'}>
                {nav.activeIsPinned
                  ? t('nav.pinnedAction', 'Pinned')
                  : t('nav.pinAction', 'Pin')}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Pinned section. */}
      {nav.pinnedNavItems.length > 0 ? (
        <View style={styles.navGroup}>
          <AppText variant="caption" tone="muted" weight="semibold" style={styles.navGroupLabel}>
            {t('nav.pinned', 'Pinned')}
          </AppText>
          {nav.pinnedNavItems.map(item => (
            <View key={item.to} style={styles.pinnedRow}>
              <View style={styles.pinnedRowMain}>{renderNavRow(item)}</View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('nav.unpinPage', 'Unpin {{page}}', {
                  page: nav.navLabel(item.label),
                })}
                onPress={() => nav.unpinNavPath(item.to)}
                style={({pressed}) => [styles.iconButton, pressed && styles.iconButtonPressed]}>
                <SemanticIcon name="close" size="sm" decorative />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      {/* Recently used (muted by SHOW_RECENTLY_USED_NAV per UX review). */}
      {SHOW_RECENTLY_USED_NAV && nav.recentNavItems.length > 0 ? (
        <View style={styles.navGroup}>
          <AppText variant="caption" tone="muted" weight="semibold" style={styles.navGroupLabel}>
            {t('nav.recentlyUsed', 'Recently Used')}
          </AppText>
          {nav.recentNavItems.map(item => renderNavRow(item))}
        </View>
      ) : null}

      {/* Sections list with expand-all / collapse-all controls. */}
      <View style={styles.navGroup}>
        <View style={styles.sectionsHeader}>
          <AppText variant="caption" tone="muted" weight="semibold" style={styles.navGroupLabel}>
            {t('nav.sections', 'Sections')}
          </AppText>
          <View style={styles.sectionsHeaderActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('nav.expandAll', 'Expand all sections')}
              disabled={nav.expandedSectionCount === nav.visibleNavSections.length}
              onPress={nav.expandAllSections}
              style={({pressed}) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
                nav.expandedSectionCount === nav.visibleNavSections.length && styles.iconButtonDisabled,
              ]}>
              <SemanticIcon name="expandAll" size="sm" decorative />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('nav.collapseAll', 'Collapse all sections')}
              disabled={nav.expandedSectionCount === 0}
              onPress={nav.collapseAllSections}
              style={({pressed}) => [
                styles.iconButton,
                pressed && styles.iconButtonPressed,
                nav.expandedSectionCount === 0 && styles.iconButtonDisabled,
              ]}>
              <SemanticIcon name="collapseAll" size="sm" decorative />
            </Pressable>
          </View>
        </View>

        {nav.visibleNavSections.map(section => {
          const isExpanded = nav.expandedSections.has(section.title);
          const isActiveSection = section.title === nav.activeSectionTitle;
          const sectionStyle = SECTION_ICON_STYLES[section.title];
          return (
            <View key={section.title} style={styles.section}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={section.title}
                accessibilityState={{expanded: isExpanded}}
                onPress={() => nav.toggleSection(section.title)}
                style={({pressed}) => [
                  styles.sectionHeaderRow,
                  isActiveSection && styles.sectionHeaderRowActive,
                  pressed && styles.navRowPressed,
                ]}>
                <SemanticIcon name={sectionStyle?.icon ?? 'sparkles'} size="sm" decorative />
                <AppText
                  weight="bold"
                  tone={isActiveSection ? 'primary' : 'secondary'}
                  style={styles.sectionTitle}>
                  {section.title.toUpperCase()}
                </AppText>
                <View style={styles.sectionCount}>
                  <AppText variant="caption" tone="muted" weight="semibold">
                    {String(section.items.length)}
                  </AppText>
                </View>
                <SemanticIcon name={isExpanded ? 'collapse' : 'expand'} size="sm" decorative />
              </Pressable>
              {isExpanded ? (
                <View style={styles.sectionItems}>
                  {section.items.map(item => renderNavRow(item))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );

  const contentHost = (
    <ScrollView
      style={styles.content}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}>
      {/* Breadcrumb row + quick-search hint (web: LayoutBreadcrumbs). */}
      {nav.activeNavEntry ? (
        <View style={styles.breadcrumbRow}>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {nav.activeNavEntry.section.title} / {nav.navLabel(nav.activeNavEntry.item.label)}
          </AppText>
          <AppText variant="caption" tone="muted">
            {t('nav.quickSearchHint', 'Ctrl+K to jump')}
          </AppText>
        </View>
      ) : null}

      {/* Route content host — the native analog of <Outlet />. */}
      {children ?? (
        <GlassPanel style={styles.outletPlaceholder}>
          <AppText variant="title" weight="bold">
            {nav.activeNavEntry
              ? nav.navLabel(nav.activeNavEntry.item.label)
              : t('nav.noRoute', 'No route')}
          </AppText>
          <AppText tone="secondary">
            {t(
              'nav.outletHint',
              'Route content renders here. The native navigator mounts the active screen into this host (web <Outlet />).',
            )}
          </AppText>
          <View style={styles.outletMetaRow}>
            <StatusPill
              label={t('nav.sidebarStyle', 'Sidebar: {{style}}', {style: sidebarStyle})}
              state="online"
            />
            <StatusPill
              label={t('nav.statusBar', statusBarEnabled ? 'Status bar on' : 'Status bar off')}
              state={statusBarEnabled ? 'online' : 'warning'}
            />
            <StatusPill
              label={t('nav.alertsPill', '{{count}} unread alerts', {count: unreadAlerts})}
              state={unreadAlerts > 0 ? 'warning' : 'online'}
            />
          </View>
        </GlassPanel>
      )}

      {/* Documented global surfaces the web Layout mounts around <Outlet />. */}
      <GlassPanel style={styles.surfacesPanel}>
        <View style={styles.surfacesHeader}>
          <AppText variant="title" weight="bold">
            {t('nav.globalSurfaces', 'Global app surfaces')}
          </AppText>
          <StatusPill label={t('nav.nativeSafe', 'Native-safe')} state="warning" />
        </View>
        <AppText tone="secondary">
          {t(
            'nav.globalSurfacesHint',
            'These banners, modals, and overlays wrap the route content on web. They are browser-only or separately ported feedback components, documented here for parity.',
          )}
        </AppText>
        {LAYOUT_GLOBAL_SURFACES.map(surface => (
          <View key={surface.name} style={styles.surfaceRow}>
            <View style={styles.bullet} />
            <View style={styles.surfaceCopy}>
              <AppText weight="semibold">{surface.name}</AppText>
              <AppText variant="caption" tone="muted">
                {surface.role}
              </AppText>
            </View>
          </View>
        ))}
      </GlassPanel>

      {/* Browser-only adaptations applied in this native port. */}
      <GlassPanel style={styles.surfacesPanel}>
        <AppText variant="title" weight="bold">
          {t('nav.adaptations', 'Browser-only adaptations')}
        </AppText>
        {BROWSER_ONLY_ADAPTATIONS.map(adaptation => (
          <View key={adaptation} style={styles.surfaceRow}>
            <View style={styles.bullet} />
            <AppText tone="secondary" style={styles.surfaceCopy}>
              {adaptation}
            </AppText>
          </View>
        ))}
      </GlassPanel>
    </ScrollView>
  );

  return (
    <View style={styles.root}>
      <View style={styles.backgroundGlowTop} pointerEvents="none" />
      <View style={styles.backgroundGlowBottom} pointerEvents="none" />
      <View style={[styles.shell, compact && styles.shellCompact]}>
        {sidebar}
        {contentHost}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backgroundGlowTop: {
    position: 'absolute',
    top: -160,
    left: -140,
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: colors.glowCyan,
    opacity: 0.16,
  },
  backgroundGlowBottom: {
    position: 'absolute',
    bottom: -180,
    right: -140,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: colors.glowViolet,
    opacity: 0.16,
  },
  shell: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  shellCompact: {
    flexDirection: 'column',
    padding: spacing.md,
    gap: spacing.md,
  },
  sidebar: {
    width: 288,
    flexGrow: 0,
    flexShrink: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surfaceGlass,
    ...shadows.panel,
  },
  sidebarCompact: {
    width: '100%',
    maxHeight: 360,
  },
  sidebarContent: {
    padding: spacing.md,
    gap: spacing.md,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  themeSwitcher: {
    position: 'relative',
  },
  themePopover: {
    position: 'absolute',
    top: 44,
    minWidth: 220,
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surface,
    zIndex: 20,
  },
  themePopoverLeft: {
    left: 0,
  },
  themePopoverRight: {
    right: 0,
  },
  themeCustomize: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  searchTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
  },
  searchTriggerText: {
    flex: 1,
  },
  vehiclePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surfaceRaised,
  },
  activeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    borderRadius: 16,
    backgroundColor: colors.surfaceSelected,
  },
  activeCardLabel: {
    flex: 1,
  },
  pinButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 10,
  },
  navGroup: {
    gap: spacing.xs,
  },
  navGroupLabel: {
    letterSpacing: 1.2,
    marginBottom: spacing.xs,
  },
  sectionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
  },
  sectionHeaderRowActive: {
    backgroundColor: colors.surfaceRaised,
  },
  sectionTitle: {
    flex: 1,
    fontSize: typography.caption,
    letterSpacing: 1.4,
  },
  sectionCount: {
    minWidth: 22,
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
  },
  sectionItems: {
    gap: 2,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.xs,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 38,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 12,
  },
  navRowActive: {
    backgroundColor: colors.surfaceSelected,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  },
  navRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  navRowIcon: {
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRowLabel: {
    flex: 1,
  },
  navActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  navBadge: {
    minWidth: 22,
    alignItems: 'center',
    paddingVertical: 1,
    paddingHorizontal: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pinnedRowMain: {
    flex: 1,
  },
  iconButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  iconButtonDisabled: {
    opacity: 0.4,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  breadcrumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  outletPlaceholder: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  outletMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  surfacesPanel: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  surfacesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  surfaceRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  surfaceCopy: {
    flex: 1,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: colors.accent,
  },
});

const navBadgeToneStyles = StyleSheet.create({
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  accent: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
});

const navBadgeTextStyles = StyleSheet.create({
  danger: {
    color: colors.danger,
  },
  accent: {
    color: colors.accent,
  },
  warning: {
    color: colors.warning,
  },
});


