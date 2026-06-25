import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

export const nativeLocationsHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

function invalidateAndBroadcast(
  queryClient: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void queryClient.invalidateQueries(filters);
}

interface Location {
  id: string;
  addressName: string;
  latitude: number;
  longitude: number;
  visitCount: number;
  totalDurationS: number;
  lastVisited: string | null;
}

interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  alertOnEntry: boolean;
  alertOnExit: boolean;
  enabled: boolean;
  costPerKwh: number | null;
  createdAt: string;
}

export const locationKeys = {
  all: (vehicleId?: string) => ['locations', vehicleId ?? 'all'] as const,
  geofences: ['geofences'] as const,
};

/**
 * useLocations — GET /locations[?vehicle_id=...]
 *
 * @deprecated The hook return type points at the legacy camelCase
 * `Location` interface (`addressName`, `visitCount`, `lastVisited`, etc).
 * The new backend wire shape is the snake_case `VisitedLocation`. The two are
 * reconciled at runtime by `camelCaseKeys` in the native parity request client
 * which retains BOTH casings on the response object, so consumers reading
 * either form work today. This hook keeps the legacy shape inline because the
 * native parity layer does not expose the web `@/types/location` alias.
 */
export function useLocations(vehicleId?: string) {
  return useQuery({
    queryKey: locationKeys.all(vehicleId),
    queryFn: ({signal}) =>
      request<Location[]>(
        vehicleId ? `/locations?vehicle_id=${vehicleId}` : '/locations',
        {signal},
      ),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

/**
 * useGeofences — GET /geofences
 *
 * @deprecated The legacy `Geofence` type declares `enabled`, `alertOnEntry`,
 * `alertOnExit`, `costPerKwh` — none of which the post-migration backend
 * `models.Geofence` (internal/models/system.go) persists or emits. Backend
 * MarshalJSON augments the response with `latitude`, `longitude`, `radius`
 * (centroid + max-vertex meters) only. Pages reading the missing fields render
 * fall-through defaults (Inactive / None / blank) — pre-existing UI/contract
 * drift. Reconciliation requires a backend migration to add the missing columns
 * plus a coordinated update to internal/models/system.go,
 * internal/api/geofence_handler.go, and the frontend type+pages.
 */
export function useGeofences() {
  return useQuery({
    queryKey: locationKeys.geofences,
    queryFn: ({signal}) => request<Geofence[]>('/geofences', {signal}),
    select: safeArray,
  });
}

export interface GeofenceBulkResult {
  deleted: number;
  failed: {id: number; reason: string}[];
}

/**
 * useBulkGeofencesDelete — POST /geofences/bulk
 * Deletes a batch of geofences (op=delete is the only allowlisted op today)
 * and refreshes the geofences list cache.
 */
export function useBulkGeofencesDelete() {
  const queryClient = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (ids: number[]) =>
      request<GeofenceBulkResult>('/geofences/bulk', {
        method: 'POST',
        body: JSON.stringify({ids, op: 'delete'}),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(queryClient, {queryKey: locationKeys.geofences});
      success('toast.geofence.bulkDelete.success', 'Geofences deleted');
    },
    onError: err =>
      error(err, 'toast.geofence.bulkDelete.error', 'Failed to delete geofences'),
  });
}
