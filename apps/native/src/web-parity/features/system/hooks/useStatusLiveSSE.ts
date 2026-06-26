/**
 * Subscribes to GET /api/v1/status/live.
 *
 * The backend pushes a `status` SSE event every 30s carrying the full
 * status snapshot. This hook owns the connection lifecycle and surfaces
 * three bits of state to the UI:
 *
 *   • snapshot — the latest snapshot received (null until first event)
 *   • state    — connection state ('live' | 'reconnecting' | 'offline')
 *   • lastUpdateAt — timestamp the last snapshot landed
 *
 * Reconnect strategy: exponential backoff capped at 30s, restarted
 * when the app returns to the foreground.
 *
 * Why a dedicated hook (not the existing useSSE)? The existing hook is
 * tightly coupled to the typed `signal_change` event shape and routes
 * through the singleton `sseManager`. The status stream is a different
 * channel with its own envelope, and it's consumed only by /system-status.
 * Forking keeps both paths simple.
 *
 * Native parity: React Native does not ship a browser EventSource. This
 * port uses a host-provided global EventSource polyfill when present and
 * maps the unavailable case onto the existing explicit 'offline' state so
 * the surface ({ snapshot, state, lastUpdateAt, reconnect }) is unchanged.
 * Foreground restart is driven by React Native's AppState ('active')
 * instead of the browser `visibilitychange` event.
 */

import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, type AppStateStatus} from 'react-native';

import {apiUrl} from '../../../api/client';

export type StatusSeverity =
  | 'operational'
  | 'degraded'
  | 'down'
  | 'maintenance';

export interface StatusV1Snapshot {
  status: StatusSeverity;
  generated_at: string;
  version?: {build: string; go_version: string; started_at: string};
  components?: Array<{
    name: string;
    status: string;
    consecutive_failures: number;
    last_check_at?: string;
  }>;
  resources?: {goroutines: number; uptime_seconds: number; go_version: string};
  maintenance?: {
    mode: string;
    message?: string;
    until?: string;
    source: string;
    updated_at?: string;
  };
  incidents?: Array<{
    id: string;
    title: string;
    status: string;
    severity: string;
    started_at: string;
    updated_at: string;
    resolved_at?: string;
    affected_components?: string[];
  }>;
  counts?: {
    components_total: number;
    components_healthy: number;
    components_degraded: number;
    components_unhealthy: number;
  };
}

export type StatusLiveState = 'live' | 'reconnecting' | 'offline';

export interface UseStatusLiveSSEOptions {
  enabled?: boolean;
  endpoint?: string;
}

export interface UseStatusLiveSSEResult {
  snapshot: StatusV1Snapshot | null;
  state: StatusLiveState;
  lastUpdateAt: number | null;
  reconnect: () => void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// Mirrors the browser EventSource.CLOSED static (readyState === 2): the
// connection is fully closed and will not reconnect on its own, so we drive
// the backoff reconnect ourselves.
const EVENT_SOURCE_CLOSED = 2;

type NativeEventSourceEvent = {
  readonly data?: unknown;
};

type NativeEventSourceListener = (event: NativeEventSourceEvent) => void;

interface NativeEventSourceInit {
  withCredentials?: boolean;
}

interface NativeEventSource {
  readonly readyState?: number;
  addEventListener(event: string, listener: NativeEventSourceListener): void;
  removeEventListener?(
    event: string,
    listener: NativeEventSourceListener,
  ): void;
  close(): void;
}

type NativeEventSourceConstructor = new (
  url: string,
  init?: NativeEventSourceInit,
) => NativeEventSource;

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (globalThis as typeof globalThis & {EventSource?: unknown})
    .EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

function isAbsoluteUrl(endpoint: string): boolean {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(endpoint);
}

function resolveEndpoint(endpoint: string): string {
  return isAbsoluteUrl(endpoint) ? endpoint : apiUrl(endpoint);
}

export function useStatusLiveSSE(
  opts: UseStatusLiveSSEOptions = {},
): UseStatusLiveSSEResult {
  const {enabled = true, endpoint = '/api/v1/status/live'} = opts;
  const [snapshot, setSnapshot] = useState<StatusV1Snapshot | null>(null);
  const [state, setState] = useState<StatusLiveState>('reconnecting');
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const sourceRef = useRef<NativeEventSource | null>(null);
  const retryRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const closeSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled) {
      return;
    }
    if (cancelledRef.current) {
      return;
    }
    closeSource();
    setState(prev => (prev === 'live' ? 'reconnecting' : prev));

    const EventSourceCtor = getEventSourceConstructor();
    if (EventSourceCtor == null) {
      setState('offline');
      return;
    }

    let es: NativeEventSource;
    try {
      es = new EventSourceCtor(resolveEndpoint(endpoint), {
        withCredentials: true,
      });
    } catch {
      setState('offline');
      return;
    }
    sourceRef.current = es;

    es.addEventListener('open', () => {
      retryRef.current = 0;
      setState('live');
    });

    es.addEventListener('status', ev => {
      try {
        const raw =
          typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
        const parsed = JSON.parse(raw) as StatusV1Snapshot;
        setSnapshot(parsed);
        setLastUpdateAt(Date.now());
        setState('live');
      } catch {
        // Ignore malformed payload — keep prior snapshot, stay live.
      }
    });

    es.addEventListener('heartbeat', () => {
      setState('live');
    });

    es.addEventListener('error', () => {
      if (es.readyState === EVENT_SOURCE_CLOSED) {
        setState('offline');
        const retry = retryRef.current++;
        const delay = Math.min(
          RECONNECT_BASE_MS * Math.pow(2, retry),
          RECONNECT_MAX_MS,
        );
        timerRef.current = setTimeout(connect, delay);
      } else {
        setState('reconnecting');
      }
    });
  }, [enabled, endpoint, closeSource]);

  const reconnect = useCallback(() => {
    retryRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!enabled) {
      closeSource();
      setState('offline');
      return undefined;
    }
    connect();

    const onAppStateChange = (next: AppStateStatus) => {
      if (next === 'active' && sourceRef.current === null) {
        reconnect();
      }
    };
    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      cancelledRef.current = true;
      subscription.remove();
      closeSource();
    };
  }, [enabled, connect, closeSource, reconnect]);

  return {snapshot, state, lastUpdateAt, reconnect};
}
