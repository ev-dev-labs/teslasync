// Native parity port of web/src/hooks/useLiveConnection.ts.
//
// The web hook (web/src/hooks/useLiveConnection.ts) derives the overall
// live-data pipeline health from the browser-only singleton sseManager
// (web/src/lib/sseManager.ts), which depends on the DOM EventSource. React
// Native ships no browser EventSource, so this parity port inlines the exact
// slice of sseManager that useLiveConnection consumes — getState(),
// getLastMessageAt(), hasEverConnected(), plus subscribe/unsubscribe for the
// 'connected', 'disconnected', and 'heartbeat' lifecycle events — on top of a
// host-provided global EventSource polyfill.
//
// Per-import native adaptation:
//   - react useEffect/useState/useRef (web L1) -> same react primitives.
//   - @/lib/sseManager sseManager (web L2) -> an inlined native-safe live-pipe
//     tracker driven by a host EventSource polyfill on /api/v1/events via
//     apiUrl('/events'). It mirrors sseManager's auto-connect-on-first-
//     subscriber / auto-disconnect-on-last-unsubscriber lifecycle, its capped
//     exponential reconnect backoff (1s -> 60s), the 'connected'/'heartbeat'
//     re-emission, the es.onerror -> synthetic 'disconnected' transition, the
//     lastMessageAt freshness bump on every real server message (and NOT on a
//     synthetic disconnect), and the everConnected latch.
//   - window.setTimeout / window.clearTimeout (web L97/L100) -> the React
//     Native global setTimeout / clearTimeout.
//
// Native-safe unavailable state (contract rule 7): when no EventSource
// constructor is registered on globalThis the source never opens, state stays
// 'reconnecting', everConnected stays false, and lastMessageAt stays null — so
// useLiveConnection reports { status: 'unknown', lastMessageAt: null,
// channels: { sse: 'closed' } }, matching the web "brand-new load, never
// connected" branch. The explicit reason is exported as
// LIVE_CONNECTION_SSE_UNAVAILABLE_REASON and the channel readiness as
// getLiveConnectionRealtimeStatus().
//
// No DOM, EventSource-via-window, Recharts, Leaflet, or web-UI imports are
// introduced — only react and the native api/client apiUrl helper.

import {useEffect, useRef, useState} from 'react';

import {apiUrl} from '../api/client';

/** Overall live-data pipeline health, derived from SSE state + freshness. */
export type LiveConnectionStatus =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unknown';

export interface LiveConnectionState {
  /** Overall live-data health. */
  status: LiveConnectionStatus;
  /** ISO timestamp of the last live message of any kind. */
  lastMessageAt: string | null;
  /** Per-channel breakdown (advanced consumers). MQTT is intentionally
   *  not surfaced to end users — it is backend-internal. */
  channels: {
    sse: 'open' | 'closed' | 'error';
  };
}

/**
 * After the SSE pipe enters the "reconnecting" state, give it this long to
 * recover before we promote the UI to "disconnected" (red). Below this
 * threshold we render amber "Reconnecting…".
 *
 * 10s matches the backend heartbeat-driven UX expectation in the prompt:
 * "Within ~10s indicator turns amber 'Reconnecting…', then red 'Offline'".
 */
const RECONNECTING_GRACE_MS = 10_000;

// ---- Native-safe live-pipe tracker (web @/lib/sseManager consumed slice) -----

const EVENTS_PATH = '/events';

export type LiveConnectionRealtimeStatus = 'subscribed' | 'unavailable';

export const LIVE_CONNECTION_SSE_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; without a compatible polyfill the live SSE pipe never reaches the "connected" state, so useLiveConnection reports status "unknown" (sse channel "closed") until a host EventSource polyfill is registered on globalThis.';

type SSEManagerState = 'connected' | 'reconnecting';
/** The lifecycle events useLiveConnection subscribes to (sseManager's slice). */
type SSEManagerEvent = 'connected' | 'disconnected' | 'heartbeat';
type SSEManagerListener = (data: unknown) => void;

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

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (globalThis as typeof globalThis & {EventSource?: unknown})
    .EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

// Real server-message events that bump `lastMessageAt` for freshness but which
// useLiveConnection does not itself subscribe to (web sseManager L90-111).
// 'connected' and 'heartbeat' also mark freshness but have dedicated handlers.
const MARKER_EVENTS = [
  'vehicle_update',
  'alert',
  'export_status',
  'achievement_unlocked',
] as const;

const listeners = new Map<SSEManagerEvent, Set<SSEManagerListener>>();
let source: NativeEventSource | null = null;
let state: SSEManagerState = 'reconnecting';
let failCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let connecting = false;
let lastMessageAt: number | null = null;
let everConnected = false;

// Capped exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;

function emit(event: SSEManagerEvent, data?: unknown): void {
  const subs = listeners.get(event);
  if (subs) {
    for (const fn of Array.from(subs)) {
      try {
        fn(data);
      } catch (e) {
        console.error('SSE listener error:', e);
      }
    }
  }
}

/** Mark that a real server message just arrived (used for freshness). */
function markServerMessage(): void {
  lastMessageAt = Date.now();
}

// The shared sseManager parses each SSE frame's JSON before dispatching;
// reproduce that here (string -> parsed object) while tolerating a polyfill
// that already delivers parsed data. Malformed/empty frames yield null,
// matching the web heartbeat handler's `try { JSON.parse } catch { null }`.
function parseEventData(raw: unknown): unknown {
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

function handleConnected(event: NativeEventSourceEvent): void {
  state = 'connected';
  failCount = 0;
  connecting = false;
  everConnected = true;
  markServerMessage();
  emit('connected', parseEventData(event.data));
}

function handleHeartbeat(event: NativeEventSourceEvent): void {
  markServerMessage();
  emit('heartbeat', parseEventData(event.data));
}

function handleMarker(): void {
  markServerMessage();
}

function detachSource(): void {
  if (source == null) {
    return;
  }
  source.removeEventListener?.('connected', handleConnected);
  source.removeEventListener?.('heartbeat', handleHeartbeat);
  for (const evt of MARKER_EVENTS) {
    source.removeEventListener?.(evt, handleMarker);
  }
  source.removeEventListener?.('error', handleError);
  source.close();
  source = null;
}

function handleError(): void {
  detachSource();
  connecting = false;
  failCount += 1;

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
}

function doConnect(): void {
  if (connecting) {
    return;
  }
  connecting = true;

  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    // No host EventSource polyfill: cannot open the live pipe. Leave state at
    // 'reconnecting' and everConnected false so useLiveConnection reports
    // 'unknown' (LIVE_CONNECTION_SSE_UNAVAILABLE_REASON).
    connecting = false;
    return;
  }

  if (source != null) {
    detachSource();
  }

  const es = new EventSourceCtor(apiUrl(EVENTS_PATH));
  source = es;

  es.addEventListener('connected', handleConnected);
  es.addEventListener('heartbeat', handleHeartbeat);
  for (const evt of MARKER_EVENTS) {
    es.addEventListener(evt, handleMarker);
  }
  es.addEventListener('error', handleError);
}

function subscribe(event: SSEManagerEvent, listener: SSEManagerListener): void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(listener);
  // Auto-connect on first subscriber (parity with sseManager.subscribe).
  if (source == null && !connecting) {
    doConnect();
  }
}

function unsubscribe(
  event: SSEManagerEvent,
  listener: SSEManagerListener,
): void {
  listeners.get(event)?.delete(listener);
  // Auto-disconnect when no subscribers remain (parity with sseManager).
  let totalSubs = 0;
  for (const set of listeners.values()) {
    totalSubs += set.size;
  }
  if (totalSubs === 0) {
    detachSource();
    // Reset connection bookkeeping so a future subscribe re-opens cleanly.
    state = 'reconnecting';
    connecting = false;
    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }
}

function getState(): SSEManagerState {
  return state;
}

/** Timestamp (ms epoch) of the last real server message, or null. */
function getLastMessageAt(): number | null {
  return lastMessageAt;
}

/** True once a `connected` event has been received at least once this session. */
function hasEverConnected(): boolean {
  return everConnected;
}

/** Whether the live SSE channel is currently consumable on React Native. */
export function getLiveConnectionRealtimeStatus(): LiveConnectionRealtimeStatus {
  return getEventSourceConstructor() == null ? 'unavailable' : 'subscribed';
}

/**
 * Single source of truth for the live-data pipeline health used by
 * `<LiveIndicator>` and `<LiveStaleDataBanner>`.
 *
 * Internally this hook subscribes to the inlined native live-pipe tracker for
 * three lifecycle events: `connected`, `disconnected`, and `heartbeat`. That
 * has two effects:
 *   1. It keeps the singleton SSE connection alive while any LiveIndicator
 *      is mounted (the tracker auto-disconnects when its last subscriber
 *      leaves).
 *   2. It re-renders consumers whenever the wire state changes, so the
 *      indicator label/color updates without polling.
 *
 * Time-based transitions (reconnecting → disconnected after 10s) are driven
 * by an internal `setTimeout` rather than waiting for another SSE event,
 * because once the pipe is down there are no further events to wake us.
 *
 * React Native has no browser EventSource; without a host polyfill the pipe
 * stays "unknown" (LIVE_CONNECTION_SSE_UNAVAILABLE_REASON).
 */
export function useLiveConnection(): LiveConnectionState {
  // The hook tracks two pieces of state derived from the tracker:
  //   - sseState: 'connected' | 'reconnecting' (raw tracker state)
  //   - sinceMs:  wall-clock time the current sseState was entered
  // Plus a tick counter to force a re-render when the grace timer expires.
  const [sseState, setSseState] = useState<'connected' | 'reconnecting'>(() =>
    getState(),
  );
  const [, setTick] = useState(0);
  const stateEnteredAtRef = useRef<number>(Date.now());
  const lastMessageAtMsRef = useRef<number | null>(getLastMessageAt());

  useEffect(() => {
    const onConnected = () => {
      stateEnteredAtRef.current = Date.now();
      lastMessageAtMsRef.current = getLastMessageAt();
      setSseState('connected');
    };
    const onDisconnected = () => {
      stateEnteredAtRef.current = Date.now();
      setSseState('reconnecting');
    };
    const onHeartbeat = () => {
      lastMessageAtMsRef.current = getLastMessageAt();
      // Force a re-render so "last message Xs ago" stays fresh.
      setTick(t => (t + 1) & 0xfffff);
    };

    subscribe('connected', onConnected);
    subscribe('disconnected', onDisconnected);
    subscribe('heartbeat', onHeartbeat);

    return () => {
      unsubscribe('connected', onConnected);
      unsubscribe('disconnected', onDisconnected);
      unsubscribe('heartbeat', onHeartbeat);
    };
  }, []);

  // While reconnecting, schedule a re-render at the grace boundary so the
  // status promotes from "reconnecting" to "disconnected" without needing
  // any further server traffic.
  useEffect(() => {
    if (sseState !== 'reconnecting') {
      return;
    }
    const elapsed = Date.now() - stateEnteredAtRef.current;
    const remaining = RECONNECTING_GRACE_MS - elapsed;
    if (remaining <= 0) {
      return;
    }
    const timer = setTimeout(() => {
      setTick(t => (t + 1) & 0xfffff);
    }, remaining + 50);
    return () => clearTimeout(timer);
  }, [sseState]);

  // Compute derived status and channel state.
  const elapsedMs = Date.now() - stateEnteredAtRef.current;
  let status: LiveConnectionStatus;
  let sseChannel: 'open' | 'closed' | 'error';
  if (sseState === 'connected') {
    status = 'connected';
    sseChannel = 'open';
  } else if (!hasEverConnected()) {
    // Brand-new app load and we have not yet seen a successful connection.
    status = 'unknown';
    sseChannel = 'closed';
  } else if (elapsedMs < RECONNECTING_GRACE_MS) {
    status = 'reconnecting';
    sseChannel = 'closed';
  } else {
    status = 'disconnected';
    sseChannel = 'error';
  }

  const lastMs = lastMessageAtMsRef.current;
  return {
    status,
    lastMessageAt: lastMs ? new Date(lastMs).toISOString() : null,
    channels: {sse: sseChannel},
  };
}

/**
 * Test-only helper: tears down the shared SSE source, clears all subscribers,
 * cancels any pending reconnect, and resets the live-pipe bookkeeping so each
 * test run starts from a clean module-singleton state.
 */
export function __resetLiveConnectionForTests(): void {
  detachSource();
  listeners.clear();
  state = 'reconnecting';
  failCount = 0;
  connecting = false;
  lastMessageAt = null;
  everConnected = false;
  if (reconnectTimer !== undefined) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}
