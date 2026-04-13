import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { Trip } from '@/types/trip';

export const tripKeys = {
  all: ['trips'] as const,
  detail: (id: string) => ['trips', id] as const,
};

export function useTrips(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? [...tripKeys.all, vehicleId] : tripKeys.all,
    queryFn: () => request<Trip[]>(vehicleId ? `/trips?vehicle_id=${vehicleId}` : '/trips'),
    enabled: !!vehicleId,
  });
}

export function useTrip(id: string) {
  return useQuery({
    queryKey: tripKeys.detail(id),
    queryFn: () => request<Trip>(`/trips/${id}`),
    enabled: !!id,
  });
}
