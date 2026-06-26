/**
 * @module lib/automationSSE
 *
 * Native parity for the lightweight automation-events SSE client.
 *
 * Mirrors web/src/lib/automationSSE.ts: a dedicated client for
 * /api/v1/automations/events (separate from the global signal sseManager)
 * that handles capped exponential-backoff reconnect and typed event dispatch.
 * Auth is handled via ForwardAuth cookie (same-origin on web; carried by the
 * native fetch/credentials stack here).
 *
 * React Native ships no browser EventSource. Following the sibling
 * api/sseClient.ts native port, this module uses a host-provided global
 * EventSource polyfill when present and otherwise stays in the truthful
 * 'reconnecting' state (it never falsely reports 'connected') and surfaces an
 * explicit unavailable reason. The relative endpoint resolves through the
 * native API base via apiUrl().
 */

import { apiUrl } from '../api/client';
import type {
  AutomationTriggeredEvent,
  AutomationSucceededEvent,
  AutomationFailedEvent,
  AutomationSkippedEvent,
  AutomationStateChangedEvent,
  AutomationSSEEventType,
} from '../api/types';

type AutomationEventData =
  | AutomationTriggeredEvent
  | AutomationSucceededEvent
  | AutomationFailedEvent
  | AutomationSkippedEvent
  | AutomationStateChangedEvent;

export type AutomationSSEListener = (
  type: AutomationSSEEventType,
  data: AutomationEventData,
) => void;
type ConnectionListener = () => void;

interface AutomationSSEClient {
  subscribe: (listener: AutomationSSEListener) => void;
  unsubscribe: (listener: AutomationSSEListener) => void;
  onConnect: (listener: ConnectionListener) => void;
  offConnect: (listener: ConnectionListener) => void;
  getState: () => 'connected' | 'reconnecting';
}

/**
 * Explicit reason surfaced when no EventSource implementation is available so
 * callers/log readers can tell "not connected yet" apart from "cannot connect
 * on this platform". A host wires realtime by exposing a global EventSource
 * polyfill before the first subscribe().
 */
export const AUTOMATION_SSE_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; install a compatible polyfill to receive automation SSE events.';

type NativeEventSourceEvent = {
  readonly data?: unknown;
};

type NativeEventSourceListener = (event: NativeEventSourceEvent) => void;

interface NativeEventSource {
  addEventListener(event: string, listener: NativeEventSourceListener): void;
  close(): void;
  onerror: (() => void) | null;
}

type NativeEventSourceConstructor = new (url: string) => NativeEventSource;

function getEventSourceConstructor(): NativeEventSourceConstructor | null {
  const candidate = (
    globalThis as typeof globalThis & { EventSource?: unknown }
  ).EventSource;
  return typeof candidate === 'function'
    ? (candidate as NativeEventSourceConstructor)
    : null;
}

const AUTOMATION_EVENTS_PATH = '/api/v1/automations/events';

const eventListeners = new Set<AutomationSSEListener>();
const connectListeners = new Set<ConnectionListener>();
let source: NativeEventSource | null = null;
let state: 'connected' | 'reconnecting' = 'reconnecting';
let failCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let connecting = false;

// Capped exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;

const EVENT_TYPES: AutomationSSEEventType[] = [
  'automation.triggered',
  'automation.succeeded',
  'automation.failed',
  'automation.skipped',
  'automation.state_changed',
];

function emit(type: AutomationSSEEventType, data: AutomationEventData) {
  for (const fn of eventListeners) {
    try {
      fn(type, data);
    } catch (e) {
      console.error('AutomationSSE listener error:', e);
    }
  }
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

  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    // No browser EventSource and no host-provided polyfill: stay in the
    // truthful 'reconnecting' state rather than pretending a live stream
    // exists. Once a host wires a global EventSource polyfill, a later
    // subscribe() re-enters doConnect() and connects for real.
    connecting = false;
    state = 'reconnecting';
    console.warn(`AutomationSSE: ${AUTOMATION_SSE_UNAVAILABLE_REASON}`);
    return;
  }

  const es = new EventSourceCtor(apiUrl(AUTOMATION_EVENTS_PATH));
  source = es;

  es.addEventListener('connected', () => {
    state = 'connected';
    failCount = 0;
    connecting = false;
    for (const fn of connectListeners) {
      try {
        fn();
      } catch (e) {
        console.error('AutomationSSE connect listener error:', e);
      }
    }
  });

  for (const eventType of EVENT_TYPES) {
    es.addEventListener(eventType, e => {
      try {
        const raw = typeof e.data === 'string' ? e.data : String(e.data ?? '');
        const data = JSON.parse(raw) as AutomationEventData;
        emit(eventType, data);
      } catch (err) {
        console.error(`AutomationSSE: failed to parse ${eventType}:`, err);
      }
    });
  }

  es.addEventListener('heartbeat', () => {
    // keep-alive ping: intentionally ignored
  });

  es.onerror = () => {
    es.close();
    source = null;
    connecting = false;
    failCount++;

    state = 'reconnecting';
    const backoff = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, failCount - 1),
      MAX_BACKOFF_MS,
    );
    reconnectTimer = setTimeout(() => {
      doConnect();
    }, backoff);
  };
}

export const automationSSE: AutomationSSEClient = {
  subscribe(listener) {
    eventListeners.add(listener);
    if (!source && !connecting) {
      doConnect();
    }
  },

  unsubscribe(listener) {
    eventListeners.delete(listener);
    // Auto-disconnect when no subscribers remain
    if (eventListeners.size === 0 && source) {
      source.close();
      source = null;
      state = 'reconnecting';
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    }
  },

  onConnect(listener) {
    connectListeners.add(listener);
  },

  offConnect(listener) {
    connectListeners.delete(listener);
  },

  getState() {
    return state;
  },
};
