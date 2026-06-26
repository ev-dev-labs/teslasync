/**
 * Native parity port of web/src/lib/sseManager.ts.
 *
 * Singleton SSE connection manager. Maintains ONE EventSource connection shared
 * across all React hooks (useRealtimeEvents, useVehicleLive, useLiveConnection).
 * Hooks subscribe/unsubscribe via the subscribe/unsubscribe pattern.
 *
 * In addition to dispatching named events, the manager tracks two pieces of
 * cross-app live-pipe metadata that `useLiveConnection` consumes to render a
 * live indicator:
 *   - `lastMessageAt`: the wall-clock time we last received any message
 *     FROM THE SERVER (heartbeat or otherwise). Used to render a "last
 *     update Xs ago" timestamp. Synthetic `disconnected` events do NOT
 *     update this — only real server traffic does.
 *   - `hasEverConnected`: app-wide flag that flips true the first time we
 *     successfully receive a `connected` event. Used so a screen that mounts
 *     during an outage shows "disconnected" rather than "unknown" if the
 *     app has been live earlier in the session.
 *
 * Web -> native adaptation (conversion contract rule 7): the browser global
 * `EventSource` has no React Native equivalent. This module probes
 * `globalThis.EventSource` for a host-provided polyfill at connect time. When
 * none is present (the React Native default) `doConnect` is a no-op that leaves
 * the manager in the explicit `reconnecting` (live wiring unavailable) state —
 * the same value the web manager reports before any successful connection — so
 * consumers degrade gracefully instead of crashing, and no reconnect storm is
 * scheduled. The relative `/api/v1/events` endpoint is resolved through the
 * native `apiUrl` helper so an installed polyfill receives an absolute URL, and
 * the browser `window.setTimeout` becomes the React Native global `setTimeout`.
 */

import {apiUrl} from '../api/client';

type SSEListener = (data: unknown) => void;
type SSEEventType =
  | 'vehicle_update'
  | 'alert'
  | 'export_status'
  | 'achievement_unlocked'
  | 'connected'
  | 'disconnected'
  | 'heartbeat';

interface SSEManager {
  subscribe: (event: SSEEventType, listener: SSEListener) => void;
  unsubscribe: (event: SSEEventType, listener: SSEListener) => void;
  getState: () => 'connected' | 'reconnecting';
  /** Timestamp (ms epoch) of the last real server message, or null. */
  getLastMessageAt: () => number | null;
  /** True once a `connected` event has been received at least once this session. */
  hasEverConnected: () => boolean;
  connect: () => void;
  disconnect: () => void;
}

// Relative web endpoint `/api/v1/events`; apiUrl prefixes the native API base.
const EVENTS_PATH = '/events';

type NativeEventSourceEvent = {readonly data?: unknown};
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

const listeners = new Map<SSEEventType, Set<SSEListener>>();
let source: NativeEventSource | null = null;
let state: 'connected' | 'reconnecting' = 'reconnecting';
let failCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let connecting = false;
let lastMessageAt: number | null = null;
let everConnected = false;

// Capped exponential backoff: 1s -> 2s -> 4s -> 8s -> 16s -> 32s -> 60s (max)
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (globalThis as typeof globalThis & {EventSource?: unknown})
    .EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

function eventData(event: NativeEventSourceEvent): string {
  if (typeof event.data === 'string') {
    return event.data;
  }
  return event.data == null ? '' : String(event.data);
}

function emit(event: SSEEventType, data?: unknown) {
  const subs = listeners.get(event);
  if (subs) {
    for (const fn of subs) {
      try {
        fn(data);
      } catch (e) {
        console.error('SSE listener error:', e);
      }
    }
  }
}

/** Mark that a real server message just arrived (used for freshness). */
function markServerMessage() {
  lastMessageAt = Date.now();
}

function doConnect() {
  if (connecting) {
    return;
  }
  connecting = true;

  if (source) {
    source.close();
    source = null;
  }

  // React Native ships no EventSource; probe for a host-provided polyfill.
  // Without one we cannot open a stream, so leave the manager in the explicit
  // `reconnecting` (live wiring unavailable) state and do not schedule a retry
  // storm — this mirrors the web manager's pre-connection state.
  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    connecting = false;
    state = 'reconnecting';
    return;
  }

  const es = new EventSourceCtor(apiUrl(EVENTS_PATH));
  source = es;

  es.addEventListener('connected', e => {
    state = 'connected';
    failCount = 0;
    connecting = false;
    everConnected = true;
    markServerMessage();
    const data = JSON.parse(eventData(e));
    emit('connected', data);
  });

  es.addEventListener('vehicle_update', e => {
    markServerMessage();
    emit('vehicle_update', JSON.parse(eventData(e)));
  });

  es.addEventListener('alert', e => {
    markServerMessage();
    emit('alert', JSON.parse(eventData(e)));
  });

  es.addEventListener('export_status', e => {
    markServerMessage();
    emit('export_status', JSON.parse(eventData(e)));
  });

  // Real-time achievement unlocks. The lifetime handler broadcasts one event
  // per locked -> unlocked transition; consumers fire a celebration toast +
  // confetti animation in response.
  es.addEventListener('achievement_unlocked', e => {
    markServerMessage();
    emit('achievement_unlocked', JSON.parse(eventData(e)));
  });

  es.addEventListener('heartbeat', e => {
    markServerMessage();
    const raw = eventData(e);
    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    emit('heartbeat', payload);
  });

  // The web manager assigned `es.onerror`; native EventSource polyfills expose
  // the same disconnect signal through the standard `error` event. Behavior is
  // identical: close, count the failure, broadcast `disconnected`, and schedule
  // a capped exponential-backoff reconnect.
  es.addEventListener('error', () => {
    es.close();
    source = null;
    connecting = false;
    failCount++;

    state = 'reconnecting';
    // Note: do NOT touch lastMessageAt here — this is a synthetic transition,
    // not a server message. UI consumers ("last update Xs ago") would lie if
    // we bumped it on disconnect.
    emit('disconnected');

    const backoff = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, failCount - 1),
      MAX_BACKOFF_MS,
    );
    reconnectTimer = setTimeout(() => {
      doConnect();
    }, backoff);
  });
}

export const sseManager: SSEManager = {
  subscribe(event, listener) {
    let subs = listeners.get(event);
    if (!subs) {
      subs = new Set();
      listeners.set(event, subs);
    }
    subs.add(listener);
    // Auto-connect on first subscriber
    if (!source && !connecting) {
      doConnect();
    }
  },

  unsubscribe(event, listener) {
    listeners.get(event)?.delete(listener);
    // Auto-disconnect when no subscribers remain
    const totalSubs = Array.from(listeners.values()).reduce(
      (sum, s) => sum + s.size,
      0,
    );
    if (totalSubs === 0) {
      if (source) {
        source.close();
        source = null;
      }
      // Reset connection bookkeeping so a future subscribe re-opens cleanly
      // (previously `connecting` could stay true if the last subscriber left
      // mid-connect, leaving the next subscriber unable to reconnect).
      state = 'reconnecting';
      connecting = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    }
  },

  getState() {
    return state;
  },

  getLastMessageAt() {
    return lastMessageAt;
  },

  hasEverConnected() {
    return everConnected;
  },

  connect() {
    if (!source && !connecting) {
      doConnect();
    }
  },

  disconnect() {
    if (source) {
      source.close();
      source = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
    state = 'reconnecting';
    connecting = false;
  },
};
