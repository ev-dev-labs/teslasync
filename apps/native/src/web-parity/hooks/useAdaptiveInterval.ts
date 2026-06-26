import {useEffect, useState} from 'react';

import {apiUrl} from '../api/client';

/**
 * Returns adaptive polling interval based on SSE connection state.
 * - SSE connected: slow poll (fallback only) — 30s
 * - SSE reconnecting: fast poll (primary data source) — 3s
 *
 * Usage: `refetchInterval: useAdaptiveInterval()`
 *
 * The web hook (web/src/hooks/useAdaptiveInterval.ts) reads connection state
 * from the browser-only shared sseManager (web/src/lib/sseManager.ts). React
 * Native ships no browser EventSource, so this parity port mirrors only the
 * connection-state slice the hook consumes — `getState()` plus the
 * `connected`/`disconnected` transitions — on top of a host-provided
 * EventSource polyfill. When no polyfill is registered the connection never
 * reaches `connected`, the state stays `reconnecting`, and the hook returns the
 * fast (primary data-source) interval, matching the web fallback semantics.
 */

const EVENTS_PATH = '/events';
const CONNECTED_EVENT = 'connected';
const ERROR_EVENT = 'error';

export const ADAPTIVE_INTERVAL_SSE_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; without a compatible polyfill the SSE connection never reaches the "connected" state, so useAdaptiveInterval stays on its fast polling cadence.';

type SSEConnectionState = 'connected' | 'reconnecting';
type SSEConnectionEvent = 'connected' | 'disconnected';
type ConnectionListener = () => void;

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

const connectedListeners = new Set<ConnectionListener>();
const disconnectedListeners = new Set<ConnectionListener>();
let source: NativeEventSource | null = null;
let connectionState: SSEConnectionState = 'reconnecting';

function listenersFor(event: SSEConnectionEvent): Set<ConnectionListener> {
  return event === 'connected' ? connectedListeners : disconnectedListeners;
}

function emit(event: SSEConnectionEvent): void {
  for (const listener of Array.from(listenersFor(event))) {
    listener();
  }
}

function totalListenerCount(): number {
  return connectedListeners.size + disconnectedListeners.size;
}

function handleConnected(): void {
  connectionState = 'connected';
  emit('connected');
}

function handleError(): void {
  // Mirrors sseManager's `es.onerror` -> synthetic `disconnected` transition.
  connectionState = 'reconnecting';
  emit('disconnected');
}

function openSource(): void {
  if (source != null) {
    return;
  }

  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    return;
  }

  source = new EventSourceCtor(apiUrl(EVENTS_PATH));
  source.addEventListener(CONNECTED_EVENT, handleConnected);
  source.addEventListener(ERROR_EVENT, handleError);
}

function closeSource(): void {
  if (source == null) {
    return;
  }

  source.removeEventListener?.(CONNECTED_EVENT, handleConnected);
  source.removeEventListener?.(ERROR_EVENT, handleError);
  source.close();
  source = null;
  connectionState = 'reconnecting';
}

function getConnectionState(): SSEConnectionState {
  return connectionState;
}

function subscribeConnection(
  event: SSEConnectionEvent,
  listener: ConnectionListener,
): void {
  listenersFor(event).add(listener);
  // Auto-connect on first subscriber (parity with sseManager.subscribe).
  openSource();
}

function unsubscribeConnection(
  event: SSEConnectionEvent,
  listener: ConnectionListener,
): void {
  listenersFor(event).delete(listener);
  // Auto-disconnect when no subscribers remain (parity with sseManager).
  if (totalListenerCount() === 0) {
    closeSource();
  }
}

export function useAdaptiveInterval(fastMs = 3000, slowMs = 30_000): number {
  const [interval, setInterval_] = useState(() =>
    getConnectionState() === 'connected' ? slowMs : fastMs,
  );

  useEffect(() => {
    const onConnected = () => setInterval_(slowMs);
    const onDisconnected = () => setInterval_(fastMs);

    subscribeConnection('connected', onConnected);
    subscribeConnection('disconnected', onDisconnected);

    // Sync on mount
    setInterval_(getConnectionState() === 'connected' ? slowMs : fastMs);

    return () => {
      unsubscribeConnection('connected', onConnected);
      unsubscribeConnection('disconnected', onDisconnected);
    };
  }, [fastMs, slowMs]);

  return interval;
}
