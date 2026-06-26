// Native parity port of web/src/hooks/useSettings.ts.
//
// `useSettings` fetches application settings from the API (cached for 5 min) and
// returns the settings state plus non-conversion settings-derived flags/labels
// (isMiles / isFahrenheit / isPSI / decimals / locale / density / rangeType).
// Measurement display conversion lives in `useUnits`; currency/cost formatting
// lives in `useFormatting`. That separation of responsibilities is preserved.
//
// The web hook leans on five sibling modules that the native parity layer has
// not ported yet, so — following the self-contained `useEditLease` /
// `useAchievementCelebrationPrefs` precedent — native-safe equivalents are
// inlined here and documented in the sidecar:
//
//   - `../lib/numberFormat`  (setGlobalPrecision / setGlobalLocale): pure
//     module-level formatter globals. Ported verbatim (clamp 0..20, en-US
//     fallback) with matching getters so a future native formatter can read
//     them — the native stand-in for the shared formatter state.
//   - `../lib/locale`        (resolveLocale): pure BCP-47 fallback. Ported 1:1.
//   - `../lib/broadcastTopics` (TOPICS.SETTINGS_CHANGED): the single topic this
//     hook filters on, inlined as a typed constant.
//   - `../lib/broadcast`     (subscribe): a `BroadcastChannel` + localStorage
//     storage-event cross-tab bus. React Native has neither, so this is replaced
//     by a native-safe settings bus that auto-detects a global
//     `BroadcastChannel` (react-native-web / host polyfill), accepts a
//     host-injected transport, and is otherwise a documented no-op.
//   - `@/lib/notificationSound` (per-channel sound prefs barrel): the
//     localStorage-backed prefs store is ported to an injectable storage seam
//     (mirroring `useAchievementCelebrationPrefs`); the WebAudio player is out of
//     scope for this file because the web `useSettings` does not re-export it.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or web UI
// components are imported — only `react`, `@tanstack/react-query`, and the
// already-ported native `../api/settings` + `../api/types`.

import {useEffect, useSyncExternalStore} from 'react';
import {useQuery} from '@tanstack/react-query';

import {getSettings} from '../api/settings';
import type {AppSettings} from '../api/types';

// ─── Formatter globals (native stand-in for ../lib/numberFormat) ─────────────
//
// Module-level decimal precision + locale, set by `useSettings` and read by
// number formatters. Pure JS — no browser APIs — so the web logic ports
// unchanged. Exposed via getters so a future native formatter module can read
// the current values, the native analog of the shared `numberFormat` globals.

let globalPrecision = 2;
let globalLocale = 'en-US';

/** Set the global decimal precision (called by useSettings on load). */
function setGlobalPrecision(decimals: number): void {
  globalPrecision = Math.max(0, Math.min(20, decimals));
}

/** Get the current global decimal precision. */
export function getGlobalPrecision(): number {
  return globalPrecision;
}

/**
 * Set the global locale used by number formatters. Pass an empty or
 * obviously-invalid string and we fall back to "en-US" so consumers always get
 * a working formatter.
 */
function setGlobalLocale(locale: string): void {
  globalLocale = locale && locale.trim() ? locale : 'en-US';
}

/** Get the current global locale tag (BCP-47). */
export function getGlobalLocale(): string {
  return globalLocale;
}

// ─── Locale resolution (native stand-in for ../lib/locale) ───────────────────

/**
 * Locale resolution helper — single source of truth for BCP-47 fallback.
 *
 * The settings API can return `locale: ''` (empty string) when no locale has
 * been set yet. The `??` operator does NOT catch empty strings, so
 * `s.locale ?? 'en-US'` evaluates to `''`. Passing that to a locale-aware
 * formatter throws. Degrade empty/whitespace inputs to en-US instead.
 */
export function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return 'en-US';
}

// ─── Broadcast topics (native stand-in for ../lib/broadcastTopics) ───────────
//
// `useSettings` only ever filters on the settings umbrella topic, so only that
// constant is inlined. The value matches the web `TOPICS.SETTINGS_CHANGED`
// discriminator verbatim so a shared host bus stays wire-compatible.

const TOPICS = {
  /** Umbrella event for any AppSettings mutation (units, locale, decimals…). */
  SETTINGS_CHANGED: 'settings.changed',
} as const;

// ─── Native-safe settings bus (replaces ../lib/broadcast) ────────────────────
//
// The web bus is a `BroadcastChannel` with a `localStorage` storage-event
// fallback that fans settings mutations across BROWSER TABS. React Native has no
// tabs, no `BroadcastChannel`, and no `localStorage`, so by default there is no
// peer to hear from. Following the `useEditLease` port the browser-only
// transport is replaced by a native-safe seam that auto-detects a global
// `BroadcastChannel` when one exists (react-native-web build / host polyfill),
// accepts a host-injected transport, and is otherwise a documented no-op.

/**
 * Settings bus message. `useSettings` re-reads from `useSettings()` on any
 * `settings.changed`, so only the discriminator (+ optional debug `keys` hint)
 * is modelled.
 */
export interface SettingsBusMessage {
  type: string;
  keys?: readonly string[];
}

/**
 * Pluggable cross-instance transport. A host may inject one via
 * {@link setSettingsBusTransport} to make settings changes propagate across real
 * surfaces (sockets, push fanout, a `BroadcastChannel` polyfill, …). The default
 * transport auto-detects a global `BroadcastChannel` and is otherwise a no-op.
 */
export interface SettingsBusTransport {
  /** Subscribe to messages from OTHER surfaces. Returns an unsubscribe fn. */
  subscribe(handler: (msg: SettingsBusMessage) => void): () => void;
}

/**
 * Generate a v4-shaped identifier without Web Crypto. React Native ships no
 * `crypto.randomUUID` by default; this is for self-filter uniqueness only, NOT
 * cryptographically secure.
 */
function safeRandomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === 'x' ? rand : (rand % 4) + 8;
    return value.toString(16);
  });
}

/** Stable per-instance identifier used to filter self-broadcasts. */
export const TAB_ID: string = safeRandomUUID();

/** Channel name kept identical to the web bus so a shared host can bridge. */
const BUS_CHANNEL_NAME = 'teslasync';

/** Internal envelope wrapper stripped on receive (matches the web bus shape). */
interface BusEnvelope {
  _from: string;
  msg: SettingsBusMessage;
}

// React Native's tsconfig omits the DOM lib, so the optional global
// `BroadcastChannel` is typed structurally (mirrors the useEditLease port).
interface NativeBroadcastChannel {
  addEventListener(
    type: 'message',
    listener: (event: {data?: unknown}) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: {data?: unknown}) => void,
  ): void;
}

type NativeBroadcastChannelConstructor = new (
  name: string,
) => NativeBroadcastChannel;

function getBroadcastChannelConstructor(): NativeBroadcastChannelConstructor | null {
  const candidate = (
    globalThis as typeof globalThis & {BroadcastChannel?: unknown}
  ).BroadcastChannel;
  return typeof candidate === 'function'
    ? (candidate as NativeBroadcastChannelConstructor)
    : null;
}

/**
 * Build a transport backed by a real `BroadcastChannel` when the platform
 * provides one. Carries the same `_from: TAB_ID` envelope + self-filter as the
 * web bus so a surface never receives its own message.
 */
function createBroadcastChannelTransport(): SettingsBusTransport | null {
  const Constructor = getBroadcastChannelConstructor();
  if (!Constructor) {
    return null;
  }
  let channel: NativeBroadcastChannel;
  try {
    channel = new Constructor(BUS_CHANNEL_NAME);
  } catch {
    // Some embedded contexts expose the constructor but forbid construction.
    return null;
  }
  return {
    subscribe(handler) {
      const listener = (event: {data?: unknown}) => {
        const envelope = event.data as BusEnvelope | null;
        if (!envelope || typeof envelope !== 'object') {
          return;
        }
        if (envelope._from === TAB_ID) {
          return;
        }
        if (!envelope.msg || typeof envelope.msg !== 'object') {
          return;
        }
        try {
          handler(envelope.msg);
        } catch {
          // Subscriber threw — never let one consumer crash the bus.
        }
      };
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
  };
}

/**
 * Reason surfaced when no settings bus transport is available. On pure native
 * (no `BroadcastChannel`, no host-injected transport) cross-surface settings
 * propagation is a no-op; the in-instance `useSettings()` still refetches
 * normally via TanStack Query staleness/manual invalidation.
 */
export const SETTINGS_BUS_UNAVAILABLE_REASON =
  'React Native has no BroadcastChannel or cross-tab storage event; settings ' +
  'changes propagate within the running instance only until a host transport ' +
  'is wired via setSettingsBusTransport.';

let injectedTransport: SettingsBusTransport | null = null;
let resolvedTransport: SettingsBusTransport | null | undefined;

function getSettingsBusTransport(): SettingsBusTransport | null {
  if (injectedTransport) {
    return injectedTransport;
  }
  if (resolvedTransport === undefined) {
    resolvedTransport = createBroadcastChannelTransport();
  }
  return resolvedTransport;
}

/**
 * Wire (or clear) the native settings bus transport — the native analog of the
 * web cross-tab bus. Pass `null` to fall back to auto-detection.
 */
export function setSettingsBusTransport(
  transport: SettingsBusTransport | null,
): void {
  injectedTransport = transport;
}

/**
 * Subscribe to settings-bus messages from OTHER surfaces. Returns an
 * unsubscribe function. A documented no-op when no transport is available.
 */
function subscribeSettingsBus(
  handler: (msg: SettingsBusMessage) => void,
): () => void {
  const transport = getSettingsBusTransport();
  if (!transport) {
    return () => {};
  }
  return transport.subscribe(handler);
}

// ─── Notification sound prefs (native stand-in for @/lib/notificationSound) ──
//
// Re-exported so callers can import everything settings-related from this hook,
// matching the web barrel. The web module persists per-channel prefs in
// `localStorage` and syncs tabs via the window `storage` event. React Native has
// neither, so — following `useAchievementCelebrationPrefs` — persistence is an
// injectable seam (`NotificationSoundPrefsStorage`); until a host wires one the
// store is in-memory only and persistence is a documented no-op while in-session
// reactive updates still apply. The WebAudio player from the web module is not
// re-exported by `useSettings`, so it is intentionally out of scope here.

export const NOTIFICATION_SOUND_CATEGORIES = [
  'critical_alert',
  'warning_alert',
  'info_alert',
  'charge_complete',
  'drive_complete',
  'automation_run',
  'achievement',
] as const;

export type NotificationSoundCategory =
  (typeof NOTIFICATION_SOUND_CATEGORIES)[number];

export interface NotificationSoundPrefs {
  /** Overall sound on/off. When false, every category is muted. */
  master: boolean;
  /** Per-category audio gate. */
  perCategory: Record<NotificationSoundCategory, boolean>;
  /** Output volume in [0, 1]. */
  volume: number;
}

export const DEFAULT_NOTIFICATION_SOUND_PREFS: NotificationSoundPrefs = {
  master: false,
  perCategory: {
    critical_alert: true,
    warning_alert: true,
    info_alert: false,
    charge_complete: true,
    drive_complete: false,
    automation_run: false,
    achievement: false,
  },
  volume: 0.6,
};

/**
 * Optional persistence backend. React Native has no localStorage and no
 * cross-tab `storage` event, so a host may inject an AsyncStorage/MMKV-style
 * seam to make preferences durable + shareable across surfaces. Until one is
 * provided the store is in-memory only and persistence is a documented no-op.
 */
export interface NotificationSoundPrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SOUND_PREFS_STORAGE_KEY = 'teslasync:notification-sound-prefs:v1';

let soundPrefsStorage: NotificationSoundPrefsStorage | null = null;

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) {
    return min;
  }
  if (n < min) {
    return min;
  }
  if (n > max) {
    return max;
  }
  return n;
}

function isCategoryKey(k: string): k is NotificationSoundCategory {
  return (NOTIFICATION_SOUND_CATEGORIES as readonly string[]).includes(k);
}

function normalizePerCategory(
  raw: unknown,
): NotificationSoundPrefs['perCategory'] {
  const out: NotificationSoundPrefs['perCategory'] = {
    ...DEFAULT_NOTIFICATION_SOUND_PREFS.perCategory,
  };
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isCategoryKey(k) && typeof v === 'boolean') {
        out[k] = v;
      }
    }
  }
  return out;
}

function normalizePrefs(raw: unknown): NotificationSoundPrefs {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_NOTIFICATION_SOUND_PREFS;
  }
  const r = raw as Partial<NotificationSoundPrefs>;
  return {
    master:
      typeof r.master === 'boolean'
        ? r.master
        : DEFAULT_NOTIFICATION_SOUND_PREFS.master,
    perCategory: normalizePerCategory(r.perCategory),
    volume:
      typeof r.volume === 'number'
        ? clamp(r.volume, 0, 1)
        : DEFAULT_NOTIFICATION_SOUND_PREFS.volume,
  };
}

function readSoundPrefs(): NotificationSoundPrefs {
  if (!soundPrefsStorage) {
    return DEFAULT_NOTIFICATION_SOUND_PREFS;
  }
  try {
    const raw = soundPrefsStorage.getItem(SOUND_PREFS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_NOTIFICATION_SOUND_PREFS;
    }
    return normalizePrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_NOTIFICATION_SOUND_PREFS;
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed (otherwise React raises an infinite-render).
let cachedSoundPrefs: NotificationSoundPrefs = readSoundPrefs();
let cachedSoundSerialized = JSON.stringify(cachedSoundPrefs);

function getSoundSnapshot(): NotificationSoundPrefs {
  return cachedSoundPrefs;
}

function refreshSoundSnapshot(): void {
  const next = readSoundPrefs();
  const serialized = JSON.stringify(next);
  if (serialized !== cachedSoundSerialized) {
    cachedSoundPrefs = next;
    cachedSoundSerialized = serialized;
  }
}

const soundListeners = new Set<() => void>();

function subscribeSoundPrefs(cb: () => void): () => void {
  // The web hook also attaches a window `storage` listener for cross-tab sync;
  // React Native has no such event, so external re-sync arrives via
  // `setNotificationSoundPrefsStorage` instead.
  soundListeners.add(cb);
  return () => {
    soundListeners.delete(cb);
  };
}

/**
 * Wire (or clear) the native persistence backend. Re-hydrates the cached prefs
 * from the new store and notifies subscribers — the native analog of the web's
 * cross-tab `storage` event re-sync.
 */
export function setNotificationSoundPrefsStorage(
  storage: NotificationSoundPrefsStorage | null,
): void {
  soundPrefsStorage = storage;
  refreshSoundSnapshot();
  for (const cb of soundListeners) {
    cb();
  }
}

export function useNotificationSoundPrefs(): NotificationSoundPrefs {
  return useSyncExternalStore(
    subscribeSoundPrefs,
    getSoundSnapshot,
    getSoundSnapshot,
  );
}

/** Synchronous accessor — useful inside event callbacks where hooks can't run. */
export function getNotificationSoundPrefs(): NotificationSoundPrefs {
  return cachedSoundPrefs;
}

/**
 * Imperatively patch sound prefs. Triggers a re-render in every mounted
 * `useNotificationSoundPrefs()`. Pass partial updates — unspecified keys retain
 * their current value. `perCategory` merges shallowly. Persists via the injected
 * storage backend when one is wired; otherwise the change applies for the
 * current session only.
 */
export interface NotificationSoundPrefsPatch {
  master?: boolean;
  volume?: number;
  perCategory?: Partial<NotificationSoundPrefs['perCategory']>;
}

export function setNotificationSoundPrefs(
  patch: NotificationSoundPrefsPatch,
): void {
  const nextPerCategory = patch.perCategory
    ? {...cachedSoundPrefs.perCategory, ...patch.perCategory}
    : cachedSoundPrefs.perCategory;
  const next: NotificationSoundPrefs = {
    master:
      typeof patch.master === 'boolean' ? patch.master : cachedSoundPrefs.master,
    perCategory: nextPerCategory,
    volume:
      typeof patch.volume === 'number'
        ? clamp(patch.volume, 0, 1)
        : cachedSoundPrefs.volume,
  };
  const serialized = JSON.stringify(next);
  if (serialized === cachedSoundSerialized) {
    return;
  }
  if (soundPrefsStorage) {
    try {
      soundPrefsStorage.setItem(SOUND_PREFS_STORAGE_KEY, serialized);
    } catch {
      // Storage may be unavailable (no backend, quota); fall through to the
      // in-memory update so the current session still reflects the toggle.
    }
  }
  cachedSoundPrefs = next;
  cachedSoundSerialized = serialized;
  for (const cb of soundListeners) {
    cb();
  }
}

// ─── Settings hook ───────────────────────────────────────────────────────────

const defaults: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  currency_symbol: '$',
  locale: 'en-US',
  tz_display_default: 'vehicle',
  timezone_user: '',
  tab_badge_enabled: true,
  critical_flash_enabled: true,
  ui_density: 'comfortable',
  time_format_default: 'relative',
  chart_palette: 'cb_safe',
  ai_mode: 'off',
  ai_features: {},
  ai_provider_config: {},
  ai_cost_cap_cents: 0,
};

/**
 * React hook providing application settings.
 *
 * Fetches settings from the API (cached for 5 min) and returns settings state
 * plus non-conversion settings-derived flags/labels. Measurement display
 * conversion lives in `useUnits`; currency/cost formatting lives in
 * `useFormatting`.
 */
export function useSettings() {
  const {data: settings, refetch} = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const raw = settings ?? defaults;
  // Backend may return `locale: ''` when the column has never been written.
  // `??` does NOT catch empty strings, so any consumer that does
  // `settings.locale ?? 'en-US'` (or passes it directly to a locale-aware
  // formatter) would break. Normalise once, here, so every downstream consumer
  // sees a valid BCP-47 tag.
  const s: AppSettings =
    raw.locale && raw.locale.trim().length > 0
      ? raw
      : {...raw, locale: defaults.locale};
  const decimals = s.decimal_precision ?? 2;
  const locale = resolveLocale(s.locale);
  const density: 'compact' | 'comfortable' | 'spacious' =
    s.ui_density === 'compact' || s.ui_density === 'spacious'
      ? s.ui_density
      : 'comfortable';

  // Sync global precision/locale after render so formatters stay aligned with settings.
  useEffect(() => {
    setGlobalPrecision(decimals);
    setGlobalLocale(locale);
  }, [decimals, locale]);

  // Refetch when another surface saves settings; TanStack Query dedupes overlaps.
  useEffect(() => {
    return subscribeSettingsBus(msg => {
      if (msg.type !== TOPICS.SETTINGS_CHANGED) {
        return;
      }
      void refetch();
    });
  }, [refetch]);

  const isMiles = s.unit_of_length === 'mi';
  const isFahrenheit = s.unit_of_temp === 'F';
  const isPSI = (s.unit_of_pressure ?? 'bar') === 'psi';

  const rangeType = s.preferred_range as 'rated' | 'ideal';

  return {
    settings: s,
    isMiles,
    isFahrenheit,
    isPSI,
    decimals,
    locale,
    density,
    rangeType,
  };
}
