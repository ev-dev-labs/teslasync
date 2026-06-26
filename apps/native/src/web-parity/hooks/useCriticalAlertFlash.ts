// Native parity port of web/src/hooks/useCriticalAlertFlash.ts.
//
// The web hook briefly prefixes the BROWSER TAB TITLE (document.title, via
// @/lib/titleStore setFlashPrefix) with "(!) ALERT — " when a `severity =
// "critical"` alert arrives over the shared sseManager SSE pipe AND the tab is
// backgrounded (document.hidden) — unless the alert is a test / quiet-hours-
// suppressed alert, the user prefers reduced motion, or `critical_flash_enabled`
// is off in Settings. The flash is cancelled the moment the user refocuses the
// tab (visibilitychange).
//
// Per-import native adaptation:
//   - react useEffect/useRef (web L1) -> useEffect/useRef + useState/useCallback
//     (the latter two back the native reduced-motion + i18n-fallback helpers).
//   - react-i18next useTranslation (web L2) -> native-safe
//     useNativeTranslationFallback returning t(key, fallback) => fallback,
//     preserving the i18n key/intent ('alerts.tabFlash', '(!) ALERT — ').
//   - @/hooks/useSettings useSettings (web L3) -> native ../api/hooks/useSettings
//     useSettings() (GET /settings); the `critical_flash_enabled !== false`
//     gate is kept verbatim (undefined while the query loads -> enabled,
//     matching the web default `critical_flash_enabled: true`).
//   - @/hooks/useMotionPreference useMotionPreference (web L4) -> native
//     useReduceMotion backed by AccessibilityInfo.isReduceMotionEnabled +
//     reduceMotionChanged (the established native prefers-reduced-motion
//     pattern); its boolean maps to the web `{ reduce }`.
//   - @/lib/sseManager sseManager (web L5) -> a host-provided global EventSource
//     polyfill on /api/v1/events (the established useAchievementUnlocks pattern),
//     listening to the same named 'alert' event. With no polyfill registered the
//     subscription reports 'unavailable' and the hook is inert
//     (CRITICAL_ALERT_FLASH_SSE_UNAVAILABLE_REASON).
//   - @/lib/titleStore setFlashPrefix (web L6) -> React Native has no
//     document.title / browser tab, so the alternating flash prefix is published
//     to an observable module store (subscribeCriticalAlertFlashPrefix /
//     getCriticalAlertFlashPrefix) that a native title surface MAY consume; the
//     web document.title write itself is unavailable
//     (CRITICAL_ALERT_FLASH_TITLE_UNAVAILABLE_REASON).
//   - document.hidden / visibilitychange (web L23/L61/L80-90) -> React Native
//     AppState; the web `document.hidden` (tab truly backgrounded, deliberately
//     NOT mere unfocus) maps to AppState 'background', so the hook only flashes
//     while backgrounded and stops the instant AppState leaves 'background'.
//
// No DOM, react-i18next, framer-motion, sseManager, Recharts, Leaflet, or web-UI
// imports are introduced.

import {useCallback, useEffect, useRef, useState} from 'react';
import {AccessibilityInfo, AppState, type AppStateStatus} from 'react-native';

import {apiUrl} from '../api/client';
import {useSettings} from '../api/hooks/useSettings';

const FLASH_INTERVAL_MS = 600;
// Total alternations including the initial frame; 6 -> ALERT, normal,
// ALERT, normal, ALERT, normal (i.e. 3 ALERT frames followed by a
// final normal-state restore).
const FLASH_FRAMES = 6;

const ALERT_EVENT = 'alert';
const EVENTS_PATH = '/events';

interface AlertEventData {
  severity?: string;
  quiet_suppressed?: boolean;
  is_test?: boolean;
}

export type CriticalAlertFlashRealtimeStatus = 'subscribed' | 'unavailable';

export const CRITICAL_ALERT_FLASH_TITLE_UNAVAILABLE_REASON =
  'React Native has no document.title / browser tab bar, so useCriticalAlertFlash cannot flash a tab title; the alternating "(!) ALERT — " prefix is instead published to the observable flash-prefix store (subscribeCriticalAlertFlashPrefix) for a native title surface to consume.';

export const CRITICAL_ALERT_FLASH_SSE_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; install a compatible polyfill to receive the critical "alert" SSE events that drive useCriticalAlertFlash.';

// ---- Native-safe flash-prefix sink (web @/lib/titleStore setFlashPrefix) -----

type FlashPrefixListener = (prefix: string) => void;

const flashPrefixListeners = new Set<FlashPrefixListener>();
let currentFlashPrefix = '';

// Native replacement for titleStore.setFlashPrefix: there is no document.title
// to write, so update module state and notify subscribers instead. Like the web
// titleStore.apply(), this fires unconditionally (even for a same-value set) so
// a native title surface stays in lock-step with the flash sequence.
function setFlashPrefix(prefix: string): void {
  currentFlashPrefix = prefix;
  for (const listener of Array.from(flashPrefixListeners)) {
    listener(prefix);
  }
}

/** Current critical-alert flash prefix ('' when not flashing). */
export function getCriticalAlertFlashPrefix(): string {
  return currentFlashPrefix;
}

/**
 * Subscribe to critical-alert flash-prefix changes. A native title surface can
 * use this to mirror the web browser-tab-title flash. Returns an unsubscribe.
 */
export function subscribeCriticalAlertFlashPrefix(
  listener: FlashPrefixListener,
): () => void {
  flashPrefixListeners.add(listener);
  return () => {
    flashPrefixListeners.delete(listener);
  };
}

// ---- Native-safe 'alert' SSE subscription (web @/lib/sseManager) -------------

type NativeEventSourceEvent = {
  readonly data?: unknown;
};

type NativeEventSourceListener = (event: NativeEventSourceEvent) => void;

interface NativeEventSource {
  addEventListener(event: string, listener: NativeEventSourceListener): void;
  removeEventListener?(
    event: string,
    listener: NativeEventSourceListener,
  ): void;
  close(): void;
}

type NativeEventSourceConstructor = new (url: string) => NativeEventSource;
type AlertListener = (data: unknown) => void;

const alertListeners = new Set<AlertListener>();
let source: NativeEventSource | null = null;

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (globalThis as typeof globalThis & {EventSource?: unknown})
    .EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

// The shared sseManager parses each SSE frame's JSON before dispatching to
// listeners; reproduce that here (string -> parsed object) while tolerating a
// polyfill that already delivers parsed data. Malformed/empty frames yield null,
// which the alert handler treats exactly like the web `(raw ?? {})` no-op.
function parseAlertData(raw: unknown): unknown {
  if (typeof raw === 'string') {
    if (raw.length === 0) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw ?? null;
}

function emitAlert(data: unknown): void {
  for (const listener of Array.from(alertListeners)) {
    listener(data);
  }
}

function handleAlertEvent(event: NativeEventSourceEvent): void {
  emitAlert(parseAlertData(event.data));
}

function subscribeAlerts(
  listener: AlertListener,
): CriticalAlertFlashRealtimeStatus {
  alertListeners.add(listener);

  if (source != null) {
    return 'subscribed';
  }

  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    return 'unavailable';
  }

  source = new EventSourceCtor(apiUrl(EVENTS_PATH));
  source.addEventListener(ALERT_EVENT, handleAlertEvent);
  return 'subscribed';
}

function unsubscribeAlerts(listener: AlertListener): void {
  alertListeners.delete(listener);

  if (alertListeners.size === 0 && source != null) {
    source.removeEventListener?.(ALERT_EVENT, handleAlertEvent);
    source.close();
    source = null;
  }
}

/** Whether the critical-alert SSE channel is currently consumable on RN. */
export function getCriticalAlertFlashRealtimeStatus(): CriticalAlertFlashRealtimeStatus {
  return getEventSourceConstructor() == null ? 'unavailable' : 'subscribed';
}

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// ---- Native reduced-motion preference (web @/hooks/useMotionPreference) ------

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// The web hook flashes only when `document.hidden` — i.e. the tab is truly
// backgrounded, deliberately NOT when merely unfocused-but-visible. On React
// Native that maps to AppState 'background' (not 'inactive', which is the
// transient/partially-obscured equivalent of an unfocused-but-visible window).
function isHidden(state: AppStateStatus): boolean {
  return state === 'background';
}

/**
 * Briefly publishes a `"(!) ALERT — "` flash prefix (web: a `document.title`
 * flash) when a `severity = "critical"` alert SSE event arrives AND the app is
 * backgrounded (web: `document.hidden`). Skips:
 *   - test alerts and quiet-hours-suppressed alerts
 *   - users with reduced motion enabled
 *   - users who disabled `critical_flash_enabled` in Settings
 *
 * The flash is cancelled immediately when the app returns to the foreground
 * (web: `visibilitychange`) so the prefix does not keep oscillating once the
 * user is paying attention.
 *
 * React Native has no browser tab title; the alternating prefix is published to
 * the observable flash-prefix store (subscribeCriticalAlertFlashPrefix) instead
 * (CRITICAL_ALERT_FLASH_TITLE_UNAVAILABLE_REASON), and the 'alert' SSE stream
 * needs a host EventSource polyfill (CRITICAL_ALERT_FLASH_SSE_UNAVAILABLE_REASON).
 *
 * Mount once near the root of the app.
 */
export function useCriticalAlertFlash(): void {
  const {data: settings} = useSettings();
  const reduce = useReduceMotion();
  const t = useNativeTranslationFallback();
  const enabled = settings?.critical_flash_enabled !== false;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled || reduce) {
      return;
    }

    const flashLabel = t('alerts.tabFlash', '(!) ALERT — ');

    const stopFlash = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setFlashPrefix('');
    };

    const onAlert = (raw: unknown) => {
      const data = (raw ?? {}) as AlertEventData;
      if (data.severity !== 'critical') {
        return;
      }
      if (data.quiet_suppressed || data.is_test) {
        return;
      }
      // Use AppState 'background' (rather than 'inactive') so we only flash when
      // the app is actually in the background, not when it is merely unfocused
      // but visible — mirroring the web `document.hidden` choice.
      if (!isHidden(AppState.currentState)) {
        return;
      }

      // Reset any in-flight flash so a back-to-back alert restarts the sequence
      // cleanly instead of overlapping ticks.
      stopFlash();

      // Paint the first frame immediately so the user sees the alert without
      // waiting for the first interval tick (~600 ms).
      setFlashPrefix(flashLabel);
      let i = 1;
      intervalRef.current = setInterval(() => {
        setFlashPrefix(i % 2 === 0 ? flashLabel : '');
        i += 1;
        if (i >= FLASH_FRAMES) {
          stopFlash();
        }
      }, FLASH_INTERVAL_MS);
    };

    const onAppStateChange = (state: AppStateStatus) => {
      if (!isHidden(state)) {
        // App returned to the foreground — stop flashing immediately.
        stopFlash();
      }
    };

    subscribeAlerts(onAlert);
    const appStateSubscription = AppState.addEventListener(
      'change',
      onAppStateChange,
    );

    return () => {
      unsubscribeAlerts(onAlert);
      appStateSubscription.remove();
      stopFlash();
    };
  }, [enabled, reduce, t]);
}

/**
 * Test-only helper mirroring titleStore.__resetTitleStoreForTests: clears the
 * flash prefix, drops all subscribers, and tears down the shared SSE source so
 * each test run starts from a clean module-singleton state.
 */
export function __resetCriticalAlertFlashForTests(): void {
  flashPrefixListeners.clear();
  currentFlashPrefix = '';
  alertListeners.clear();
  if (source != null) {
    source.removeEventListener?.(ALERT_EVENT, handleAlertEvent);
    source.close();
    source = null;
  }
}
