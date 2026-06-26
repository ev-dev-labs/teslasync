/**
 * @module hooks/useSSE
 *
 * Native parity port of web/src/hooks/useSSE.ts.
 *
 * Typed-envelope SSE consumer. Subscribes to the per-signal `signal_change`
 * event introduced by `EventHub.BroadcastSignalChange` and surfaces each
 * event as a typed `SignalChangeEvent` so React components can switch on
 * `kind` and trust the typed `value` directly. Forward-only: there is NO
 * fallback for the previous raw-string value shape.
 *
 * The legacy aggregate hooks (`useRealtimeEvents`, `useVehicleLive`)
 * still subscribe through the singleton `sseManager` which only listens
 * for the batched `vehicle_update` channel. To keep the typed channel
 * routing isolated, this hook opens its own `EventSource` against
 * `/api/v1/events` and listens specifically for
 * the `signal_change` event. Browsers multiplex an HTTP/2 connection,
 * so the second EventSource shares the same TCP socket.
 *
 * Web -> native adaptation (conversion contract rule 7): the browser global
 * `EventSource` has no React Native equivalent. This hook probes
 * `globalThis.EventSource` for a host-provided polyfill at effect time (the
 * same pattern as the sseClient/sseManager parity ports). When none is present
 * (the React Native default) the effect is a no-op that leaves the subscription
 * in the explicit unavailable state — `onSignalChange` is simply never invoked,
 * mirroring the forward-only web hook which also surfaces nothing until the
 * stream yields a `signal_change` event — so consumers degrade gracefully
 * instead of crashing. The relative `/api/v1/events` endpoint is resolved
 * through the native `apiUrl` helper so an installed polyfill receives an
 * absolute URL, while absolute test endpoints pass through unchanged.
 */

import {useEffect, useRef} from 'react';

import type {SignalChangeEvent} from '../api/types';
import {normalizeSignalKind} from '../api/hooks/useSignals';
import {apiUrl} from '../api/client';

export interface UseSignalChangeStreamOptions {
  /** Disable the subscription (e.g., behind a feature flag). Defaults to true. */
  enabled?: boolean;
  /**
   * Optional vehicle filter. When set, the handler is only called for
   * events whose `vehicle_id` matches. Server-side filtering is not yet
   * implemented; this is purely a client-side narrow.
   */
  vehicleId?: number;
  /**
   * Override the SSE endpoint. Defaults to `/api/v1/events`. Exposed
   * primarily for tests that swap in a mock URL.
   */
  endpoint?: string;
}

interface RawSignalChangePayload {
  vehicle_id?: number;
  field?: string;
  kind?: unknown;
  value?: unknown;
  ts?: string;
}

/**
 * Coerces the on-wire JSON into a typed `SignalChangeEvent`. The on-wire
 * `kind` may be either the long-form `protomodel.ValueKind.String()`
 * (e.g. "ValueKindFloat") or the integer enum value (`5`); both are
 * normalized into the compact `SignalKind` union.
 */
export function parseSignalChangeEvent(raw: unknown): SignalChangeEvent | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const payload = raw as RawSignalChangePayload;
  if (typeof payload.field !== 'string' || payload.field.length === 0) {
    return null;
  }
  if (typeof payload.vehicle_id !== 'number') {
    return null;
  }

  const kind = normalizeSignalKind(payload.kind);
  const value = coerceValue(payload.value, kind);
  return {
    vehicle_id: payload.vehicle_id,
    field: payload.field,
    kind,
    value,
    ts: payload.ts ?? '',
  };
}

function coerceValue(
  value: unknown,
  kind: SignalChangeEvent['kind'],
): SignalChangeEvent['value'] {
  if (value === null || value === undefined) {
    return null;
  }
  switch (kind) {
    case 'string':
    case 'time':
      return typeof value === 'string' ? value : String(value);
    case 'bool':
      return typeof value === 'boolean' ? value : Boolean(value);
    case 'int':
    case 'float':
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    default:
      if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        typeof value === 'number'
      ) {
        return value;
      }
      return null;
  }
}

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

/**
 * Subscribe to the typed `signal_change` SSE channel and invoke
 * `onSignalChange` for each parsed event. The handler is tracked via a
 * ref so callers can pass a fresh closure each render without
 * tearing down the EventSource connection.
 */
export function useSignalChangeStream(
  onSignalChange: (event: SignalChangeEvent) => void,
  options: UseSignalChangeStreamOptions = {},
): void {
  const {enabled = true, vehicleId, endpoint = '/api/v1/events'} = options;
  const handlerRef = useRef(onSignalChange);
  handlerRef.current = onSignalChange;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // React Native ships no EventSource; probe for a host-provided polyfill.
    // Without one we cannot open a stream, so the subscription stays in the
    // explicit unavailable state (the handler is never invoked) instead of
    // crashing — mirroring the forward-only web hook, which likewise surfaces
    // nothing until a `signal_change` event arrives.
    const EventSourceCtor = getEventSourceConstructor();
    if (EventSourceCtor == null) {
      return;
    }

    const source = new EventSourceCtor(resolveEndpoint(endpoint));

    const onMessage = (ev: NativeEventSourceEvent) => {
      const data =
        typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const event = parseSignalChangeEvent(parsed);
      if (!event) {
        return;
      }
      if (vehicleId != null && event.vehicle_id !== vehicleId) {
        return;
      }
      handlerRef.current(event);
    };

    source.addEventListener('signal_change', onMessage);

    return () => {
      source.removeEventListener?.('signal_change', onMessage);
      source.close();
    };
  }, [enabled, endpoint, vehicleId]);
}
