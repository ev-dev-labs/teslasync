import {useEffect, useRef} from 'react';
import {useQueryClient} from '@tanstack/react-query';

import {useSettings as useSettingsQuery} from '../api/hooks/useSettings';

/**
 * Keeps module-level formatter globals (`_globalLocale`, `_globalPrecision`)
 * in sync with the persisted user settings, regardless of which screen is
 * currently mounted.
 *
 * ## Why this exists
 *
 * The derived `useSettings()` formatting hook sets the formatter globals on
 * every render. That works whenever a screen actually consumes that hook —
 * which most screens do — but it leaves a hole:
 *
 *   1. A screen that imports a formatter directly (`fmtNumber`,
 *      `formatDuration`, …) without going through `useSettings()` will render
 *      with whatever locale/precision was last set.
 *   2. A defense-in-depth `settings.changed` topic fired outside the React
 *      Query layer would otherwise leave a screen whose only mounted tree
 *      never calls `useSettings()` sitting on stale globals until the user
 *      navigates.
 *
 * Mounting this bridge near the React root creates a permanent subscriber for
 * the `['settings']` query (so external invalidations always refetch) AND
 * applies the resolved locale + decimal precision to the module-level globals
 * via `useEffect` — without forcing every screen to remember to call
 * `useSettings()` itself.
 *
 * The bridge also subscribes to the {@link TOPICS.SETTINGS_CHANGED} broadcast
 * as a defense-in-depth path: if a future caller mutates settings without
 * going through the React Query layer, it can fire the topic directly and the
 * bridge will refetch.
 *
 * ## Native adaptation
 *
 * The web bridge subscribed to a cross-tab `BroadcastChannel` /
 * `localStorage` storage-event bus. React Native has no cross-tab/cross-window
 * concept, so that browser-only transport is unavailable. It is replaced by an
 * in-process listener registry: any in-app caller can fire the
 * `settings.changed` topic via {@link publishPrefsBroadcast} and the bridge
 * refetches. Cross-process delivery is intentionally a no-op — see
 * {@link nativeFormatterPrefsBridgeCapabilities}.
 *
 * ## Render output
 *
 * `null` — this is a side-effect-only mount. Place it under
 * `QueryClientProvider` (it uses TanStack Query) but outside any
 * screen-specific tree so it stays mounted for the lifetime of the app.
 */

/**
 * Documents which behaviors of the original web bridge survive the React
 * Native port and which degrade to explicit native-safe fallbacks.
 */
export const nativeFormatterPrefsBridgeCapabilities = {
  formatterGlobalsAvailable: true,
  permanentSettingsQuerySubscriberAvailable: true,
  inProcessSettingsTopicAvailable: true,
  crossTabBroadcastAvailable: false,
} as const;

/** Global decimal precision — set by the bridge, read by all formatters. */
let _globalPrecision = 2;

/** Global locale (BCP-47) — set by the bridge, read by all formatters. */
let _globalLocale = 'en-US';

/** Set the global decimal precision (called by the bridge on settings load). */
export function setGlobalPrecision(decimals: number): void {
  _globalPrecision = Math.max(0, Math.min(20, decimals));
}

/** Get the current global decimal precision. */
export function getGlobalPrecision(): number {
  return _globalPrecision;
}

/**
 * Set the global locale used by formatters. Pass an empty or obviously-invalid
 * string and we fall back to "en-US" so consumers always get a working
 * `Intl.NumberFormat` instance.
 */
export function setGlobalLocale(locale: string): void {
  _globalLocale = locale && locale.trim() ? locale : 'en-US';
}

/** Get the current global locale tag (BCP-47). */
export function getGlobalLocale(): string {
  return _globalLocale;
}

/**
 * Locale resolution helper — single source of truth for BCP-47 fallback.
 *
 * The settings API can return `locale: ''` (empty string) when no locale has
 * been set yet. The `??` operator does NOT catch empty strings, so
 * `s.locale ?? 'en-US'` evaluates to `''`. Passing that to `Intl.*` throws a
 * `RangeError`. This helper degrades empty/whitespace inputs gracefully to
 * en-US instead of crashing the rendering tree.
 */
export function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return 'en-US';
}

/**
 * Broadcast topic identifiers the bridge reacts to. Mirrors the web topic
 * registry; only the formatter-affecting umbrella topic is needed here.
 */
export const TOPICS = {
  /** Umbrella event for any settings mutation (units, locale, decimals, …). */
  SETTINGS_CHANGED: 'settings.changed',
} as const;

/** Minimal in-process broadcast message envelope. */
export interface NativePrefsBroadcastMessage {
  type: string;
  keys?: ReadonlyArray<string>;
}

const settingsTopicListeners = new Set<
  (msg: NativePrefsBroadcastMessage) => void
>();

/**
 * Subscribe to in-process broadcast messages. Returns an unsubscribe
 * function. Native replacement for the web cross-tab `BroadcastChannel`
 * subscription — delivery is same-process only.
 */
export function subscribe(
  handler: (msg: NativePrefsBroadcastMessage) => void,
): () => void {
  settingsTopicListeners.add(handler);
  return () => {
    settingsTopicListeners.delete(handler);
  };
}

/**
 * Fire an in-process broadcast message to every current subscriber. A native
 * caller can publish {@link TOPICS.SETTINGS_CHANGED} to force the bridge to
 * refetch settings without going through the React Query layer.
 */
export function publishPrefsBroadcast(msg: NativePrefsBroadcastMessage): void {
  for (const listener of settingsTopicListeners) {
    try {
      listener(msg);
    } catch {
      // Subscriber threw — never let one consumer crash the bus.
    }
  }
}

/** Test-only helper: clears subscribers and resets formatter globals. */
export function __resetFormatterPrefsForTests(): void {
  settingsTopicListeners.clear();
  _globalPrecision = 2;
  _globalLocale = 'en-US';
}

export function FormatterPrefsBridge(): null {
  const qc = useQueryClient();
  const {data: settings} = useSettingsQuery();

  // Apply globals from the resolved query data. Using `useEffect` here (rather
  // than during render) so React's commit phase batches the global updates and
  // StrictMode's double-render doesn't fire two setGlobalLocale calls per
  // change.
  const lastLocale = useRef<string | null>(null);
  const lastDecimals = useRef<number | null>(null);
  useEffect(() => {
    if (!settings) {
      return;
    }
    const locale = resolveLocale(settings.locale);
    const decimals = settings.decimal_precision ?? 2;
    if (locale !== lastLocale.current && locale !== getGlobalLocale()) {
      setGlobalLocale(locale);
      lastLocale.current = locale;
    } else if (lastLocale.current === null) {
      // First successful resolve — record what we observed so a later
      // identical-value refetch doesn't trigger an unnecessary write.
      lastLocale.current = locale;
    }
    if (decimals !== lastDecimals.current && decimals !== getGlobalPrecision()) {
      setGlobalPrecision(decimals);
      lastDecimals.current = decimals;
    } else if (lastDecimals.current === null) {
      lastDecimals.current = decimals;
    }
  }, [settings]);

  // Defense in depth: if a peer publishes a `settings.changed` topic without
  // going through the React Query layer (e.g. an admin reset, a future
  // devtool, an external action), force a refetch so the effect above re-runs
  // against fresh data.
  useEffect(() => {
    return subscribe(msg => {
      if (msg.type !== TOPICS.SETTINGS_CHANGED) {
        return;
      }
      void qc.invalidateQueries({queryKey: ['settings']});
    });
  }, [qc]);

  return null;
}
