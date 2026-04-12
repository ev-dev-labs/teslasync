import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { ChargingSession } from '@/types/charging';
import type { ChargingSession as ApiChargingSession } from '../types';

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
