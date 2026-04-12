import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { ChargingSession } from '@/types/charging';

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
