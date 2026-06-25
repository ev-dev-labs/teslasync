/**
 * @module api/sseClient
 *
 * Native parity for the sanctioned typed-envelope SSE consumer.
 *
 * React Native does not ship a browser EventSource implementation. This module
 * uses a host-provided global EventSource polyfill when present and reports an
 * explicit unavailable error through the existing onError callback otherwise.
 */

import {apiUrl} from './client';

const SSE_EVENTS_PATH = '/api/v1/events';
const SIGNAL_CHANGE_EVENT = 'signal_change';

export const SSE_CLIENT_UNAVAILABLE_REASON =
  'React Native does not provide EventSource by default; install a compatible polyfill to receive signal_change SSE events.';

export type SignalsSSERealtimeStatus = 'subscribed' | 'unavailable';

/**
 * Compact discriminator for a typed signal value. Mirrors the `SignalKind`
 * union in web/src/api/types.ts and maps from protomodel.ValueKind after
 * normalization.
 */
export type SignalKind =
  | 'string'
  | 'bool'
  | 'int'
  | 'float'
  | 'time'
  | 'unknown';

/**
 * Discriminated typed-primitive carried alongside `SignalEnvelope`.
 */
export type SIValue =
  | {kind: 'number'; value: number; unit?: string}
  | {kind: 'string'; value: string}
  | {kind: 'bool'; value: boolean}
  | {kind: 'time'; value: string}
  | {kind: 'null'; value: null};

/**
 * Typed SSE envelope mirroring internal/api/sse_handler.go::SignalChangeEvent.
 */
export interface SignalEnvelope {
  vehicle_id: number;
  field: string;
  kind: SignalKind;
  value: SIValue;
  ts: string;
}

const KNOWN_COMPACT_KINDS: ReadonlySet<string> = new Set<SignalKind>([
  'string',
  'bool',
  'int',
  'float',
  'time',
  'unknown',
]);

const VALUE_KIND_LONG_TO_COMPACT: Readonly<Record<string, SignalKind>> = {
  ValueKindString: 'string',
  ValueKindBool: 'bool',
  ValueKindInt32: 'int',
  ValueKindInt64: 'int',
  ValueKindEnum: 'int',
  ValueKindFloat: 'float',
  ValueKindDouble: 'float',
  ValueKindTime: 'time',
  ValueKindUnknown: 'unknown',
  ValueKindCompound: 'unknown',
  ValueKindInvalid: 'unknown',
};

const VALUE_KIND_INT_TO_COMPACT: Readonly<Record<number, SignalKind>> = {
  0: 'unknown',
  1: 'string',
  2: 'bool',
  3: 'int',
  4: 'int',
  5: 'float',
  6: 'float',
  7: 'int',
  8: 'unknown',
  9: 'time',
};

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

export function getSignalsSSERealtimeStatus(): SignalsSSERealtimeStatus {
  return getEventSourceConstructor() == null ? 'unavailable' : 'subscribed';
}

function isAbsoluteUrl(endpoint: string): boolean {
  return /^[a-z][a-z\d+\-.]*:\/\//i.test(endpoint);
}

function resolveEndpoint(endpoint: string): string {
  return isAbsoluteUrl(endpoint) ? endpoint : apiUrl(endpoint);
}

function normalizeKind(raw: unknown): SignalKind | null {
  if (typeof raw === 'number') {
    return VALUE_KIND_INT_TO_COMPACT[raw] ?? null;
  }
  if (typeof raw === 'string') {
    if (KNOWN_COMPACT_KINDS.has(raw)) {
      return raw as SignalKind;
    }
    return VALUE_KIND_LONG_TO_COMPACT[raw] ?? null;
  }
  return null;
}

function coerceValue(value: unknown, kind: SignalKind): SIValue {
  if (value === null || value === undefined) {
    return {kind: 'null', value: null};
  }

  switch (kind) {
    case 'int':
    case 'float': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return {kind: 'number', value};
      }
      if (typeof value === 'string') {
        const n = Number(value);
        if (Number.isFinite(n)) {
          return {kind: 'number', value: n};
        }
      }
      return {kind: 'null', value: null};
    }
    case 'bool':
      return {
        kind: 'bool',
        value: typeof value === 'boolean' ? value : Boolean(value),
      };
    case 'string':
      return {
        kind: 'string',
        value: typeof value === 'string' ? value : String(value),
      };
    case 'time':
      return {
        kind: 'time',
        value: typeof value === 'string' ? value : String(value),
      };
    case 'unknown':
    default:
      if (typeof value === 'number' && Number.isFinite(value)) {
        return {kind: 'number', value};
      }
      if (typeof value === 'boolean') {
        return {kind: 'bool', value};
      }
      if (typeof value === 'string') {
        return {kind: 'string', value};
      }
      return {kind: 'null', value: null};
  }
}

/**
 * Parse and validate a single raw SSE data payload into a typed SignalEnvelope.
 * Returns an Error instead of throwing so the receive loop can report malformed
 * events through the caller-supplied error handler.
 */
export function parseEnvelope(raw: string): SignalEnvelope | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return new Error(`sse: malformed JSON: ${reason}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return new Error('sse: payload is not an object');
  }
  const payload = parsed as Record<string, unknown>;
  const kind = normalizeKind(payload.kind);
  if (kind === null) {
    return new Error(`sse: unknown kind: ${JSON.stringify(payload.kind)}`);
  }
  if (typeof payload.field !== 'string' || payload.field.length === 0) {
    return new Error('sse: missing or empty field');
  }
  if (
    typeof payload.vehicle_id !== 'number' ||
    !Number.isFinite(payload.vehicle_id)
  ) {
    return new Error('sse: missing or invalid vehicle_id');
  }
  return {
    vehicle_id: payload.vehicle_id,
    field: payload.field,
    kind,
    value: coerceValue(payload.value, kind),
    ts: typeof payload.ts === 'string' ? payload.ts : '',
  };
}

export type SignalEnvelopeHandler = (envelope: SignalEnvelope) => void;
export type SignalErrorHandler = (err: Error, raw?: string) => void;

export interface SubscribeOptions {
  /**
   * Override the SSE endpoint. Defaults to `/api/v1/events`. Absolute URLs are
   * passed through; relative API paths are resolved through the native API base.
   */
  endpoint?: string;
}

/**
 * Subscribe to the typed `signal_change` SSE channel.
 *
 * `vehicleId` and `fields` apply client-side filters because the backend
 * multiplexes every vehicle's signal_change events onto `/api/v1/events`.
 */
export function subscribeSignals(
  vehicleId: number,
  fields: readonly string[],
  onEnvelope: SignalEnvelopeHandler,
  onError: SignalErrorHandler,
  options: SubscribeOptions = {},
): () => void {
  const endpoint = options.endpoint ?? SSE_EVENTS_PATH;
  const fieldFilter = new Set(fields);
  const filterByField = fieldFilter.size > 0;
  const filterByVehicle = vehicleId > 0;

  const EventSourceCtor = getEventSourceConstructor();
  if (EventSourceCtor == null) {
    onError(new Error(`sse: ${SSE_CLIENT_UNAVAILABLE_REASON}`));
    return () => undefined;
  }

  const source = new EventSourceCtor(resolveEndpoint(endpoint));

  const onMessage = (ev: NativeEventSourceEvent) => {
    const data = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '');
    const result = parseEnvelope(data);
    if (result instanceof Error) {
      onError(result, data);
      return;
    }
    if (filterByVehicle && result.vehicle_id !== vehicleId) {
      return;
    }
    if (filterByField && !fieldFilter.has(result.field)) {
      return;
    }
    onEnvelope(result);
  };

  const onSourceError = () => {
    onError(new Error('sse: EventSource error'));
  };

  source.addEventListener(SIGNAL_CHANGE_EVENT, onMessage);
  source.addEventListener('error', onSourceError);

  return () => {
    source.removeEventListener?.(SIGNAL_CHANGE_EVENT, onMessage);
    source.removeEventListener?.('error', onSourceError);
    source.close();
  };
}
