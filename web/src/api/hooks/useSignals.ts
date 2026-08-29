/**
 * @module api/hooks/useSignals
 *
 * typed-envelope consumers for the per-vehicle signal-inspector
 * endpoints (`/signals/{vehicleID}/available`, `/signals/{vehicleID}/live`,
 * `/signals/{vehicleID}/{signalName}/history`). The backend rewrite in
 * returns each value as `{kind, value, ts}` keyed by the
 * canonical `protomodel.ValueKind` discriminator. These hooks normalize
 * the long-form ValueKind / UnitKind names into the compact `SignalKind`
 * / `SignalUnitKind` unions defined in `@/api/types`, then surface the
 * typed primitive `value` directly so consumers can switch on `kind`
 * without re-parsing strings.
 *
 * Forward-only: there is NO fallback for the previous raw-string
 * value shape. Hooks that need the legacy snapshot-table shape continue
 * to live in `useTelemetry.ts` until the consuming pages move over.
 */

import { useQuery } from '@tanstack/react-query'
import { request } from '../client'
import { INTERVALS, STALE_TIMES } from '@/lib/constants'
import { queryPolicy } from '../queryPolicy'
import type {
  AvailableSignalsResponse,
  LiveSignalsResponse,
  SignalDescriptor,
  SignalEnvelope,
  SignalHistoryEnvelope,
  SignalHistoryResponseTyped,
  SignalKind,
  SignalUnitKind,
  SignalValue,
  TransportAgreementResponse,
} from '../types'

export const signalKeys = {
  available: (vehicleId: number) => ['typed-signals', 'available', vehicleId] as const,
  live: (vehicleId: number) => ['typed-signals', 'live', vehicleId] as const,
  history: (vehicleId: number, name: string, hours: number, from?: string, to?: string, limit?: number) =>
    ['typed-signals', 'history', vehicleId, name, hours, from ?? '', to ?? '', limit ?? 0] as const,
  transportAgreement: (vehicleId: number, hours: number, from?: string, to?: string) =>
    ['typed-signals', 'transport-agreement', vehicleId, hours, from ?? '', to ?? ''] as const,
  historyBatch: (
    revision: number,
    vehicleId: number,
    signals: readonly string[],
    from: string,
    to: string,
    limit: number,
  ) => ['typed-signals', 'history-batch', revision, vehicleId, signals, from, to, limit] as const,
}

/** Time window for /history queries. `hours` (default) is converted into
 * the snake_case `hours` query parameter; explicit `from`/`to` win. */
export interface SignalHistoryRange {
  hours?: number
  from?: string
  to?: string
  limit?: number
}

export interface TransportAgreementRange {
  hours?: number
  from?: string
  to?: string
}

export interface SignalHistoryBatchRequest {
  revision: number
  vehicleId: number
  signals: readonly string[]
  from: string
  to: string
  limit: number
}

// ---------------------------------------------------------------------------
// ValueKind / UnitKind normalization
// ---------------------------------------------------------------------------

/**
 * Map the backend's `protomodel.ValueKind` (sent as either the long-form
 * string "ValueKindFloat" by /live and /history or the proto enum integer
 * by SSE `signal_change`) into the compact `SignalKind` union. The
 * mapping is total: every protomodel value collapses to exactly one
 * compact bucket and unrecognised inputs become `'unknown'`.
 */
export function normalizeSignalKind(raw: unknown): SignalKind {
  if (typeof raw === 'number') {
    // Mirrors the iota order in internal/tesla/protomodel/types.go.
    switch (raw) {
      case 1: return 'string'
      case 2: return 'bool'
      case 3: return 'int'    // ValueKindInt32
      case 4: return 'int'    // ValueKindInt64
      case 5: return 'float'  // ValueKindFloat
      case 6: return 'float'  // ValueKindDouble
      case 7: return 'int'    // ValueKindEnum (wire-format integer)
      case 9: return 'time'
      default: return 'unknown'
    }
  }
  if (typeof raw === 'string') {
    switch (raw) {
      case 'ValueKindString':
      case 'string':
        return 'string'
      case 'ValueKindBool':
      case 'bool':
        return 'bool'
      case 'ValueKindInt32':
      case 'ValueKindInt64':
      case 'ValueKindEnum':
      case 'int':
        return 'int'
      case 'ValueKindFloat':
      case 'ValueKindDouble':
      case 'float':
        return 'float'
      case 'ValueKindTime':
      case 'time':
        return 'time'
      default:
        return 'unknown'
    }
  }
  return 'unknown'
}

const UNIT_KIND_MAP: Record<string, SignalUnitKind> = {
  UnitKindNone: 'none',
  UnitKindDistance: 'distance',
  UnitKindTemperature: 'temperature',
  UnitKindPressure: 'pressure',
  UnitKindCharge: 'charge',
  none: 'none',
  distance: 'distance',
  temperature: 'temperature',
  pressure: 'pressure',
  charge: 'charge',
  speed: 'speed',
}

export function normalizeUnitKind(raw: unknown): SignalUnitKind {
  if (typeof raw === 'string' && raw in UNIT_KIND_MAP) {
    return UNIT_KIND_MAP[raw]
  }
  return 'none'
}

interface RawSignalEnvelope {
  kind?: unknown
  value?: unknown
  ts?: string
}

/**
 * Coerce the JSON-decoded raw envelope into the typed `SignalEnvelope`.
 * The backend serialises each typed primitive as its native JSON type
 * (number / boolean / string), so the only work here is normalizing
 * `kind` and falling back to `null` when the typed column was empty.
 */
export function normalizeEnvelope(raw: RawSignalEnvelope | null | undefined): SignalEnvelope {
  if (!raw) {
    return { kind: 'unknown', value: null, ts: '' }
  }
  const kind = normalizeSignalKind(raw.kind)
  return {
    kind,
    value: coerceValue(raw.value, kind),
    ts: raw.ts ?? '',
  }
}

function coerceValue(value: unknown, kind: SignalKind): SignalValue {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'string':
    case 'time':
      return typeof value === 'string' ? value : String(value)
    case 'bool':
      return typeof value === 'boolean' ? value : Boolean(value)
    case 'int':
    case 'float':
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const n = Number(value)
        return Number.isFinite(n) ? n : null
      }
      return null
    case 'unknown':
    default:
      // Pass through if it is already a primitive we model; otherwise null.
      if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
        return value
      }
      return null
  }
}

interface RawAvailableResponse {
  vehicle_id: number
  count: number
  source: string
  signals?: Array<{
    name: string
    category: string
    value_kind: unknown
    unit_kind: unknown
    is_compound: boolean
    is_setting_unit: boolean
  }>
}

function normalizeDescriptor(raw: RawAvailableResponse['signals'] extends (infer T)[] | undefined ? T : never): SignalDescriptor {
  return {
    name: raw.name,
    category: raw.category,
    value_kind: normalizeSignalKind(raw.value_kind),
    unit_kind: normalizeUnitKind(raw.unit_kind),
    is_compound: !!raw.is_compound,
    is_setting_unit: !!raw.is_setting_unit,
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * GET /signals/{vehicleID}/available — typed catalog of every Tesla
 * telemetry field the backend exposes (). The
 * response is normalized so each entry's `value_kind` / `unit_kind`
 * uses the compact `SignalKind` / `SignalUnitKind` discriminators
 * defined in `@/api/types`.
 */
export function useAvailableSignals(vehicleId: number) {
  return useQuery({
    queryKey: signalKeys.available(vehicleId),
    queryFn: async ({ signal }): Promise<AvailableSignalsResponse> => {
      const raw = await request<RawAvailableResponse>(`/signals/${vehicleId}/available`, { signal })
      const signals = (raw.signals ?? []).map(normalizeDescriptor)
      return {
        vehicle_id: raw.vehicle_id,
        count: raw.count,
        source: raw.source,
        signals,
      }
    },
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.SLOW,
  })
}

interface RawLiveResponse {
  vehicle_id: number
  count: number
  at: string
  signals?: Record<string, RawSignalEnvelope | null | undefined>
}

/**
 * GET /signals/{vehicleID}/live — current per-field typed envelope keyed
 * by the canonical proto field name. Each value is normalized into a
 * `SignalEnvelope` so callers can switch on `kind` and trust the typed
 * `value` (e.g. `typeof envelope.value === 'number'` after `kind` is
 * `'float'`).
 */
export function useLiveSignals(vehicleId: number) {
  return useQuery({
    queryKey: signalKeys.live(vehicleId),
    queryFn: async ({ signal }): Promise<LiveSignalsResponse> => {
      const raw = await request<RawLiveResponse>(`/signals/${vehicleId}/live`, { signal })
      const signals: Record<string, SignalEnvelope> = {}
      for (const [field, env] of Object.entries(raw.signals ?? {})) {
        signals[field] = normalizeEnvelope(env ?? null)
      }
      return {
        vehicle_id: raw.vehicle_id,
        count: raw.count,
        at: raw.at,
        signals,
      }
    },
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: INTERVALS.REALTIME,
    retry: 1,
  })
}

interface RawHistoryResponse {
  vehicle_id: number
  signal: string
  expected_kind: string
  from: string
  to: string
  count: number
  data?: RawHistoryEnvelope[]
}

interface RawHistoryEnvelope extends RawSignalEnvelope {
  ingest_origin?: string | null
  source_emitted_at?: string | null
  received_at?: string | null
  normalization_version?: number | null
}

function normalizeHistoryEnvelope(raw: RawHistoryEnvelope): SignalHistoryEnvelope {
  const envelope = normalizeEnvelope(raw)
  const ingestOrigin = raw.ingest_origin
  return {
    ...envelope,
    ingest_origin:
      ingestOrigin === 'unknown' ||
      ingestOrigin === 'fleet_telemetry_mqtt' ||
      ingestOrigin === 'fleet_telemetry_http'
        ? ingestOrigin
        : null,
    source_emitted_at: raw.source_emitted_at ?? null,
    received_at: raw.received_at ?? null,
    normalization_version: typeof raw.normalization_version === 'number'
      ? raw.normalization_version
      : null,
  }
}

/**
 * GET /signals/{vehicleID}/{signalName}/history — typed time-series for a
 * single signal. `range` controls the window: `hours` is the simplest
 * form (sent as the snake_case `hours` query param); `from`/`to` accept
 * RFC3339 timestamps and override `hours` when both are present.
 */
export function useSignalHistory(
  vehicleId: number,
  signalName: string,
  range: SignalHistoryRange = { hours: 24 },
) {
  const hours = range.hours ?? 24
  return useQuery({
    queryKey: signalKeys.history(vehicleId, signalName, hours, range.from, range.to, range.limit),
    queryFn: async ({ signal }): Promise<SignalHistoryResponseTyped> => {
      const usp = new URLSearchParams()
      if (range.from && range.to) {
        usp.set('from', range.from)
        usp.set('to', range.to)
      } else {
        usp.set('hours', String(hours))
      }
      if (range.limit && range.limit > 0) {
        usp.set('limit', String(range.limit))
      }
      const qs = usp.toString()
      const raw = await request<RawHistoryResponse>(
        `/signals/${vehicleId}/${signalName}/history${qs ? `?${qs}` : ''}`,
        { signal },
      )
      const data = (raw.data ?? []).map(normalizeHistoryEnvelope)
      return {
        vehicle_id: raw.vehicle_id,
        signal: raw.signal,
        expected_kind: raw.expected_kind,
        from: raw.from,
        to: raw.to,
        count: raw.count,
        data,
      }
    },
    enabled: vehicleId > 0 && !!signalName,
    staleTime: STALE_TIMES.STANDARD,
  })
}

/** Fetches one immutable, explicitly submitted history request across signals. */
export function useSignalHistoryBatch(batch: SignalHistoryBatchRequest | null) {
  const revision = batch?.revision ?? 0
  const vehicleId = batch?.vehicleId ?? 0
  const signals = batch?.signals ?? []
  const from = batch?.from ?? ''
  const to = batch?.to ?? ''
  const limit = batch?.limit ?? 0

  return useQuery({
    queryKey: signalKeys.historyBatch(revision, vehicleId, signals, from, to, limit),
    queryFn: async ({ signal }): Promise<SignalHistoryResponseTyped[]> => {
      const results = await Promise.all(
        signals.map(async (signalName) => {
          const params = new URLSearchParams({ from, to, limit: String(limit) })
          const raw = await request<RawHistoryResponse>(
            `/signals/${vehicleId}/${encodeURIComponent(signalName)}/history?${params.toString()}`,
            { signal },
          )
          return {
            vehicle_id: raw.vehicle_id,
            signal: raw.signal,
            expected_kind: raw.expected_kind,
            from: raw.from,
            to: raw.to,
            count: raw.count,
            data: (raw.data ?? []).map(normalizeHistoryEnvelope),
          }
        }),
      )
      return results
    },
    enabled:
      batch != null &&
      vehicleId > 0 &&
      signals.length > 0 &&
      from !== '' &&
      to !== '' &&
      limit > 0,
    ...queryPolicy('historical'),
  })
}

/** GET /signals/{vehicleID}/transport-agreement — source-time-only audit. */
export function useTransportAgreement(
  vehicleId: number,
  range: TransportAgreementRange = { hours: 24 },
  enabled = true,
) {
  const hours = range.hours ?? 24
  return useQuery({
    queryKey: signalKeys.transportAgreement(vehicleId, hours, range.from, range.to),
    queryFn: ({ signal }): Promise<TransportAgreementResponse> => {
      const params = new URLSearchParams()
      if (range.from && range.to) {
        params.set('from', range.from)
        params.set('to', range.to)
      } else {
        params.set('hours', String(hours))
      }
      return request<TransportAgreementResponse>(
        `/signals/${vehicleId}/transport-agreement?${params.toString()}`,
        { signal },
      )
    },
    enabled: enabled && vehicleId > 0,
    ...queryPolicy('historical'),
  })
}
