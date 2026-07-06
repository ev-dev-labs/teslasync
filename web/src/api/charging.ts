import { request } from './client'
import type { ChargingSession, ChargeTelemetryReading } from './types'

/**
 * Optional per-call request controls.
 *
 * Pass TanStack Query's `queryFn` `{ signal }` here so a route change or
 * component unmount aborts the in-flight request instead of resolving into
 * unmounted state (and burning Tesla API quota). Mirrors the cancellation
 * contract documented on `api/client` request() and the sibling fetchers in
 * `api/hooks/useCharging.ts`.
 */
interface ChargingFetchOptions {
  signal?: AbortSignal | null
}

// === Charging ===
/** Fetches paginated charging sessions for a vehicle, optionally filtered by date range. */
export const getChargingSessions = (
  vehicleId: number,
  limit = 50,
  offset = 0,
  start?: string,
  end?: string,
  opts?: ChargingFetchOptions,
) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ChargingSession[]>(`/charging?${params}`, { signal: opts?.signal })
}
/** Fetches a single charging session by ID. */
export const getChargingSession = (id: number, opts?: ChargingFetchOptions) =>
  request<ChargingSession>(`/charging/${id}`, { signal: opts?.signal })
/** Fetches detailed telemetry readings for a charging session. */
export const getChargeTelemetry = (sessionId: number, opts?: ChargingFetchOptions) =>
  request<ChargeTelemetryReading[]>(`/charging/${sessionId}/telemetry`, { signal: opts?.signal })
