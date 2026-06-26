// Native parity port of web/src/components/ui/CommandPalette.tsx.
//
// The web source is a keyboard-driven command palette built on DOM, framer-motion
// (motion / AnimatePresence), lucide-react glyphs, react-router-dom useNavigate,
// react-i18next, the shared web UI <Input>, the @/lib/cn merger, and a stack of
// browser-only helper modules (palettePrefix, commandRegistry scoreCommand,
// commandFrecency, recentPages, useSelectedVehicle, useCommandRegistry, COMMANDS,
// Layout.navSections, onboarding checklist) plus window CustomEvent wiring.
//
// This port reproduces the same state machine, item-aggregation pipeline, fuzzy
// scoring, frecency ranking, prefix-scoping, and visual intent with React Native
// View/Pressable/Modal/ScrollView/TextInput primitives, AppText glyph badges, the
// native design tokens, and the already-converted native parity hooks
// (useVehicles / useVehicleCommand / useGlobalSearch / useIsForwardAuth). The pure
// helper modules that have no native equivalent yet are ported inline verbatim so
// behaviour (scoring tiers, decay math, LRU, prefix table) is preserved exactly.
//
// Native-safe adaptations (documented in the sidecar):
//   * framer-motion overlay -> RN Modal (fade) + backdrop Pressable.
//   * lucide icons -> compact AppText glyph badges (PaletteGlyph).
//   * react-router useNavigate -> onNavigate?(path) prop; go() also records a
//     recent page (web relied on a separate RecentPagesRecorder mounted in App).
//   * window 'toggle-command-palette' CustomEvent + Ctrl+K -> module
//     commandPaletteBus that the exported CommandPaletteTrigger toggles.
//   * window Escape keydown + DOM input keydown -> TextInput onKeyPress +
//     Modal onRequestClose (hardware keyboards on RN Windows/macOS); touch is the
//     primary interaction on phones/tablets (tap a row to run its action).
//   * element.scrollIntoView -> ScrollView scrollTo() driven by per-row onLayout
//     offsets captured into a ref.
//   * localStorage frecency / recent stores -> in-memory module stores
//     (session-scoped on native). Public helper API surface is preserved.
//   * useCommandRegistry -> registryCommands prop (default []); the web registry
//     binds web-only providers (theme/router/toast) not present in native.
//   * useSelectedVehicle -> in-memory selected-vehicle store hook.
//   * markCommandPaletteDiscovered -> native no-op (onboarding not wired yet).
//   * react-i18next useTranslation -> useNativeTranslationFallback (English
//     fallbacks with {var} interpolation), preserving every key + intent.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {useIsForwardAuth} from '../../api/hooks/useAuthMode';
import {useGlobalSearch, type SearchHitType} from '../../api/hooks/useSearch';
import {useVehicleCommand} from '../../api/hooks/useVehicleCommand';
import {useVehicles, type Vehicle} from '../../api/hooks/useVehicles';

// ─── i18n fallback ───────────────────────────────────────────────────────────

type TranslationVars = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{\{?(\w+)\}?\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, applying the
 * same `{{var}}`/`{var}` interpolation react-i18next would (preserving intent).
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, vars) => {
    if (!vars) {
      return fallback;
    }
    return interpolate(fallback, vars);
  }, []);
}

// ─── palettePrefix (ported verbatim from web/src/lib/palettePrefix.ts) ────────

/** All paletteable item types that map to a scope. */
export type PaletteScope = 'command' | 'navigate' | 'vehicle-switch' | 'registry';

/** Per-scope display metadata. */
export interface PaletteScopeMeta {
  prefix: string;
  label: string;
  placeholder: string;
  types: ReadonlyArray<PaletteScope>;
}

export const PALETTE_SCOPE_TABLE: ReadonlyArray<
  readonly [PaletteScope, PaletteScopeMeta]
> = [
  ['command', {prefix: '>', label: 'Commands', placeholder: 'Search commands…', types: ['command']}],
  ['navigate', {prefix: '/', label: 'Pages', placeholder: 'Search pages…', types: ['navigate']}],
  ['vehicle-switch', {prefix: '@', label: 'Vehicles', placeholder: 'Switch vehicle…', types: ['vehicle-switch']}],
  ['registry', {prefix: ':', label: 'Settings', placeholder: 'Search settings…', types: ['registry']}],
];

const PREFIX_TO_SCOPE: Record<string, PaletteScope> = Object.fromEntries(
  PALETTE_SCOPE_TABLE.map(([scope, meta]) => [meta.prefix, scope]),
);

const SCOPE_TO_META: Record<PaletteScope, PaletteScopeMeta> = Object.fromEntries(
  PALETTE_SCOPE_TABLE,
) as Record<PaletteScope, PaletteScopeMeta>;

export const PALETTE_PREFIX_CHARS: ReadonlyArray<string> = PALETTE_SCOPE_TABLE.map(
  ([, m]) => m.prefix,
);

export interface ParsedPrefix {
  scope: PaletteScope | null;
  term: string;
}

export function parsePrefix(input: string): ParsedPrefix {
  if (!input) {
    return {scope: null, term: ''};
  }
  const head = input.charAt(0);
  const scope = PREFIX_TO_SCOPE[head];
  if (!scope) {
    return {scope: null, term: input};
  }
  let rest = input.slice(1);
  if (rest.startsWith(' ')) {
    rest = rest.slice(1);
  }
  return {scope, term: rest};
}

export function getScopeMeta(scope: PaletteScope): PaletteScopeMeta {
  return SCOPE_TO_META[scope];
}

export function isPaletteScope(
  value: string | null | undefined,
): value is PaletteScope {
  return value !== null && value !== undefined && value in SCOPE_TO_META;
}

export function itemMatchesScope(
  itemType: string | undefined,
  scope: PaletteScope | null,
): boolean {
  if (scope === null) {
    return true;
  }
  if (!itemType) {
    return false;
  }
  const meta = SCOPE_TO_META[scope];
  return (meta.types as ReadonlyArray<string>).includes(itemType);
}

export interface PaletteScopeHint {
  scope: PaletteScope;
  prefix: string;
  label: string;
}

export const PALETTE_SCOPE_HINTS: ReadonlyArray<PaletteScopeHint> =
  PALETTE_SCOPE_TABLE.map(([scope, meta]) => ({
    scope,
    prefix: meta.prefix,
    label: meta.label,
  }));

// ─── scoreCommand (ported verbatim from web/src/lib/commandRegistry.ts) ───────

export function scoreCommand(
  query: string,
  label: string,
  keywords: string[] = [],
): number {
  if (!query) {
    return 1;
  }
  const q = query.toLowerCase().trim();
  if (!q) {
    return 1;
  }
  const labelLower = label.toLowerCase();

  if (labelLower === q) {
    return 1000;
  }
  if (labelLower.startsWith(q)) {
    return 500 + q.length;
  }
  if (labelLower.includes(q)) {
    return 200 + q.length;
  }

  const acronym = labelLower
    .split(/[\s\-_/:.]+/)
    .map(w => w[0] ?? '')
    .join('');
  if (acronym.includes(q)) {
    return 150;
  }

  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.startsWith(q)) {
      return 100;
    }
    if (k.includes(q)) {
      return 50;
    }
  }

  let i = 0;
  for (const ch of labelLower) {
    if (ch === q[i]) {
      i++;
    }
    if (i === q.length) {
      return 25;
    }
  }

  return 0;
}

// ─── Command frecency (native-safe in-memory port of commandFrecency.ts) ──────
//
// Web persisted to localStorage so rankings survive reloads. Native has no
// synchronous web storage, so the store lives in module memory (session-scoped).
// The decay math (count × 2^(-ageDays / 14)) and the public API are identical.

const HALF_LIFE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export interface FrecencyEntry {
  count: number;
  lastUsed: number;
}

const frecencyStore: Record<string, FrecencyEntry> = {};

function decayScore(entry: FrecencyEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastUsed) / MS_PER_DAY);
  const decay = Math.pow(2, -ageDays / HALF_LIFE_DAYS);
  return entry.count * decay;
}

export function recordCommandUse(commandId: string): void {
  if (!commandId) {
    return;
  }
  const existing = frecencyStore[commandId] ?? {count: 0, lastUsed: 0};
  frecencyStore[commandId] = {count: existing.count + 1, lastUsed: Date.now()};
}

export function getCommandScore(commandId: string): number {
  const entry = frecencyStore[commandId];
  if (!entry) {
    return 0;
  }
  return decayScore(entry, Date.now());
}

export function getAllCommandScores(): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(frecencyStore)) {
    out[id] = decayScore(entry, now);
  }
  return out;
}

export function _resetFrecency(): void {
  for (const key of Object.keys(frecencyStore)) {
    delete frecencyStore[key];
  }
}

// ─── Recent commands LRU (native-safe in-memory port) ─────────────────────────
//
// Tracks every command type (vehicle, registry/action, navigation), capped at 10
// newest-first. Web persisted to localStorage; native keeps it in module memory.
// Kept as a backward-compatible storage primitive — every recorded action still
// writes here even though the empty-query "Most Used" section is sourced from the
// frecency store above.

const RECENT_MAX_STORED = 10;
const MOST_USED_MAX_DISPLAY = 5;

export interface RecentCommandEntry {
  kind: 'vehicle' | 'registry' | 'nav';
  command?: string;
  vehicleId?: number;
  registryId?: string;
  path?: string;
}

let recentCommands: RecentCommandEntry[] = [];

function recentKey(entry: RecentCommandEntry): string {
  switch (entry.kind) {
    case 'vehicle':
      return `vehicle:${entry.command}:${entry.vehicleId}`;
    case 'registry':
      return `registry:${entry.registryId}`;
    case 'nav':
      return `nav:${entry.path}`;
  }
}

export function getRecentCommands(): RecentCommandEntry[] {
  return recentCommands.slice();
}

export function addRecentCommand(entry: RecentCommandEntry): void {
  const target = recentKey(entry);
  const recent = recentCommands.filter(r => recentKey(r) !== target);
  recent.unshift(entry);
  if (recent.length > RECENT_MAX_STORED) {
    recent.length = RECENT_MAX_STORED;
  }
  recentCommands = recent;
}

export function _resetRecentCommands(): void {
  recentCommands = [];
}

// ─── Recent pages (native-safe in-memory port of recentPages.ts) ──────────────
//
// Web persisted to localStorage and recorded visits via a RecentPagesRecorder
// mounted in App.tsx; cross-tab/same-tab changes were broadcast over window
// events. Native keeps an in-memory list plus a Set-based subscriber bus, and the
// palette's own go() records the visit (replacing the absent route recorder).

export type RecentPageKind =
  | 'page'
  | 'vehicle'
  | 'drive'
  | 'trip'
  | 'charging'
  | 'geofence'
  | 'year-review';

export interface RecentEntry {
  path: string;
  title: string;
  kind: RecentPageKind;
  ref_id?: string;
  visited_at: number;
}

const RECENT_PAGES_MAX = 50;

const PATH_PATTERNS: {test: RegExp; kind: RecentPageKind}[] = [
  {test: /^\/vehicles\/([^/]+)(?:\/|$)/, kind: 'vehicle'},
  {test: /^\/drives\/([^/]+)(?:\/|$)/, kind: 'drive'},
  {test: /^\/charging\/([^/]+)(?:\/|$)/, kind: 'charging'},
  {test: /^\/trips\/([^/]+)(?:\/|$)/, kind: 'trip'},
  {test: /^\/geofences\/([^/]+)(?:\/|$)/, kind: 'geofence'},
  {test: /^\/year-review\/([^/]+)(?:\/|$)/, kind: 'year-review'},
];

export interface PathClassification {
  kind: RecentPageKind;
  ref_id?: string;
}

export function classifyPath(path: string): PathClassification {
  for (const p of PATH_PATTERNS) {
    const m = p.test.exec(path);
    if (m) {
      return {kind: p.kind, ref_id: m[1]};
    }
  }
  return {kind: 'page'};
}

const SKIP_PREFIXES = ['/onboarding', '/s/', '/watch'];
const SKIP_EXACT = new Set<string>(['/search', '/me/activity']);

export function shouldRecordPath(path: string): boolean {
  if (typeof path !== 'string') {
    return false;
  }
  if (!path || path[0] !== '/') {
    return false;
  }
  // Strip query/hash before classifying (hit URLs may carry ?q=…).
  const clean = path.split(/[?#]/)[0];
  if (SKIP_EXACT.has(clean)) {
    return false;
  }
  for (const pre of SKIP_PREFIXES) {
    if (pre.endsWith('/')) {
      if (clean === pre.slice(0, -1) || clean.startsWith(pre)) {
        return false;
      }
    } else if (clean === pre || clean.startsWith(pre + '/')) {
      return false;
    }
  }
  return true;
}

let recentPages: RecentEntry[] = [];
const recentPageSubscribers = new Set<() => void>();

function notifyRecentPages(): void {
  for (const handler of recentPageSubscribers) {
    try {
      handler();
    } catch {
      // Never let a subscriber crash the bus.
    }
  }
}

export interface RecordPageViewInput {
  path: string;
  title: string;
  kind?: RecentPageKind;
  ref_id?: string;
  now?: number;
}

export function recordPageView(input: RecordPageViewInput): void {
  const path = input?.path;
  if (!shouldRecordPath(path)) {
    return;
  }
  const clean = path.split(/[?#]/)[0];
  const cls = classifyPath(clean);
  const visited_at =
    typeof input.now === 'number' && Number.isFinite(input.now)
      ? input.now
      : Date.now();
  const title = (input.title && input.title.trim()) || clean;
  const entry: RecentEntry = {
    path: clean,
    title,
    kind: input.kind ?? cls.kind,
    ref_id: input.ref_id ?? cls.ref_id,
    visited_at,
  };
  const remaining = recentPages.filter(e => e.path !== clean);
  remaining.unshift(entry);
  if (remaining.length > RECENT_PAGES_MAX) {
    remaining.length = RECENT_PAGES_MAX;
  }
  recentPages = remaining;
  notifyRecentPages();
}

export function getRecentPages(limit?: number): RecentEntry[] {
  if (typeof limit === 'number') {
    return recentPages.slice(0, Math.max(0, limit));
  }
  return recentPages.slice();
}

export function clearRecentPages(): void {
  recentPages = [];
  notifyRecentPages();
}

export function subscribeRecentPages(handler: () => void): () => void {
  recentPageSubscribers.add(handler);
  return () => {
    recentPageSubscribers.delete(handler);
  };
}

// ─── Selected vehicle (native-safe in-memory port of useSelectedVehicle) ──────
//
// Web resolved the active vehicle from the router (path/query) then a persisted
// store. Native has no router here, so the precedence collapses to: in-memory
// store value -> first vehicle in the fleet. setVehicleId updates all consumers.

let selectedVehicleId: number | null = null;
const selectedVehicleSubscribers = new Set<() => void>();

function setSelectedVehicleIdGlobal(id: number | null): void {
  selectedVehicleId = id;
  for (const handler of selectedVehicleSubscribers) {
    try {
      handler();
    } catch {
      // swallow — never let a subscriber crash the store.
    }
  }
}

function useSelectedVehicleStore(): {
  vehicleId: number | null;
  setVehicleId: (id: number | null) => void;
} {
  const [vehicleId, setLocal] = useState<number | null>(selectedVehicleId);
  useEffect(() => {
    const handler = () => setLocal(selectedVehicleId);
    selectedVehicleSubscribers.add(handler);
    return () => {
      selectedVehicleSubscribers.delete(handler);
    };
  }, []);
  const setVehicleId = useCallback(
    (id: number | null) => setSelectedVehicleIdGlobal(id),
    [],
  );
  return {vehicleId, setVehicleId};
}

export interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicle: Vehicle | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

export function useSelectedVehicle(): SelectedVehicleResult {
  const {vehicleId: stored, setVehicleId} = useSelectedVehicleStore();
  const {data} = useVehicles();
  const vehicles = useMemo<Vehicle[]>(() => data ?? [], [data]);

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId, setVehicleId]);

  const effectiveId = stored ?? firstVehicleId;
  const vehicle = useMemo<Vehicle | null>(() => {
    if (effectiveId == null) {
      return null;
    }
    return vehicles.find(v => v.id === effectiveId) ?? null;
  }, [effectiveId, vehicles]);

  return {vehicleId: effectiveId, vehicle, vehicles, setVehicleId};
}

// ─── Command registry (native-safe) ──────────────────────────────────────────
//
// The web useCommandRegistry resolves a static registry against live web-only
// handles (router navigate, ThemeProvider, ToastProvider, QueryClient). None of
// those exist in native parity, so registry commands are supplied by the host via
// the optional `registryCommands` prop (default []) and carry a glyph instead of
// a lucide icon component.

export interface ResolvedCommand {
  id: string;
  label: string;
  section: string;
  glyph?: string;
  keywords: string[];
  shortcut?: string;
  source?: 'registry' | 'extension';
  invoke: () => void | Promise<void>;
}

// ─── Onboarding (native-safe no-op) ───────────────────────────────────────────

let commandPaletteDiscovered = false;

export function markCommandPaletteDiscovered(): void {
  commandPaletteDiscovered = true;
}

export function _wasCommandPaletteDiscovered(): boolean {
  return commandPaletteDiscovered;
}

// ─── Command palette toggle bus (native-safe replacement for window event) ────

const paletteToggleSubscribers = new Set<() => void>();

export const commandPaletteBus = {
  toggle(): void {
    for (const handler of paletteToggleSubscribers) {
      try {
        handler();
      } catch {
        // swallow
      }
    }
  },
  subscribe(handler: () => void): () => void {
    paletteToggleSubscribers.add(handler);
    return () => {
      paletteToggleSubscribers.delete(handler);
    };
  },
};

export function emitToggleCommandPalette(): void {
  commandPaletteBus.toggle();
}

// ─── Navigation data (ported from web/src/components/layout/Layout.tsx) ───────

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

/** Per-section compact glyph badge code (replaces lucide section icons). */
const SECTION_GLYPHS: Record<string, string> = {
  Home: 'HM',
  Vehicles: 'EV',
  Driving: 'DR',
  Charging: 'BC',
  Battery: 'BT',
  Energy: 'ZP',
  Service: 'WN',
  Cabin: 'CB',
  Reports: 'AN',
  Commands: 'GP',
  Automation: 'WF',
  Notifications: 'NO',
  Security: 'SH',
  Account: 'US',
  Settings: 'SE',
  Integrations: 'LN',
  Data: 'DB',
  Diagnostics: 'AC',
  About: 'i',
};

export interface NavItemDef {
  to: string;
  label: string;
  requiresAuth?: boolean;
}

export interface NavSectionDef {
  title: string;
  items: NavItemDef[];
}

export const navSections: NavSectionDef[] = [
  {title: 'Home', items: [
    {to: '/', label: 'Dashboard'},
    {to: '/explore', label: 'Explore Features'},
    {to: '/live', label: 'Live Map'},
    {to: '/timeline', label: 'Timeline'},
    {to: '/weekly-digest', label: 'Weekly Digest'},
  ]},
  {title: 'Vehicles', items: [
    {to: '/vehicles', label: 'My Vehicles'},
    {to: '/digital-twin', label: 'Vehicle Live View'},
    {to: '/vehicle-comparison', label: 'Compare Vehicles'},
    {to: '/locations', label: 'Saved Locations'},
  ]},
  {title: 'Driving', items: [
    {to: '/drives', label: 'Drives'},
    {to: '/trips', label: 'Trips'},
    {to: '/trip-planner', label: 'Trip Planner'},
    {to: '/navigation', label: 'Navigation'},
    {to: '/geofences', label: 'Geofences'},
    {to: '/mileage', label: 'Mileage Log'},
    {to: '/lifetime-stats', label: 'Lifetime Stats'},
    {to: '/drive-score', label: 'Drive Score'},
    {to: '/speed-profile', label: 'Speed Profile'},
    {to: '/driving-dynamics', label: 'Driving Dynamics'},
    {to: '/regen-efficiency', label: 'Regen Braking'},
    {to: '/route-efficiency', label: 'Route Efficiency'},
  ]},
  {title: 'Charging', items: [
    {to: '/charging', label: 'Charging Overview'},
    {to: '/tesla-charging-history', label: 'Charge History'},
    {to: '/charging-curve', label: 'Charging Curve'},
    {to: '/charging-heatmap', label: 'Charging Patterns'},
    {to: '/smart-charge', label: 'Smart Charging'},
    {to: '/powershare', label: 'Powershare'},
  ]},
  {title: 'Battery', items: [
    {to: '/battery', label: 'Battery Health'},
    {to: '/battery-cells', label: 'Battery Cells'},
    {to: '/battery-degradation', label: 'Battery Degradation'},
    {to: '/projected-range', label: 'Projected Range'},
    {to: '/vampire-drain', label: 'Vampire Drain'},
    {to: '/sleep-efficiency', label: 'Sleep Efficiency'},
  ]},
  {title: 'Energy', items: [
    {to: '/energy', label: 'Energy Usage'},
    {to: '/energy-flow', label: 'Energy Flow'},
    {to: '/power-flow', label: 'Power Flow'},
    {to: '/energy-products', label: 'Solar & Powerwall'},
  ]},
  {title: 'Service', items: [
    {to: '/tire-pressure', label: 'Tire Pressure'},
    {to: '/drivetrain-health', label: 'Drivetrain Health'},
    {to: '/software-updates', label: 'Software Updates'},
    {to: '/maintenance', label: 'Maintenance'},
  ]},
  {title: 'Cabin', items: [
    {to: '/climate-control', label: 'Climate Control'},
    {to: '/media-player', label: 'Media Player'},
  ]},
  {title: 'Reports', items: [
    {to: '/statistics', label: 'Statistics'},
    {to: '/analytics', label: 'Analytics'},
    {to: '/period-compare', label: 'Period Comparison'},
    {to: '/efficiency', label: 'Efficiency'},
    {to: '/temperature-impact', label: 'Temperature Impact'},
    {to: '/cost-analysis', label: 'Cost Analysis'},
    {to: '/tco', label: 'Cost of Ownership'},
  ]},
  {title: 'Commands', items: [
    {to: '/commands', label: 'Send Commands'},
    {to: '/command-history', label: 'Command History'},
  ]},
  {title: 'Automation', items: [
    {to: '/automations', label: 'Automations'},
    {to: '/notifications/studio', label: 'Alert Studio'},
    {to: '/notifications/rules', label: 'Alert Rules'},
  ]},
  {title: 'Notifications', items: [
    {to: '/notifications/inbox', label: 'Notification Inbox'},
    {to: '/notifications/alerts', label: 'Alert Center'},
    {to: '/notifications/channels', label: 'Notification Channels'},
    {to: '/notifications/webhooks', label: 'Webhooks'},
    {to: '/notifications/browser', label: 'Browser Notifications'},
    {to: '/notifications/quiet-hours', label: 'Quiet Hours'},
  ]},
  {title: 'Security', items: [
    {to: '/security-access', label: 'Security & Access'},
    {to: '/safety-settings', label: 'Safety Settings'},
    {to: '/guard-mode', label: 'Guard Mode'},
  ]},
  {title: 'Account', items: [
    {to: '/tesla-account', label: 'Tesla Account'},
    {to: '/tesla-orders', label: 'Active Orders'},
    {to: '/fleet-api', label: 'Fleet API'},
    {to: '/tesla-region', label: 'Region & API'},
    {to: '/tesla-features', label: 'Feature Flags'},
    {to: '/account/2fa', label: 'Two-Factor Auth', requiresAuth: true},
    {to: '/account/sessions', label: 'Active Sessions', requiresAuth: true},
    {to: '/account/privacy', label: 'Privacy'},
    {to: '/me/activity', label: 'My Activity', requiresAuth: true},
  ]},
  {title: 'Settings', items: [
    {to: '/settings', label: 'General Settings'},
    {to: '/chatbot', label: 'Helix Chat'},
    {to: '/dev-tools', label: 'Developer Tools'},
  ]},
  {title: 'Integrations', items: [
    {to: '/integrations/helix', label: 'Helix'},
    {to: '/api-keys', label: 'API Keys'},
    {to: '/gas-price', label: 'Gas Prices'},
  ]},
  {title: 'Data', items: [
    {to: '/data-export', label: 'Data Export'},
    {to: '/backup', label: 'Backup & Restore'},
    {to: '/data-repair', label: 'Data Repair'},
  ]},
  {title: 'Diagnostics', items: [
    {to: '/system-status', label: 'System Status'},
    {to: '/db-health', label: 'Database Health'},
    {to: '/anomaly-detection', label: 'Anomaly Detection'},
    {to: '/signals', label: 'Live Signals'},
    {to: '/admin/live-signals', label: 'Live Signal Inspector'},
    {to: '/admin/ingest-xray', label: 'Ingest X-Ray'},
    {to: '/admin/dlq', label: 'DLQ Inspector'},
    {to: '/admin/flags', label: 'Feature Flags'},
    {to: '/admin/schema-drift', label: 'Schema Drift'},
    {to: '/admin/slow-queries', label: 'Slow Queries'},
    {to: '/admin/vehicle-cost', label: 'Vehicle Cost'},
    {to: '/admin/disk-forecast', label: 'Disk Forecast'},
    {to: '/admin/secret-rotation', label: 'Secret Rotation'},
    {to: '/admin/audit-log', label: 'Audit Log'},
    {to: '/admin/gdpr-exports', label: 'GDPR Exports'},
    {to: '/state-debugger', label: 'State Debugger'},
    {to: '/mqtt-inspector', label: 'MQTT Inspector'},
    {to: '/redis-signals', label: 'Redis Signals'},
    {to: '/admin/telemetry/coverage', label: 'Telemetry Coverage'},
    {to: '/api-logs', label: 'API Logs'},
    {to: '/api-playground', label: 'API Playground'},
  ]},
  {title: 'About', items: [
    {to: '/roadmap', label: 'Roadmap'},
  ]},
];

/** Stable path -> label lookup, used to title recorded recent-page visits. */
const NAV_PATH_LABELS: Record<string, string> = Object.fromEntries(
  navSections.flatMap(section => section.items.map(item => [item.to, item.label])),
);

// ─── Palette-eligible vehicle commands (ported from web) ──────────────────────
//
// The web build looked each config's `defId` up in the COMMANDS catalog to pull a
// lucide icon (and skipped configs with no matching def). Every listed defId is
// present in the canonical catalog at runtime, so the native port carries a fixed
// glyph per config instead of the def-map lookup.

interface PaletteCommandConfig {
  command: string;
  labelKey: string;
  labelFallback: string;
  keywords: string[];
  glyph: string;
}

const PALETTE_COMMAND_CONFIGS: PaletteCommandConfig[] = [
  // Security
  {command: 'wake_up', labelKey: 'palette.cmd.wakeUp', labelFallback: 'Wake Up Vehicle', keywords: ['wake', 'power', 'start', 'online'], glyph: 'PW'},
  {command: 'lock', labelKey: 'palette.cmd.lock', labelFallback: 'Lock Vehicle', keywords: ['lock', 'security', 'doors', 'secure'], glyph: 'LK'},
  {command: 'unlock', labelKey: 'palette.cmd.unlock', labelFallback: 'Unlock Vehicle', keywords: ['unlock', 'open', 'doors'], glyph: 'UL'},
  {command: 'sentry_on', labelKey: 'palette.cmd.sentryOn', labelFallback: 'Sentry Mode On', keywords: ['sentry', 'guard', 'security', 'surveillance'], glyph: 'GD'},
  {command: 'sentry_off', labelKey: 'palette.cmd.sentryOff', labelFallback: 'Sentry Mode Off', keywords: ['sentry', 'off', 'security'], glyph: 'SO'},
  // Climate
  {command: 'climate_on', labelKey: 'palette.cmd.climateOn', labelFallback: 'Climate On', keywords: ['climate', 'ac', 'heat', 'cool', 'hvac', 'temperature'], glyph: 'CL'},
  {command: 'climate_off', labelKey: 'palette.cmd.climateOff', labelFallback: 'Climate Off', keywords: ['climate', 'off', 'ac', 'stop'], glyph: 'CO'},
  {command: 'dog_mode', labelKey: 'palette.cmd.dogMode', labelFallback: 'Dog Mode', keywords: ['dog', 'pet', 'mode', 'keep'], glyph: 'DG'},
  {command: 'camp_mode', labelKey: 'palette.cmd.campMode', labelFallback: 'Camp Mode', keywords: ['camp', 'camping', 'mode', 'keep'], glyph: 'TN'},
  // Charging
  {command: 'charge_port_open', labelKey: 'palette.cmd.chargePortOpen', labelFallback: 'Open Charge Port', keywords: ['charge', 'port', 'open', 'plug'], glyph: 'PL'},
  {command: 'close_charge_port', labelKey: 'palette.cmd.chargePortClose', labelFallback: 'Close Charge Port', keywords: ['charge', 'port', 'close'], glyph: 'PX'},
  {command: 'charge_start', labelKey: 'palette.cmd.chargeStart', labelFallback: 'Start Charging', keywords: ['charge', 'start', 'begin', 'plug'], glyph: 'CH'},
  {command: 'charge_stop', labelKey: 'palette.cmd.chargeStop', labelFallback: 'Stop Charging', keywords: ['charge', 'stop', 'end'], glyph: 'CS'},
  {command: 'charge_max_range', labelKey: 'palette.cmd.chargeMax', labelFallback: 'Charge to Max Range', keywords: ['charge', 'max', 'range', 'trip'], glyph: 'CM'},
  {command: 'charge_standard', labelKey: 'palette.cmd.chargeStandard', labelFallback: 'Charge to Standard', keywords: ['charge', 'standard', 'daily'], glyph: 'CD'},
  // Doors & Trunk
  {command: 'frunk_open', labelKey: 'palette.cmd.frunk', labelFallback: 'Open Frunk', keywords: ['frunk', 'front', 'trunk', 'hood'], glyph: 'FK'},
  {command: 'trunk_open', labelKey: 'palette.cmd.trunk', labelFallback: 'Open Trunk', keywords: ['trunk', 'rear', 'boot'], glyph: 'TK'},
  // Windows
  {command: 'vent_windows', labelKey: 'palette.cmd.ventWindows', labelFallback: 'Vent Windows', keywords: ['vent', 'windows', 'open', 'air'], glyph: 'VW'},
  {command: 'close_windows', labelKey: 'palette.cmd.closeWindows', labelFallback: 'Close Windows', keywords: ['close', 'windows', 'shut'], glyph: 'CW'},
  // Alerts
  {command: 'honk_horn', labelKey: 'palette.cmd.horn', labelFallback: 'Honk Horn', keywords: ['horn', 'honk', 'beep', 'sound'], glyph: 'HN'},
  {command: 'flash_lights', labelKey: 'palette.cmd.flash', labelFallback: 'Flash Lights', keywords: ['flash', 'lights', 'blink', 'find'], glyph: 'FL'},
  // Media
  {command: 'media_toggle_playback', labelKey: 'palette.cmd.playPause', labelFallback: 'Play / Pause', keywords: ['play', 'pause', 'music', 'media'], glyph: 'PP'},
  {command: 'media_next_track', labelKey: 'palette.cmd.nextTrack', labelFallback: 'Next Track', keywords: ['next', 'track', 'skip', 'music'], glyph: 'NT'},
  {command: 'media_prev_track', labelKey: 'palette.cmd.prevTrack', labelFallback: 'Previous Track', keywords: ['previous', 'track', 'back', 'music'], glyph: 'PT'},
];

// ─── Search-hit + recent-page helpers (glyph equivalents of lucide icons) ─────

function searchHitGlyph(type: SearchHitType): string {
  switch (type) {
    case 'vehicle':
      return 'EV';
    case 'drive':
      return 'DR';
    case 'charging':
      return 'BC';
    case 'alert':
      return 'NA';
    case 'notification':
      return 'NO';
    case 'geofence':
      return 'PN';
    case 'automation':
      return 'WF';
    case 'location':
      return 'LO';
    case 'trip':
      return 'TR';
    default:
      return 'SR';
  }
}

function searchSectionLabel(type: SearchHitType, t: NativeTFunction): string {
  switch (type) {
    case 'vehicle':
      return t('search.section.vehicle', 'Vehicles');
    case 'drive':
      return t('search.section.drive', 'Drives');
    case 'charging':
      return t('search.section.charging', 'Charging');
    case 'alert':
      return t('search.section.alert', 'Alerts');
    case 'notification':
      return t('search.section.notification', 'Notifications');
    case 'geofence':
      return t('search.section.geofence', 'Geofences');
    case 'automation':
      return t('search.section.automation', 'Automations');
    case 'location':
      return t('search.section.location', 'Locations');
    case 'trip':
      return t('search.section.trip', 'Trips');
    default:
      return t('search.section.results', 'Results');
  }
}

const RECENT_PAGES_DISPLAY_LIMIT = MOST_USED_MAX_DISPLAY;

function recentPageGlyph(kind: RecentPageKind): string {
  switch (kind) {
    case 'vehicle':
      return 'EV';
    case 'drive':
      return 'DR';
    case 'charging':
      return 'BC';
    case 'trip':
      return 'TR';
    case 'geofence':
      return 'PN';
    case 'year-review':
      return 'CA';
    default:
      return 'TX';
  }
}

function formatRecentVisitedAgo(
  t: NativeTFunction,
  visitedAt: number,
  now: number,
): string {
  const diffMs = Math.max(0, now - visitedAt);
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return t('palette.recent.justNow', 'Just now');
  }
  if (diffMin < 60) {
    return t('palette.recent.minutesAgo', `${diffMin}m ago`);
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return t('palette.recent.hoursAgo', `${diffHr}h ago`);
  }
  const diffDay = Math.floor(diffHr / 24);
  return t('palette.recent.daysAgo', `${diffDay}d ago`);
}

// ─── PaletteItem ──────────────────────────────────────────────────────────────

interface PaletteItem {
  id: string;
  label: string;
  section: string;
  /** Compact glyph code rendered in the row badge (replaces the lucide node). */
  glyph: string;
  action: () => void;
  keywords?: string[];
  type?: 'navigate' | 'command' | 'registry' | 'vehicle-switch' | 'search-hit';
  sublabel?: string;
  /** Display-only shortcut hint shown next to the item (e.g. "?" or "g d"). */
  shortcut?: string;
}

// ─── Glyph badge (compact lucide replacement) ─────────────────────────────────

function PaletteGlyph({code, accent}: {code: string; accent?: boolean}) {
  return (
    <View style={[styles.glyph, accent ? styles.glyphAccent : null]}>
      <AppText
        variant="caption"
        weight="bold"
        style={[styles.glyphText, accent ? styles.glyphTextAccent : null]}>
        {code}
      </AppText>
    </View>
  );
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  /** Called when the palette opens — host uses this to close the mobile sidebar. */
  onOpen?: () => void;
  /**
   * Native navigation sink. The web used react-router's useNavigate; native hosts
   * pass their navigator here. Defaults to a no-op (the recent-page + frecency
   * bookkeeping still runs so the palette's own surfaces stay consistent).
   */
  onNavigate?: (path: string) => void;
  /**
   * Host-supplied registry commands (theme toggles, refresh, jump-to-feature).
   * The web hook bound web-only providers that native parity lacks, so this is an
   * injected list (default []).
   */
  registryCommands?: ResolvedCommand[];
}

export function CommandPalette({
  onOpen,
  onNavigate,
  registryCommands = [],
}: CommandPaletteProps) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<'search' | 'vehicle-select'>('search');
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [recentVersion, setRecentVersion] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const groupOffsets = useRef<Map<number, number>>(new Map());
  const rowOffsets = useRef<Map<number, {group: number; y: number}>>(new Map());

  const {data: vehicles} = useVehicles();
  const vehicleList = useMemo<Vehicle[]>(() => vehicles ?? [], [vehicles]);
  const commandMutation = useVehicleCommand();
  const {vehicleId: activeVehicleId, setVehicleId} = useSelectedVehicle();

  // ── Actions ─────────────────────────────────────────────────────────────────

  const close = useCallback(() => {
    setOpen(false);
    setMode('search');
    setPendingCommand(null);
  }, []);

  const goBack = useCallback(() => {
    setMode('search');
    setPendingCommand(null);
    setSelectedIndex(0);
    setQuery('');
  }, []);

  const bumpRecent = useCallback(() => setRecentVersion(v => v + 1), []);

  const go = useCallback(
    (path: string) => {
      addRecentCommand({kind: 'nav', path});
      recordCommandUse(path);
      // Native adaptation: the web recorded recent pages via a route-change
      // recorder mounted in App. Native has no router here, so the palette's own
      // navigation records the visit (shouldRecordPath still filters /search etc).
      const cleanPath = path.split(/[?#]/)[0];
      recordPageView({path, title: NAV_PATH_LABELS[cleanPath] ?? cleanPath});
      bumpRecent();
      onNavigate?.(path);
      close();
    },
    [bumpRecent, onNavigate, close],
  );

  const executeCommand = useCallback(
    (command: string, vehicleId: number) => {
      commandMutation.mutate({vehicleId, command});
      addRecentCommand({kind: 'vehicle', command, vehicleId});
      recordCommandUse(`cmd-${command}`);
      bumpRecent();
      close();
    },
    [commandMutation, close, bumpRecent],
  );

  const selectCommand = useCallback(
    (command: string) => {
      if (vehicleList.length === 1) {
        executeCommand(command, vehicleList[0].id);
      } else if (vehicleList.length > 1) {
        setPendingCommand(command);
        setMode('vehicle-select');
        setSelectedIndex(0);
        setQuery('');
      }
    },
    [vehicleList, executeCommand],
  );

  const switchActiveVehicle = useCallback(
    (id: number) => {
      setVehicleId(id);
      addRecentCommand({kind: 'registry', registryId: `switch-vehicle-${id}`});
      recordCommandUse(`switch-vehicle-${id}`);
      bumpRecent();
      close();
    },
    [setVehicleId, close, bumpRecent],
  );

  const runRegistryCommand = useCallback(
    (cmd: ResolvedCommand) => {
      addRecentCommand({kind: 'registry', registryId: cmd.id});
      recordCommandUse(cmd.id);
      bumpRecent();
      void cmd.invoke();
      close();
    },
    [close, bumpRecent],
  );

  // ── Build palette items ───────────────────────────────────────────────────

  const isForwardAuth = useIsForwardAuth();

  const navItems: PaletteItem[] = useMemo(
    () =>
      navSections.flatMap(section =>
        section.items
          .filter(item => !item.requiresAuth || isForwardAuth)
          .map(item => {
            const keywords = navSearchKeywords[item.to] ?? [];
            const sublabel =
              keywords.length > 0
                ? `${section.title} · ${keywords.slice(0, 3).join(', ')}`
                : section.title;
            return {
              id: item.to,
              label: item.label,
              section: t('palette.section.pages', 'Pages'),
              glyph: SECTION_GLYPHS[section.title] ?? 'PG',
              action: () => go(item.to),
              keywords,
              sublabel,
              type: 'navigate' as const,
            };
          }),
      ),
    [go, t, isForwardAuth],
  );

  const commandItems: PaletteItem[] = useMemo(() => {
    if (vehicleList.length === 0) {
      return [];
    }
    const vehicleName =
      vehicleList.length === 1
        ? vehicleList[0].display_name || vehicleList[0].vin
        : undefined;
    return PALETTE_COMMAND_CONFIGS.map(cfg => ({
      id: `cmd-${cfg.command}`,
      label: t(cfg.labelKey, cfg.labelFallback),
      section: t('palette.section.commands', 'Vehicle Commands'),
      glyph: cfg.glyph,
      keywords: cfg.keywords,
      type: 'command' as const,
      sublabel: vehicleName
        ? `→ ${vehicleName}`
        : t('palette.cmd.selectVehicle', 'Select vehicle…'),
      action: () => selectCommand(cfg.command),
    }));
  }, [vehicleList, t, selectCommand]);

  // Vehicle SWITCHING — one entry per vehicle that re-scopes the selection and
  // stays on the current page. Hidden for single-vehicle fleets; the active
  // vehicle is also hidden so the list never includes a no-op.
  const vehicleSwitchItems: PaletteItem[] = useMemo(() => {
    if (vehicleList.length < 2) {
      return [];
    }
    return vehicleList
      .filter(v => v.id !== activeVehicleId)
      .map(v => ({
        id: `switch-vehicle-${v.id}`,
        label: t(
          'palette.cmd.switchVehicle',
          `Switch to ${v.display_name || v.vin}`,
        ),
        section: t('palette.section.vehicles', 'Vehicles'),
        glyph: '><',
        type: 'vehicle-switch' as const,
        sublabel: `${v.model ?? ''} · ${v.state ?? 'unknown'}`.trim(),
        keywords: [
          'switch',
          'vehicle',
          'select',
          v.display_name ?? '',
          v.vin ?? '',
        ].filter(Boolean) as string[],
        action: () => switchActiveVehicle(v.id),
      }));
  }, [vehicleList, activeVehicleId, t, switchActiveVehicle]);

  // Host-supplied static registry: theme, refresh, navigate-to-feature, etc.
  const registryItems: PaletteItem[] = useMemo(
    () =>
      registryCommands.map(c => {
        const sectionLabel =
          c.section === 'preferences'
            ? t('palette.section.preferences', 'Preferences')
            : c.section === 'actions'
              ? t('palette.section.actions', 'Actions')
              : c.section === 'pages'
                ? t('palette.section.pages', 'Pages')
                : t('palette.section.vehicles', 'Vehicles');
        return {
          id: c.id,
          label: c.label,
          section: sectionLabel,
          glyph: c.glyph ?? 'PR',
          keywords: c.keywords,
          shortcut: c.shortcut,
          type: 'registry' as const,
          action: () => runRegistryCommand(c),
        };
      }),
    [registryCommands, t, runRegistryCommand],
  );

  // ── Most-used items (empty-query frecency ranking) ──────────────────────────
  const mostUsedItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) {
      return [];
    }
    void recentVersion;
    const candidates: PaletteItem[] = [
      ...registryItems,
      ...vehicleSwitchItems,
      ...navItems,
      ...commandItems,
    ];
    const scores = getAllCommandScores();
    const ranked = candidates
      .map(item => ({item, score: scores[item.id] ?? 0}))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MOST_USED_MAX_DISPLAY);
    const sectionLabel = t('palette.section.mostUsed', 'Most Used');
    return ranked.map(
      ({item}): PaletteItem => ({
        ...item,
        id: `most-used-${item.id}`,
        section: sectionLabel,
      }),
    );
  }, [query, recentVersion, registryItems, vehicleSwitchItems, navItems, commandItems, t]);

  // ── Recent pages ──────────────────────────────────────────────────────────
  useEffect(() => {
    return subscribeRecentPages(() => bumpRecent());
  }, [bumpRecent]);

  const recentPageItems: PaletteItem[] = useMemo(() => {
    if (query.trim()) {
      return [];
    }
    void recentVersion;
    const now = Date.now();
    const sectionLabel = t('palette.section.recent', 'Recent');
    return getRecentPages(RECENT_PAGES_DISPLAY_LIMIT).map(
      (entry): PaletteItem => ({
        id: `recent-page-${entry.path}`,
        label: entry.title,
        sublabel: formatRecentVisitedAgo(t, entry.visited_at, now),
        section: sectionLabel,
        glyph: recentPageGlyph(entry.kind),
        type: 'navigate' as const,
        keywords: [entry.path, entry.kind],
        action: () => go(entry.path),
      }),
    );
  }, [query, recentVersion, t, go]);

  // ── Vehicle selector items ──────────────────────────────────────────────────
  const vehicleItems: PaletteItem[] = useMemo(
    () =>
      vehicleList.map(v => ({
        id: `vehicle-${v.id}`,
        label: v.display_name || v.vin,
        section: t('palette.section.selectVehicle', 'Select Vehicle'),
        glyph: 'EV',
        type: 'navigate' as const,
        sublabel: `${v.model ?? ''} · ${v.state ?? 'unknown'}`.trim(),
        action: () => {
          if (pendingCommand) {
            executeCommand(pendingCommand, v.id);
          }
        },
      })),
    [vehicleList, pendingCommand, executeCommand, t],
  );

  // ── Live entity search (debounced, scope-aware) ─────────────────────────────
  const parsedQuery = useMemo(() => parsePrefix(query), [query]);
  const activeScope: PaletteScope | null = parsedQuery.scope;
  const scopedTerm = parsedQuery.term;

  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const trimmed = scopedTerm.trim();
    if (trimmed.length === 0) {
      setDebouncedQuery('');
      return;
    }
    const handle = setTimeout(() => setDebouncedQuery(trimmed), 200);
    return () => clearTimeout(handle);
  }, [scopedTerm]);

  const {data: searchData} = useGlobalSearch(debouncedQuery, {
    disabled: mode !== 'search' || activeScope !== null,
    limit: 5,
  });

  const searchResultItems: PaletteItem[] = useMemo(() => {
    const hits = searchData?.hits ?? [];
    if (hits.length === 0) {
      return [];
    }
    return hits.map(
      (hit): PaletteItem => ({
        id: `search-${hit.type}-${hit.id}`,
        label: hit.title,
        sublabel: hit.subtitle,
        section: searchSectionLabel(hit.type, t),
        glyph: searchHitGlyph(hit.type),
        type: 'search-hit',
        action: () => go(hit.url),
      }),
    );
  }, [searchData, t, go]);

  const showViewAllResults =
    (searchData?.hits?.length ?? 0) > 0 && debouncedQuery.length >= 2;

  // ── Filtered items ──────────────────────────────────────────────────────────
  const allItems = useMemo(
    () => [
      ...searchResultItems,
      ...mostUsedItems,
      ...recentPageItems,
      ...registryItems,
      ...vehicleSwitchItems,
      ...navItems,
      ...commandItems,
    ],
    [searchResultItems, mostUsedItems, recentPageItems, registryItems, vehicleSwitchItems, navItems, commandItems],
  );

  const filtered = useMemo(() => {
    const scopedItems =
      activeScope === null
        ? allItems
        : allItems.filter(cmd => itemMatchesScope(cmd.type, activeScope));

    if (!scopedTerm.trim()) {
      return scopedItems;
    }
    void recentVersion;
    const frecencyScores = getAllCommandScores();
    const scored = scopedItems
      .map(cmd => {
        if (cmd.type === 'search-hit') {
          return {cmd, score: 9999, frecency: 0};
        }
        let best = scoreCommand(scopedTerm, cmd.label, cmd.keywords);
        if (best === 0) {
          const q = scopedTerm.toLowerCase();
          if ((cmd.sublabel ?? '').toLowerCase().includes(q)) {
            best = 10;
          } else if (cmd.section.toLowerCase().includes(q)) {
            best = 5;
          }
        }
        const lookupId = cmd.id.startsWith('most-used-')
          ? cmd.id.slice('most-used-'.length)
          : cmd.id;
        const frecency = frecencyScores[lookupId] ?? 0;
        return {cmd, score: best, frecency};
      })
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score || b.frecency - a.frecency);
    return scored.map(s => s.cmd);
  }, [allItems, activeScope, scopedTerm, recentVersion]);

  const displayItems = mode === 'vehicle-select' ? vehicleItems : filtered;

  const displayItemIdsKey = useMemo(
    () => displayItems.map(item => item.id).join('\u0000'),
    [displayItems],
  );

  const effectiveSelectedIndex =
    displayItems.length > 0
      ? Math.min(selectedIndex, displayItems.length - 1)
      : 0;

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, mode, displayItemIdsKey]);

  // Global toggle bus (native replacement for the window 'toggle-command-palette'
  // CustomEvent dispatched by the web keyboard-shortcut layer / Ctrl+K).
  useEffect(() => {
    return commandPaletteBus.subscribe(() => setOpen(prev => !prev));
  }, []);

  // Focus input when opened; reset transient state; notify host.
  useEffect(() => {
    if (open) {
      markCommandPaletteDiscovered();
      setQuery('');
      setSelectedIndex(0);
      setMode('search');
      setPendingCommand(null);
      onOpen?.();
      const handle = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(handle);
    }
  }, [open, onOpen]);

  // Scroll the selected row into view. Web used element.scrollIntoView; native
  // combines the per-group + per-row onLayout offsets captured below.
  useEffect(() => {
    const info = rowOffsets.current.get(effectiveSelectedIndex);
    if (!info) {
      return;
    }
    const groupY = groupOffsets.current.get(info.group) ?? 0;
    scrollRef.current?.scrollTo({y: Math.max(0, groupY + info.y - 8), animated: false});
  }, [effectiveSelectedIndex, displayItemIdsKey]);

  // ── Keyboard handling (hardware keyboards; touch is primary) ────────────────

  const handleEscape = useCallback(() => {
    if (mode === 'vehicle-select') {
      goBack();
    } else if (open && activeScope !== null) {
      setQuery('');
      setSelectedIndex(0);
    } else {
      setOpen(false);
    }
  }, [mode, goBack, open, activeScope]);

  const handleInputKey = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;
      const maxIndex = displayItems.length - 1;
      if (key === 'ArrowDown') {
        if (maxIndex >= 0) {
          setSelectedIndex(prev => Math.min(Math.min(prev, maxIndex) + 1, maxIndex));
        }
      } else if (key === 'ArrowUp') {
        if (maxIndex >= 0) {
          setSelectedIndex(prev => Math.max(Math.min(prev, maxIndex) - 1, 0));
        }
      } else if (key === 'Backspace' && query === '' && mode === 'vehicle-select') {
        goBack();
      } else if (
        key === 'Backspace' &&
        activeScope !== null &&
        scopedTerm === '' &&
        mode === 'search'
      ) {
        setQuery('');
        setSelectedIndex(0);
      } else if (key === 'Escape') {
        handleEscape();
      }
    },
    [displayItems.length, query, mode, activeScope, scopedTerm, goBack, handleEscape],
  );

  const handleSubmit = useCallback(() => {
    const item = displayItems[effectiveSelectedIndex];
    if (item) {
      item.action();
    }
  }, [displayItems, effectiveSelectedIndex]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const pendingCommandLabel = useMemo(() => {
    if (!pendingCommand) {
      return '';
    }
    const cfg = PALETTE_COMMAND_CONFIGS.find(c => c.command === pendingCommand);
    return cfg ? t(cfg.labelKey, cfg.labelFallback) : pendingCommand;
  }, [pendingCommand, t]);

  const groupedItems = useMemo(() => {
    const groups: {
      section: string;
      items: {item: PaletteItem; globalIndex: number}[];
    }[] = [];
    let currentSection = '';
    displayItems.forEach((item, i) => {
      if (item.section !== currentSection) {
        currentSection = item.section;
        groups.push({section: currentSection, items: []});
      }
      groups[groups.length - 1].items.push({item, globalIndex: i});
    });
    return groups;
  }, [displayItems]);

  // ── Render ────────────────────────────────────────────────────────────────

  const emptyMessage =
    mode === 'vehicle-select'
      ? t('palette.noVehicles', 'No vehicles available')
      : activeScope !== null && !scopedTerm
        ? t(
            `palette.scope.${activeScope}.empty`,
            `No ${getScopeMeta(activeScope).label.toLowerCase()} available`,
          )
        : t('palette.noResults', `No results for "${scopedTerm || query}"`);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleEscape}
      testID="command-palette">
      <View style={styles.overlayRoot}>
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel={t('palette.close', 'Close')}
          onPress={close}
        />
        <View style={styles.card}>
          {/* Search input / vehicle-select header */}
          <View style={styles.header}>
            {mode === 'vehicle-select' ? (
              <>
                <Pressable
                  onPress={goBack}
                  accessibilityRole="button"
                  accessibilityLabel={t('palette.back', 'Back')}
                  style={styles.headerIconButton}>
                  <AppText weight="bold" style={styles.headerIconText}>
                    {'‹'}
                  </AppText>
                </Pressable>
                <View style={styles.headerSelectLabel}>
                  <PaletteGlyph code="ZP" accent />
                  <AppText tone="secondary" style={styles.headerSelectText}>
                    {t(
                      'palette.selectVehicleFor',
                      `Send "${pendingCommandLabel}" to…`,
                    )}
                  </AppText>
                </View>
              </>
            ) : (
              <>
                <PaletteGlyph code="SR" />
                {activeScope !== null && (
                  <Pressable
                    onPress={() => {
                      setQuery('');
                      setSelectedIndex(0);
                      inputRef.current?.focus();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t(
                      'palette.clearScope',
                      `Clear ${getScopeMeta(activeScope).label} filter`,
                    )}
                    style={styles.scopeChip}>
                    <AppText style={styles.scopeChipPrefix}>
                      {getScopeMeta(activeScope).prefix}
                    </AppText>
                    <AppText style={styles.scopeChipLabel}>
                      {t(
                        `palette.scope.${activeScope}`,
                        getScopeMeta(activeScope).label,
                      )}
                    </AppText>
                    <AppText style={styles.scopeChipClose}>{'×'}</AppText>
                  </Pressable>
                )}
                <TextInput
                  ref={inputRef}
                  value={scopedTerm}
                  onChangeText={next => {
                    if (activeScope === null) {
                      setQuery(next);
                    } else {
                      setQuery(`${getScopeMeta(activeScope).prefix} ${next}`);
                    }
                  }}
                  onKeyPress={handleInputKey}
                  onSubmitEditing={handleSubmit}
                  placeholder={
                    activeScope !== null
                      ? t(
                          `palette.placeholder.${activeScope}`,
                          getScopeMeta(activeScope).placeholder,
                        )
                      : t('palette.placeholder', 'Search pages, commands…')
                  }
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="go"
                  style={styles.input}
                />
                <View style={styles.kbd}>
                  <AppText style={styles.kbdText}>ESC</AppText>
                </View>
              </>
            )}
          </View>

          {/* Results */}
          <ScrollView
            ref={scrollRef}
            style={styles.results}
            keyboardShouldPersistTaps="handled">
            {displayItems.length === 0 ? (
              <AppText tone="muted" style={styles.emptyText}>
                {emptyMessage}
              </AppText>
            ) : (
              groupedItems.map((group, groupIndex) => (
                <View
                  key={`${group.section}-${groupIndex}`}
                  onLayout={(e: LayoutChangeEvent) =>
                    groupOffsets.current.set(groupIndex, e.nativeEvent.layout.y)
                  }>
                  <AppText style={styles.sectionHeader}>
                    {group.section.toUpperCase()}
                  </AppText>
                  {group.items.map(({item, globalIndex}) => {
                    const isCommand = item.type === 'command';
                    const isSelected = globalIndex === effectiveSelectedIndex;
                    return (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityState={{selected: isSelected}}
                        onPress={item.action}
                        onLayout={(e: LayoutChangeEvent) =>
                          rowOffsets.current.set(globalIndex, {
                            group: groupIndex,
                            y: e.nativeEvent.layout.y,
                          })
                        }
                        style={[styles.row, isSelected ? styles.rowSelected : null]}>
                        <PaletteGlyph
                          code={item.glyph}
                          accent={isCommand || isSelected}
                        />
                        <View style={styles.rowBody}>
                          <View style={styles.rowLabelLine}>
                            <AppText
                              numberOfLines={1}
                              weight="semibold"
                              style={styles.rowLabel}>
                              {item.label}
                            </AppText>
                            {isCommand && (
                              <AppText style={styles.rowZap}>{'⚡'}</AppText>
                            )}
                          </View>
                          {item.sublabel ? (
                            <AppText
                              numberOfLines={1}
                              tone="muted"
                              style={styles.rowSublabel}>
                              {item.sublabel}
                            </AppText>
                          ) : null}
                        </View>
                        {item.shortcut ? (
                          <View
                            style={styles.kbd}
                            accessibilityLabel={t(
                              'palette.shortcut',
                              `Shortcut: ${item.shortcut}`,
                            )}>
                            <AppText style={styles.kbdText}>{item.shortcut}</AppText>
                          </View>
                        ) : null}
                        {isSelected && (
                          <AppText style={styles.rowArrow}>{'→'}</AppText>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
            {showViewAllResults && mode === 'search' && (
              <View style={styles.viewAllWrap}>
                <Pressable
                  onPress={() =>
                    go(`/search?q=${encodeURIComponent(debouncedQuery)}`)
                  }
                  accessibilityRole="button"
                  style={styles.viewAllButton}>
                  <View style={styles.viewAllLeft}>
                    <PaletteGlyph code="SR" />
                    <AppText tone="secondary" style={styles.viewAllText}>
                      {t(
                        'search.palette.viewAll',
                        `View all results for "${debouncedQuery}"`,
                      )}
                    </AppText>
                  </View>
                  <AppText style={styles.rowArrow}>{'→'}</AppText>
                </Pressable>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={styles.footerRow}>
              <View style={styles.footerHint}>
                <View style={styles.kbd}>
                  <AppText style={styles.kbdText}>↑↓</AppText>
                </View>
                <AppText tone="muted" style={styles.footerHintText}>
                  {t('palette.navigate', 'Navigate')}
                </AppText>
              </View>
              <View style={styles.footerHint}>
                <View style={styles.kbd}>
                  <AppText style={styles.kbdText}>↵</AppText>
                </View>
                <AppText tone="muted" style={styles.footerHintText}>
                  {t('palette.select', 'Select')}
                </AppText>
              </View>
              <View style={styles.footerHint}>
                <View style={styles.kbd}>
                  <AppText style={styles.kbdText}>ESC</AppText>
                </View>
                <AppText tone="muted" style={styles.footerHintText}>
                  {mode === 'vehicle-select'
                    ? t('palette.back', 'Back')
                    : activeScope !== null
                      ? t('palette.clearFilter', 'Clear filter')
                      : t('palette.close', 'Close')}
                </AppText>
              </View>
              {mode === 'search' && vehicleList.length > 0 && (
                <View style={styles.footerVehicles}>
                  <AppText style={styles.footerVehiclesText}>
                    {'⚡ '}
                    {vehicleList.length}{' '}
                    {vehicleList.length === 1
                      ? t('palette.vehicle', 'vehicle')
                      : t('palette.vehicles', 'vehicles')}
                  </AppText>
                </View>
              )}
            </View>
            {mode === 'search' && activeScope === null && query === '' && (
              <View style={styles.scopeHints}>
                <AppText tone="muted" style={styles.scopeHintsLabel}>
                  {t('palette.filterBy', 'Filter')}
                </AppText>
                {PALETTE_SCOPE_HINTS.map(hint => (
                  <Pressable
                    key={hint.scope}
                    accessibilityRole="button"
                    onPress={() => {
                      setQuery(`${hint.prefix} `);
                      setSelectedIndex(0);
                      inputRef.current?.focus();
                    }}
                    style={styles.scopeHintButton}>
                    <View style={styles.kbd}>
                      <AppText style={styles.kbdText}>{hint.prefix}</AppText>
                    </View>
                    <AppText tone="muted" style={styles.scopeHintText}>
                      {t(`palette.scope.${hint.scope}`, hint.label)}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Trigger button for the sidebar ───────────────────────────────────────────

export function CommandPaletteTrigger() {
  const t = useNativeTranslationFallback();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('palette.placeholder', 'Search pages, commands…')}
      onPress={() => emitToggleCommandPalette()}
      style={styles.trigger}>
      <PaletteGlyph code="SR" />
      <AppText tone="muted" style={styles.triggerLabel}>
        {t('palette.triggerLabel', 'Search...')}
      </AppText>
      <View style={styles.kbd}>
        <AppText style={styles.kbdText}>⌘K</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  glyph: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  } as ViewStyle,
  glyphAccent: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  } as ViewStyle,
  glyphText: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.3,
    color: colors.textMuted,
  } as TextStyle,
  glyphTextAccent: {
    color: colors.accent,
  } as TextStyle,

  overlayRoot: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingTop: 72,
    alignItems: 'center',
  } as ViewStyle,
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 5, 10, 0.72)',
  } as ViewStyle,
  card: {
    width: '100%',
    maxWidth: 560,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.panel,
  } as ViewStyle,

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  } as ViewStyle,
  headerIconButton: {
    padding: 6,
    borderRadius: 8,
  } as ViewStyle,
  headerIconText: {
    fontSize: 20,
    lineHeight: 22,
    color: colors.textMuted,
  } as TextStyle,
  headerSelectLabel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  } as ViewStyle,
  headerSelectText: {
    fontSize: 13,
    flexShrink: 1,
  } as TextStyle,
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
  } as ViewStyle,
  scopeChipPrefix: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  } as TextStyle,
  scopeChipLabel: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  } as TextStyle,
  scopeChipClose: {
    color: colors.accent,
    fontSize: 13,
    opacity: 0.7,
  } as TextStyle,
  input: {
    flex: 1,
    paddingVertical: 0,
    fontSize: 14,
    color: colors.textPrimary,
  } as TextStyle,
  kbd: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
  } as ViewStyle,
  kbdText: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    fontWeight: '600',
  } as TextStyle,

  results: {
    maxHeight: 360,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  } as ViewStyle,
  emptyText: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontSize: 13,
  } as TextStyle,
  sectionHeader: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 4,
  } as TextStyle,
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  } as ViewStyle,
  rowSelected: {
    backgroundColor: colors.surfaceSelected,
    borderWidth: 1,
    borderColor: colors.borderAccent,
  } as ViewStyle,
  rowBody: {
    flex: 1,
    minWidth: 0,
  } as ViewStyle,
  rowLabelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  } as ViewStyle,
  rowLabel: {
    flexShrink: 1,
    fontSize: 14,
    color: colors.textPrimary,
  } as TextStyle,
  rowZap: {
    fontSize: 11,
    color: colors.accent,
  } as TextStyle,
  rowSublabel: {
    fontSize: 11,
    marginTop: 1,
  } as TextStyle,
  rowArrow: {
    fontSize: 14,
    color: colors.accent,
  } as TextStyle,
  viewAllWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 4,
    paddingTop: spacing.sm,
  } as ViewStyle,
  viewAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  } as ViewStyle,
  viewAllLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  } as ViewStyle,
  viewAllText: {
    fontSize: 12,
    flexShrink: 1,
  } as TextStyle,

  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  } as ViewStyle,
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
  } as ViewStyle,
  footerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  } as ViewStyle,
  footerHintText: {
    fontSize: 11,
  } as TextStyle,
  footerVehicles: {
    marginLeft: 'auto',
  } as ViewStyle,
  footerVehiclesText: {
    fontSize: 11,
    color: colors.accent,
    fontWeight: '600',
  } as TextStyle,
  scopeHints: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  } as ViewStyle,
  scopeHintsLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
  } as TextStyle,
  scopeHintButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  } as ViewStyle,
  scopeHintText: {
    fontSize: 10,
  } as TextStyle,

  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  } as ViewStyle,
  triggerLabel: {
    flex: 1,
    fontSize: 14,
  } as TextStyle,
});
