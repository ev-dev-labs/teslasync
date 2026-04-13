import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { ChargingSession } from '@/types/charging';
import type { ChargingSession as ApiChargingSession, ChargeTelemetryReading } from '../types';

/** Fetches paginated charging sessions for a vehicle, optionally filtered by date range. */
export const getChargingSessions = (vehicleId: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit), offset: String(offset) })
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<ApiChargingSession[]>(`/charging?${params}`)
}

export const chargingKeys = {
  all: ['charging-sessions'] as const,
  detail: (id: string) => ['charging-sessions', id] as const,
  detailById: (id: number) => ['charging-session', id] as const,
  telemetry: (id: number) => ['charge-telemetry', id] as const,
  byVehicle: (vehicleId: string) => ['charging-sessions', 'vehicle', vehicleId] as const,
};

export function useChargingSessions(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? chargingKeys.byVehicle(vehicleId) : chargingKeys.all,
    queryFn: () => request<ChargingSession[]>(
      vehicleId ? `/charging-sessions?vehicleId=${vehicleId}` : '/charging-sessions',
    ),
  });
}

export function useChargingSession(id: string) {
  return useQuery({
    queryKey: chargingKeys.detail(id),
    queryFn: () => request<ChargingSession>(`/charging-sessions/${id}`),
    enabled: !!id,
  });
}

/** Fetches a single charging session by numeric ID with full API detail fields. */
export function useChargingSessionDetail(id: number | null) {
  return useQuery({
    queryKey: chargingKeys.detailById(id!),
    queryFn: () => request<ApiChargingSession>(`/charging/${id}`),
    enabled: id != null,
  });
}

/** Fetches detailed telemetry readings for a charging session. */
export function useChargeTelemetry(sessionId: number | null) {
  return useQuery({
    queryKey: chargingKeys.telemetry(sessionId!),
    queryFn: () => request<ChargeTelemetryReading[]>(`/charging/${sessionId}/telemetry`),
    enabled: sessionId != null,
  });
}

/**
 * Hook wrapping getChargingSessions with pagination and date range filtering.
 * Returns the full API ChargingSession type with all charger detail fields.
 */
export function useChargingSessionsPaginated(
  vehicleId: number | null,
  options: { limit?: number; offset?: number; start?: string; end?: string } = {},
) {
  const { limit = 50, offset = 0, start, end } = options;
  return useQuery({
    queryKey: ['charging', vehicleId, start, end, limit, offset] as const,
    queryFn: () => getChargingSessions(vehicleId!, limit, offset, start, end),
    enabled: vehicleId !== null,
  });
}
