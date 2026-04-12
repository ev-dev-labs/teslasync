import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { Location, Geofence } from '@/types/location';

export const locationKeys = {
  all: (vehicleId?: string) => ['locations', vehicleId ?? 'all'] as const,
  geofences: ['geofences'] as const,
};

export function useLocations(vehicleId?: string) {
  return useQuery({
    queryKey: locationKeys.all(vehicleId),
    queryFn: () => request<Location[]>(
      vehicleId ? `/locations?vehicleId=${vehicleId}` : '/locations',
    ),
  });
}

export function useGeofences() {
  return useQuery({
    queryKey: locationKeys.geofences,
    queryFn: () => request<Geofence[]>('/geofences'),
  });
}
