import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type { Location, Geofence } from '@/types/location';

export const locationKeys = {
  all: (vehicleId?: string) => ['locations', vehicleId ?? 'all'] as const,
  geofences: ['geofences'] as const,
};

export function useLocations(vehicleId?: string) {
  return useQuery({
    queryKey: locationKeys.all(vehicleId),
    queryFn: ({ signal }) => request<Location[]>(
      vehicleId ? `/locations?vehicle_id=${vehicleId}` : '/locations', { signal },
    ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useGeofences() {
  return useQuery({
    queryKey: locationKeys.geofences,
    queryFn: ({ signal }) => request<Geofence[]>('/geofences', { signal }),
    select: safeArray,
  });
}

export interface GeofenceBulkResult {
  deleted: number;
  failed: { id: number; reason: string }[];
}

/**
 * useBulkGeofencesDelete — POST /geofences/bulk
 * Phase-45 / Prompt 32. Deletes a batch of geofences (op=delete is the
 * only allowlisted op today) and refreshes the geofences list cache.
 */
export function useBulkGeofencesDelete() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<GeofenceBulkResult>('/geofences/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, op: 'delete' }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: locationKeys.geofences });
      success('toast.geofence.bulkDelete.success', 'Geofences deleted');
    },
    onError: (err) =>
      error(err, 'toast.geofence.bulkDelete.error', 'Failed to delete geofences'),
  });
}
