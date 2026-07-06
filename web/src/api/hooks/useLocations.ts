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

/**
 * useLocations — GET /locations[?vehicle_id=...]
 *
 * @deprecated The hook return type points at the legacy camelCase
 * `Location` interface in `@/types/location` (`addressName`, `visitCount`,
 * `lastVisited`, etc). The new backend wire shape is the snake_case
 * `VisitedLocation` in `@/api/types.ts`. The two are reconciled at
 * runtime by `camelCaseKeys` in `@/lib/resilience` which retains BOTH
 * casings on the response object, so consumers reading either form work
 * today. This hook keeps the legacy type import to preserve TS-compile
 * across out-of-scope
 * consumers (LocationFavoritesWidget). A future audit prompt can
 * unify the two type modules in lockstep with all consumers.
 */
export function useLocations(vehicleId?: string) {
  return useQuery({
    queryKey: locationKeys.all(vehicleId),
    queryFn: ({ signal }) => request<Location[]>(
      vehicleId ? `/locations?vehicle_id=${encodeURIComponent(vehicleId)}` : '/locations', { signal },
    ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

/**
 * useGeofences — GET /geofences
 *
 * @deprecated The legacy `Geofence` type in `@/types/location` declares
 * `enabled`, `alertOnEntry`, `alertOnExit`, `costPerKwh` — none of which
 * the post-migration backend `models.Geofence` (internal/models/system.go)
 * persists or emits. Backend MarshalJSON augments the response with
 * `latitude`, `longitude`, `radius` (centroid + max-vertex meters) only.
 * Pages reading the missing fields render fall-through defaults
 * (Inactive / None / blank) — pre-existing UI/contract drift.
 * Reconciliation requires a backend migration to add the missing columns
 * plus a coordinated update to internal/models/system.go,
 * internal/api/geofence_handler.go, and the frontend type+pages.
 */
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
 * Deletes a batch of geofences (op=delete is the only allowlisted op
 * today) and refreshes the geofences list cache.
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
