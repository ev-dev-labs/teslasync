/**
 * useAlertContext — read drill-through "alert context" params on native.
 *
 * Web parity source: web/src/hooks/useAlertContext.ts.
 *
 * On the web, clicking an alert (toast, alerts page, dashboard widget, browser
 * notification) navigates to a context page such as
 * `/battery?vehicle_id=12&t=2026-04-30T13:00:00Z&signal=BatteryLevel`, and this
 * hook reads those query params via react-router-dom's `useSearchParams` so the
 * page can:
 *   - preselect the relevant vehicle in its picker, and
 *   - center its chart time-window on the alert timestamp (±30 min).
 *
 * React Native has no browser URL / react-router location to read query params
 * from. This native-safe port keeps the exact public `AlertContext` shape and
 * computation, but backs the params with a tiny in-process store instead of the
 * URL. The native navigation / notification layer pushes the drill-through
 * params in via `setAlertContextParams(...)` (the analog of navigating to
 * `…?vehicle_id=…&t=…&signal=…`) and clears them via `clearAlertContext()`.
 *
 * Until that layer populates the store the params are absent — exactly like a
 * web URL carrying no alert context — so every field is optional and the hook
 * returns nulls, prompting pages to render their default view.
 *
 * No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
 * components are imported here.
 */
import {useMemo, useSyncExternalStore} from 'react';

export interface AlertContext {
  /** Vehicle ID from `?vehicle_id=N`, or `null` when absent. */
  vehicleId: number | null;
  /** Raw ISO timestamp from `?t=...`, or `null`. */
  timestamp: string | null;
  /** Signal name from `?signal=...`, or `null`. */
  signal: string | null;
  /** [t-30min, t+30min] chart window. `null` when no timestamp present. */
  timeWindow: {from: string; to: string} | null;
  /** True when at least one drill-through param is present. Convenient for
   *  conditionally rendering "viewing alert context" affordances. */
  hasContext: boolean;
}

const ALERT_WINDOW_MS = 30 * 60_000;

/* ------------------------------------------------------------------ */
/*  native-safe alert-context param store (web react-router URL)      */
/* ------------------------------------------------------------------ */

/** The recognized drill-through query keys the web URL carries. */
const ALERT_CONTEXT_KEYS = ['vehicle_id', 't', 'signal'] as const;
type AlertContextKey = (typeof ALERT_CONTEXT_KEYS)[number];

type AlertContextParamUpdates = Partial<
  Record<AlertContextKey, string | number | null | undefined>
>;

const alertContextStore = new Map<string, string>();
const alertContextListeners = new Set<() => void>();
let alertContextSnapshot = '';

function recomputeAlertContextSnapshot(): void {
  const pairs: string[] = [];
  for (const [key, value] of alertContextStore) {
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  alertContextSnapshot = pairs.join('&');
}

function getAlertContextSnapshot(): string {
  return alertContextSnapshot;
}

function subscribeAlertContext(listener: () => void): () => void {
  alertContextListeners.add(listener);
  return () => {
    alertContextListeners.delete(listener);
  };
}

function notifyAlertContext(): void {
  recomputeAlertContextSnapshot();
  alertContextListeners.forEach(listener => listener());
}

/**
 * Native bridge replacing react-router navigation: push the drill-through
 * params an alert would otherwise carry in the URL query string. A `null` or
 * empty value deletes a key (the param being absent). Only the recognized
 * drill-through keys are honored so the store mirrors the web URL contract.
 */
export function setAlertContextParams(updates: AlertContextParamUpdates): void {
  let changed = false;
  for (const key of ALERT_CONTEXT_KEYS) {
    if (!(key in updates)) {
      continue;
    }
    const value = updates[key];
    if (value == null || value === '') {
      if (alertContextStore.delete(key)) {
        changed = true;
      }
    } else {
      const next = String(value);
      if (alertContextStore.get(key) !== next) {
        alertContextStore.set(key, next);
        changed = true;
      }
    }
  }
  if (changed) {
    notifyAlertContext();
  }
}

/** Native bridge: clear all drill-through params (navigate away from context). */
export function clearAlertContext(): void {
  if (alertContextStore.size === 0) {
    return;
  }
  alertContextStore.clear();
  notifyAlertContext();
}

/**
 * Parse the snapshot query string back into a `URLSearchParams`-like reader.
 * `.get()` returns `null` for an absent key, exactly like react-router's
 * `useSearchParams()` params object the web hook reads from.
 */
function parseAlertContextSnapshot(snapshot: string): (key: string) => string | null {
  const map = new Map<string, string>();
  if (snapshot.length > 0) {
    for (const pair of snapshot.split('&')) {
      const [rawKey, rawValue = ''] = pair.split('=');
      if (rawKey) {
        map.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue));
      }
    }
  }
  return key => {
    const value = map.get(key);
    return value === undefined ? null : value;
  };
}

export function useAlertContext(): AlertContext {
  const snapshot = useSyncExternalStore(
    subscribeAlertContext,
    getAlertContextSnapshot,
    getAlertContextSnapshot,
  );

  return useMemo<AlertContext>(() => {
    const params = parseAlertContextSnapshot(snapshot);
    const vehicleIdRaw = params('vehicle_id');
    const t = params('t');
    const signal = params('signal');

    const vehicleId =
      vehicleIdRaw != null && vehicleIdRaw !== '' ? Number(vehicleIdRaw) : null;
    const safeVehicleId =
      vehicleId != null && Number.isFinite(vehicleId) ? vehicleId : null;

    let timeWindow: AlertContext['timeWindow'] = null;
    if (t) {
      const parsed = new Date(t);
      if (!Number.isNaN(parsed.getTime())) {
        timeWindow = {
          from: new Date(parsed.getTime() - ALERT_WINDOW_MS).toISOString(),
          to: new Date(parsed.getTime() + ALERT_WINDOW_MS).toISOString(),
        };
      }
    }

    return {
      vehicleId: safeVehicleId,
      timestamp: t,
      signal,
      timeWindow,
      hasContext: safeVehicleId != null || t != null || signal != null,
    };
  }, [snapshot]);
}
