/**
 * @module hooks/useOnlineStatus
 *
 * Native parity port of web/src/hooks/useOnlineStatus.ts.
 *
 * useOnlineStatus — subscribe to the host online/offline state.
 *
 * Returns `true` when the runtime reports a network connection, `false`
 * otherwise. On the web the source hook is backed by `navigator.onLine` and the
 * shared `lib/resilience` status broadcaster (which wires the `online` /
 * `offline` window events) so every consumer agrees on the same state without
 * duplicating listeners.
 *
 * Use this hook in connectivity-aware UI (offline banners, query-error
 * fallbacks, "retry when online" buttons) to render contextual messaging when
 * the user disconnects — e.g. driving through a tunnel on the installed mobile
 * app.
 *
 * Why not just read connectivity once?
 *   - A one-shot read won't re-render React on change without an event
 *     subscription, so the hook subscribes for the lifetime of the consumer.
 *   - Routing every consumer through the same `online` / `offline` events keeps
 *     the offline banner, fetch retry logic, and query error states on one
 *     source of truth.
 *
 * Web -> native adaptation (conversion contract rule 7): the web hook's source
 * of truth is `lib/resilience`, which is built entirely on the browser-only
 * `navigator.onLine` read plus the `window` `online` / `offline` events. None of
 * those globals exist in the bare React Native runtime, and the project ships no
 * `@react-native-community/netinfo` dependency, so there is no OS-level
 * connectivity stream to bind to. Following the same probe-then-degrade pattern
 * as the `useSSE` parity port, this hook feature-detects the host
 * `navigator.onLine` value and the `online` / `offline` `addEventListener`
 * surface (both present under react-native-web and in browsers, absent on bare
 * iOS/Android/Windows/macOS). When they are unavailable the hook stays in an
 * explicit, documented "optimistic online" state — it returns `true` and
 * attaches no listeners — so connectivity-gated UI (offline banners) never shows
 * a false negative on a platform that cannot observe connectivity, and request
 * failures continue to surface through the api/client error path instead.
 *
 * This deliberately does NOT route through the native `api/client`
 * `getConnectionStatus()`: that value is derived from fetch outcomes, starts at
 * `'unknown'` (which would seed a spurious offline state), and exposes no change
 * broadcaster, so it cannot drive the event-subscribed re-render contract the
 * web hook guarantees.
 */

import {useEffect, useState} from 'react';

type ConnectionStatus = 'online' | 'offline';

/**
 * Minimal structural view of the host `online` / `offline` event surface. Typed
 * locally because the React Native tsconfig omits the DOM lib, so neither
 * `window` nor `globalThis.addEventListener` is part of the ambient types.
 */
interface OnlineEventTarget {
  addEventListener(type: ConnectionStatus, listener: () => void): void;
  removeEventListener(type: ConnectionStatus, listener: () => void): void;
}

/**
 * Probes `globalThis` for the browser-style `online` / `offline` event surface.
 * Present under react-native-web and real browsers, absent on the bare native
 * runtime — in which case the subscription stays in the unavailable state.
 */
function getOnlineEventTarget(): OnlineEventTarget | null {
  const candidate = globalThis as typeof globalThis & {
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  return typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
    ? (candidate as unknown as OnlineEventTarget)
    : null;
}

/**
 * Reads the host `navigator.onLine` flag, mirroring the seed the web
 * `lib/resilience` broadcaster captures at module load. Defaults to `'online'`
 * when `navigator.onLine` is unavailable (the bare React Native default) so
 * offline-only UI never false-positives where connectivity cannot be observed.
 */
function readConnectionStatus(): ConnectionStatus {
  const nav = (
    globalThis as typeof globalThis & {navigator?: {onLine?: unknown}}
  ).navigator;
  if (nav != null && typeof nav.onLine === 'boolean') {
    return nav.onLine ? 'online' : 'offline';
  }
  return 'online';
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    () => readConnectionStatus() === 'online',
  );

  useEffect(() => {
    const target = getOnlineEventTarget();
    if (target == null) {
      return;
    }

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    target.addEventListener('online', handleOnline);
    target.addEventListener('offline', handleOffline);

    return () => {
      target.removeEventListener('online', handleOnline);
      target.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}
