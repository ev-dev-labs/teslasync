import { request } from './client'
import type { ChargingSession, ChargeTelemetryReading } from './types'

// === Charging ===
/** Fetches paginated charging sessions for a vehicle, optionally filtered by date range. */
export const getChargingSessions = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ChargingSession[]>(`/charging?${params}`)
}
/** Fetches a single charging session by ID. */
export const getChargingSession = (id: number) => request<ChargingSession>(`/charging/${id}`)
/** Fetches detailed telemetry readings for a charging session. */
export const getChargeTelemetry = (sessionId: number) =>
  request<ChargeTelemetryReading[]>(`/charging/${sessionId}/telemetry`)
