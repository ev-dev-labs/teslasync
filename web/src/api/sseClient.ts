/**
 * @module api/sseClient
 *
 * Sanctioned typed-envelope SSE consumer.
 *
 * Sole approved consumer of the typed-envelope SSE channel introduced by
 * `EventHub.BroadcastSignalChange` in `internal/api/sse_handler.go`. Pages, features
 * and hooks MUST go through this client; direct `EventSource`
 * construction is forbidden in `web/src/features/` and
 * `web/src/api/hooks/` per
 * `.github/instructions/frontend-si-cutover.instructions.md` rule 5.
 *
 * --- Backend envelope (source of truth) -----------------------------------
 * `internal/api/sse_handler.go::SignalChangeEvent` is the on-wire shape:
 *
 *   {
 *     "stream_id":  <server-epoch>,
 *     "sequence":   <monotonic integer>,
 *     "vehicle_id": <int64>,
 *     "field":      <proto-name>,
 *     "kind":       <protomodel.ValueKind>,
 *     "value":      <typed primitive>,
 *     "ts":         <RFC3339>
 *   }
 *
 * served on `/api/v1/events` (router.go:1372) as the named SSE event
 * `signal_change`. This client matches the real backend contract, not older
 * design sketches that used `{ kind, value: SIValue, ts: number }` or a
 * `/api/v1/signals/{vehicle_id}/stream?fields=...` endpoint.
 *
 * `SIValue` is exported as a discriminated-union helper layered on top
 * of the backend's flat `(kind, value)` pair so callers can narrow on
 * the typed primitive without re-inferring from the long-form
 * `protomodel.ValueKind` discriminator. Either side of the pair is
 * sufficient for type-safe consumption: switch on `envelope.kind` for
 * the protomodel bucket, or destructure `envelope.value` for the
 * primitive.
 */

const SSE_EVENTS_PATH = '/api/v1/events'
const SIGNAL_CHANGE_EVENT = 'signal_change'

/**
 * Compact discriminator for a typed signal value. Mirrors the
 * `SignalKind` union in `web/src/api/types.ts`. Maps from
 * `protomodel.ValueKind` after normalization:
 *   string  ← ValueKindString
 *   bool    ← ValueKindBool
 *   int     ← ValueKindInt32 / ValueKindInt64 / ValueKindEnum
 *   float   ← ValueKindFloat / ValueKindDouble
 *   time    ← ValueKindTime
 *   unknown ← ValueKindUnknown / ValueKindCompound / ValueKindInvalid
 */
export type SignalKind =
  | 'string'
  | 'bool'
  | 'int'
  | 'float'
  | 'time'
  | 'unknown'

/**
 * Discriminated typed-primitive carried alongside `SignalEnvelope`. The
 * inner `kind` collapses the integer/float distinction into `'number'`
 * because both flow through the same JSON-decoded `number` runtime
 * type. `unit` is reserved for callers that join against the unit catalog
 * (e.g. `LiveSignalsResponse` paired with the field's
 * `SignalDescriptor.unit_kind`); the SSE envelope itself does not carry
 * units, so it is optional and currently undefined for `signal_change`
 * events. `'null'` represents an explicit null/missing typed column.
 */
export type SIValue =
  | { kind: 'number'; value: number; unit?: string }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'time'; value: string }
  | { kind: 'null'; value: null }

/**
 * Typed SSE envelope mirroring `internal/api/sse_handler.go::SignalChangeEvent`.
 *
 * `kind` retains the protomodel discriminator so callers that already
 * switch on the long-form `SignalKind` (e.g. `useSignals.ts`
 * normalizers) keep working. `value` is the discriminated `SIValue`
 * helper for callers that prefer to narrow on the primitive directly.
 *
 * `ts` is RFC3339 / ISO 8601 because the backend serializes `time.Time` as
 * a string. Callers can parse it with `Date.parse(ts)` when needed.
 */
export interface SignalEnvelope {
  stream_id: string
  sequence: number
  vehicle_id: number
  field: string
  kind: SignalKind
  value: SIValue
  ts: string
}

const KNOWN_COMPACT_KINDS: ReadonlySet<string> = new Set<SignalKind>([
  'string',
  'bool',
  'int',
  'float',
  'time',
  'unknown',
])

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
}

// Mirrors the iota order in internal/tesla/protomodel/types.go.
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
}

function normalizeKind(raw: unknown): SignalKind | null {
  if (typeof raw === 'number') {
    return VALUE_KIND_INT_TO_COMPACT[raw] ?? null
  }
  if (typeof raw === 'string') {
    if (KNOWN_COMPACT_KINDS.has(raw)) return raw as SignalKind
    return VALUE_KIND_LONG_TO_COMPACT[raw] ?? null
  }
  return null
}

function coerceValue(value: unknown, kind: SignalKind): SIValue {
  if (value === null || value === undefined) {
    return { kind: 'null', value: null }
  }
  switch (kind) {
    case 'int':
    case 'float': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { kind: 'number', value }
      }
      if (typeof value === 'string') {
        const n = Number(value)
        if (Number.isFinite(n)) return { kind: 'number', value: n }
      }
      return { kind: 'null', value: null }
    }
    case 'bool':
      return { kind: 'bool', value: typeof value === 'boolean' ? value : Boolean(value) }
    case 'string':
      return { kind: 'string', value: typeof value === 'string' ? value : String(value) }
    case 'time':
      return { kind: 'time', value: typeof value === 'string' ? value : String(value) }
    case 'unknown':
    default:
      if (typeof value === 'number' && Number.isFinite(value)) {
        return { kind: 'number', value }
      }
      if (typeof value === 'boolean') return { kind: 'bool', value }
      if (typeof value === 'string') return { kind: 'string', value }
      return { kind: 'null', value: null }
  }
}

/**
 * Parse and validate a single raw SSE `data:` payload into a typed
 * `SignalEnvelope`. Returns an `Error` (NOT thrown) on:
 *
 *   - malformed JSON
 *   - non-object payload
 *   - missing / non-string `field`
 *   - missing / non-number `vehicle_id`
 *   - unknown / non-numeric `kind` discriminator
 *
 * Returning an `Error` keeps the contract surface narrow and avoids a
 * try/catch ladder in the receive loop. Callers MUST `instanceof Error`
 * narrow before accessing envelope fields.
 */
export function parseEnvelope(raw: string): SignalEnvelope | Error {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return new Error(`sse: malformed JSON: ${reason}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return new Error('sse: payload is not an object')
  }
  const payload = parsed as Record<string, unknown>
  const kind = normalizeKind(payload.kind)
  if (kind === null) {
    return new Error(`sse: unknown kind: ${JSON.stringify(payload.kind)}`)
  }
  if (typeof payload.field !== 'string' || payload.field.length === 0) {
    return new Error('sse: missing or empty field')
  }
  if (typeof payload.vehicle_id !== 'number' || !Number.isFinite(payload.vehicle_id)) {
    return new Error('sse: missing or invalid vehicle_id')
  }
  return {
    stream_id: typeof payload.stream_id === 'string' ? payload.stream_id : '',
    sequence: typeof payload.sequence === 'number' && Number.isSafeInteger(payload.sequence)
      ? payload.sequence
      : 0,
    vehicle_id: payload.vehicle_id,
    field: payload.field,
    kind,
    value: coerceValue(payload.value, kind),
    ts: typeof payload.ts === 'string' ? payload.ts : '',
  }
}

export type SignalEnvelopeHandler = (envelope: SignalEnvelope) => void
export type SignalErrorHandler = (err: Error, raw?: string) => void

export interface SubscribeOptions {
  /**
   * Override the SSE endpoint. Defaults to `/api/v1/events`. Exposed primarily
   * for tests that swap in a mock URL.
   */
  endpoint?: string
}

/**
 * Subscribe to the typed `signal_change` SSE channel.
 *
 * `vehicleId` and `fields` apply client-side filters: the backend's
 * `/events` endpoint multiplexes every vehicle's `signal_change` events
 * onto a single stream; server-side per-vehicle filtering is not implemented.
 * Pass `vehicleId <= 0` to opt out of the
 * per-vehicle filter; pass an empty `fields` array to opt out of the
 * per-field filter.
 *
 * `onError` is invoked when a payload fails to parse (with the raw
 * payload as the second argument) and when the underlying EventSource
 * emits its own `error` event. The raw `EventSource` is NEVER exposed
 * to the caller — only the cleanup function is returned. Calling the
 * cleanup function removes both listeners and closes the connection.
 */
export function subscribeSignals(
  vehicleId: number,
  fields: readonly string[],
  onEnvelope: SignalEnvelopeHandler,
  onError: SignalErrorHandler,
  options: SubscribeOptions = {},
): () => void {
  const endpoint = options.endpoint ?? SSE_EVENTS_PATH
  const fieldFilter = new Set(fields)
  const filterByField = fieldFilter.size > 0
  const filterByVehicle = vehicleId > 0

  const source = new EventSource(endpoint)

  const onMessage = (ev: MessageEvent<string>) => {
    const data = typeof ev.data === 'string' ? ev.data : String(ev.data ?? '')
    const result = parseEnvelope(data)
    if (result instanceof Error) {
      onError(result, data)
      return
    }
    if (filterByVehicle && result.vehicle_id !== vehicleId) return
    if (filterByField && !fieldFilter.has(result.field)) return
    onEnvelope(result)
  }

  const onSourceError = () => {
    onError(new Error('sse: EventSource error'))
  }

  source.addEventListener(SIGNAL_CHANGE_EVENT, onMessage as EventListener)
  source.addEventListener('error', onSourceError)

  return () => {
    source.removeEventListener(SIGNAL_CHANGE_EVENT, onMessage as EventListener)
    source.removeEventListener('error', onSourceError)
    source.close()
  }
}
