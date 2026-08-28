/**
 * @module hooks/useSSE
 *
 * Typed-envelope SSE consumer. Subscribes to the per-signal `signal_change`
 * event introduced by `EventHub.BroadcastSignalChange` and surfaces each
 * event as a typed `SignalChangeEvent` so React components can switch on
 * `kind` and trust the typed `value` directly. Forward-only: there is NO
 * fallback for the previous raw-string value shape.
 *
 * The legacy aggregate hooks (`useRealtimeEvents`, `useVehicleLive`)
 * share the singleton `sseManager`, including this typed channel. A custom
 * endpoint remains available for isolated tests and uses a dedicated
 * EventSource only for that explicit override.
 */

import { useEffect, useRef } from 'react'
import type { SignalChangeEvent } from '@/api/types'
import { normalizeSignalKind } from '@/api/hooks/useSignals'
import { sseManager } from '@/lib/sseManager'

export interface UseSignalChangeStreamOptions {
  /** Disable the subscription (e.g., behind a feature flag). Defaults to true. */
  enabled?: boolean
  /**
   * Optional vehicle filter. When set, the handler is only called for
   * events whose `vehicle_id` matches. Server-side filtering is not yet
   * implemented; this is purely a client-side narrow.
   */
  vehicleId?: number
  /**
   * Override the SSE endpoint. Defaults to `/api/v1/events`. Exposed
   * primarily for tests that swap in a mock URL.
   */
  endpoint?: string
}

interface RawSignalChangePayload {
  stream_id?: string
  sequence?: number
  vehicle_id?: number
  field?: string
  kind?: unknown
  value?: unknown
  ts?: string
}

/**
 * Coerces the on-wire JSON into a typed `SignalChangeEvent`. The on-wire
 * `kind` may be either the long-form `protomodel.ValueKind.String()`
 * (e.g. "ValueKindFloat") or the integer enum value (`5`); both are
 * normalized into the compact `SignalKind` union.
 */
export function parseSignalChangeEvent(raw: unknown): SignalChangeEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const payload = raw as RawSignalChangePayload
  if (typeof payload.field !== 'string' || payload.field.length === 0) return null
  if (typeof payload.vehicle_id !== 'number') return null

  const kind = normalizeSignalKind(payload.kind)
  const value = coerceValue(payload.value, kind)
  return {
    stream_id: typeof payload.stream_id === 'string' ? payload.stream_id : '',
    sequence: typeof payload.sequence === 'number' && Number.isSafeInteger(payload.sequence)
      ? payload.sequence
      : 0,
    vehicle_id: payload.vehicle_id,
    field: payload.field,
    kind,
    value,
    ts: payload.ts ?? '',
  }
}

function coerceValue(value: unknown, kind: SignalChangeEvent['kind']): SignalChangeEvent['value'] {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'string':
    case 'time':
      return typeof value === 'string' ? value : String(value)
    case 'bool':
      return typeof value === 'boolean' ? value : Boolean(value)
    case 'int':
    case 'float':
      if (typeof value === 'number') return Number.isFinite(value) ? value : null
      if (typeof value === 'string') {
        const n = Number(value)
        return Number.isFinite(n) ? n : null
      }
      return null
    default:
      // A non-finite number (NaN / ±Infinity) is never a valid signal value —
      // it would poison downstream charts/formatters — so drop it to null,
      // matching how the numeric/string branches above reject it.
      if (typeof value === 'number') return Number.isFinite(value) ? value : null
      if (typeof value === 'string' || typeof value === 'boolean') {
        return value
      }
      return null
  }
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
  const { enabled = true, vehicleId, endpoint = '/api/v1/events' } = options
  const handlerRef = useRef(onSignalChange)
  handlerRef.current = onSignalChange

  useEffect(() => {
    if (!enabled) return

    const dispatch = (raw: unknown) => {
      const event = parseSignalChangeEvent(raw)
      if (!event) return
      if (vehicleId != null && event.vehicle_id !== vehicleId) return
      handlerRef.current(event)
    }

    if (endpoint === '/api/v1/events') {
      sseManager.subscribe('signal_change', dispatch)
      return () => {
        sseManager.unsubscribe('signal_change', dispatch)
      }
    }

    const source = new EventSource(endpoint)
    const onMessage = (ev: MessageEvent<string>) => {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(ev.data)
      } catch {
        return
      }
      dispatch(parsed)
    }
    source.addEventListener('signal_change', onMessage as EventListener)

    return () => {
      source.removeEventListener('signal_change', onMessage as EventListener)
      source.close()
    }
  }, [enabled, endpoint, vehicleId])
}
