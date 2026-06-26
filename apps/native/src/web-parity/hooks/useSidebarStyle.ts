// Native parity port of web/src/hooks/useSidebarStyle.ts.
//
// useSidebarStyle exposes the operator's preferred sidebar visual layout as a
// React-subscribable value plus imperative get/set helpers, all built on
// React's useSyncExternalStore. The web hook persists the choice in
// window.localStorage and keeps it in sync across browser tabs via the DOM
// `storage` event. React Native provides neither localStorage nor sibling-tab
// storage events, and no web-storage / AsyncStorage dependency is installed in
// apps/native, so this port:
//   - keeps the useSyncExternalStore contract + every exported/internal name
//     verbatim (SidebarStyle, SIDEBAR_STYLES, STORAGE_KEY, DEFAULT_STYLE,
//     isSidebarStyle, readStyle, getSnapshot, getServerSnapshot,
//     refreshSnapshot, subscribe, useSidebarStyle, setSidebarStyle,
//     getSidebarStyle);
//   - replaces the browser `localStorage` getItem/setItem string contract with
//     a native-safe in-process Map (nativeStyleStore) that mirrors it exactly —
//     the established ThemeProvider / useChartLegendState precedent. Within a
//     session reads/writes behave like the web localStorage path; the value
//     does NOT survive an app restart (durable persistence is browser-only).
//   - drops the `window.addEventListener('storage', ...)` cross-tab listener in
//     `subscribe` (React Native has no sibling tabs / storage events). Same-
//     process cross-mount re-renders still work via the module `listeners` set
//     that `setSidebarStyle` notifies, so every mounted `useSidebarStyle()`
//     still updates instantly when the style changes in this process.
//
// No DOM, window/localStorage, Recharts, Leaflet, or web-UI imports reach the
// native output — only react's useSyncExternalStore.

import {useSyncExternalStore} from 'react';

/**
 * useSidebarStyle — user preference for the sidebar visual layout.
 *
 * Three options:
 *   - 'linear' (default) — quiet single-column tree with 2px accent bar
 *   - 'notion'           — tighter rows with caret-on-row section toggles
 *   - 'legacy'           — original multi-color icon-tile sidebar
 *
 * On the web this preference lives in localStorage (not the backend
 * `AppSettings` blob) so toggling is instant with no network round-trip, the
 * preference survives offline, and cross-tab sync is automatic via the browser
 * `storage` event. React Native has no localStorage and no sibling tabs, so
 * this native port keeps the choice in an in-process store with the identical
 * get/set/subscribe contract; the value is per-app-session (durable
 * persistence + cross-tab sync are browser-only) — see the file header for the
 * full native adaptation. As on the web, this is a per-device-form-factor UI
 * decision that intentionally stays client-side rather than waiting on a
 * network round-trip.
 *
 * Default is intentionally 'linear' (UX review 2026-05-26): the quietest
 * design that still surfaces the full nav tree on first paint.
 */

export type SidebarStyle = 'legacy' | 'linear' | 'notion';

export const SIDEBAR_STYLES: readonly SidebarStyle[] = [
  'linear',
  'notion',
  'legacy',
];

const STORAGE_KEY = 'teslasync:sidebar-style:v1';
const DEFAULT_STYLE: SidebarStyle = 'linear';

// --- Native-safe replacement for the web `localStorage` persistence layer.
// No web storage / AsyncStorage dependency is installed, so the sidebar-style
// key lives in an in-process Map that mirrors the getItem/setItem string
// contract. The value does NOT survive an app restart (durable persistence is
// browser-only on native); within a session reads/writes behave exactly like
// the web localStorage path.
const nativeStyleStore = new Map<string, string>();

function readStored(key: string): string | null {
  return nativeStyleStore.get(key) ?? null;
}

function writeStored(key: string, value: string): void {
  nativeStyleStore.set(key, value);
}

function isSidebarStyle(value: unknown): value is SidebarStyle {
  return value === 'legacy' || value === 'linear' || value === 'notion';
}

function readStyle(): SidebarStyle {
  try {
    const raw = readStored(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_STYLE;
    }
    return isSidebarStyle(raw) ? raw : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

// Stable cache so useSyncExternalStore returns referentially-equal snapshots
// when nothing has changed — otherwise React raises an infinite-render warning
// (same pattern as the web hook / useAchievementCelebrationPrefs).
let cachedStyle: SidebarStyle = readStyle();

function getSnapshot(): SidebarStyle {
  return cachedStyle;
}

function getServerSnapshot(): SidebarStyle {
  return DEFAULT_STYLE;
}

function refreshSnapshot(): void {
  const next = readStyle();
  if (next !== cachedStyle) {
    cachedStyle = next;
  }
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  // Web parity note: the web hook also attaches a `window` 'storage' listener
  // here to react to writes from OTHER browser tabs. React Native has no
  // sibling tabs / storage events, so only the in-process `listeners` set is
  // kept — `setSidebarStyle` notifies it, so every mounted `useSidebarStyle()`
  // in this process still re-renders instantly when the style changes.
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/**
 * React hook — returns the currently selected sidebar style. Re-renders
 * automatically when the style changes anywhere in this app process.
 */
export function useSidebarStyle(): SidebarStyle {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Imperatively set the sidebar style. Triggers a re-render in every mounted
 * `useSidebarStyle()` in the current app process.
 */
export function setSidebarStyle(next: SidebarStyle): void {
  if (!isSidebarStyle(next) || next === cachedStyle) {
    return;
  }
  try {
    writeStored(STORAGE_KEY, next);
  } catch {
    // The native in-memory store cannot throw, but the guard mirrors the web
    // localStorage path (private mode / quota): fall through to the in-memory
    // refresh below so the current process still reflects the change.
  }
  refreshSnapshot();
  for (const cb of listeners) {
    cb();
  }
}

/** Synchronous read for non-React call sites (e.g. tests). */
export function getSidebarStyle(): SidebarStyle {
  return cachedStyle;
}
