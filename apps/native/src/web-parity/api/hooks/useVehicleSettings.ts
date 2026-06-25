import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import {ApiError, request} from '../client';
import {useMutationToast} from './_toastHelpers';
import {vehicleKeys} from './useVehicles';

export type EffectiveSettingSource = 'override' | 'user' | 'vehicle' | 'default';

export interface EffectiveSetting {
  key: string;
  value: unknown;
  source: EffectiveSettingSource;
}

export interface VehicleSettingsResponse {
  settings: EffectiveSetting[];
}

export type VehicleSettingValue = string | number | boolean;

export const nativeVehicleSettingsHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: {queryKey: QueryKey},
): void {
  void qc.invalidateQueries(filters);
}

/** Stable React-Query key namespace for per-vehicle settings. */
export const vehicleSettingsKeys = {
  all: ['vehicle-settings'] as const,
  detail: (vehicleId: number) => ['vehicle-settings', vehicleId] as const,
};

/** GET /api/v1/vehicles/{vehicleID}/settings */
export function useVehicleSettings(
  vehicleId: number,
  options?: {enabled?: boolean},
) {
  return useQuery<VehicleSettingsResponse, ApiError>({
    queryKey: vehicleSettingsKeys.detail(vehicleId),
    queryFn: ({signal}) =>
      request<VehicleSettingsResponse>(`/vehicles/${vehicleId}/settings`, {
        signal,
      }),
    enabled: (options?.enabled ?? true) && Number.isFinite(vehicleId) && vehicleId > 0,
    staleTime: 30_000,
  });
}

/**
 * PUT /api/v1/vehicles/{vehicleID}/settings/{key} with { value }.
 *
 * The caller passes the typed JS value (string | number | boolean); the mutation
 * forwards it verbatim. For mute_until the caller must pre-format an RFC3339
 * string before invoking the mutation.
 */
export function useUpsertVehicleSetting(vehicleId: number) {
  const qc = useQueryClient();
  const toast = useMutationToast();
  return useMutation<void, ApiError, {key: string; value: VehicleSettingValue}>({
    mutationFn: ({key, value}) =>
      request<void>(`/vehicles/${vehicleId}/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({value}),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: vehicleSettingsKeys.detail(vehicleId)});
      invalidateAndBroadcast(qc, {queryKey: vehicleKeys.detail(String(vehicleId))});
      toast.success('vehicleSettings.toasts.saved', 'Setting saved.');
    },
    onError: err =>
      toast.error(err, 'vehicleSettings.errors.save', 'Failed to save setting'),
  });
}

/**
 * DELETE /api/v1/vehicles/{vehicleID}/settings/{key}.
 *
 * Idempotent - the backend returns 204 even when no override row existed.
 */
export function useResetVehicleSetting(vehicleId: number) {
  const qc = useQueryClient();
  const toast = useMutationToast();
  return useMutation<void, ApiError, string>({
    mutationFn: (key: string) =>
      request<void>(`/vehicles/${vehicleId}/settings/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, {queryKey: vehicleSettingsKeys.detail(vehicleId)});
      invalidateAndBroadcast(qc, {queryKey: vehicleKeys.detail(String(vehicleId))});
      toast.success('vehicleSettings.toasts.reset', 'Reverted to default.');
    },
    onError: err =>
      toast.error(err, 'vehicleSettings.errors.reset', 'Failed to reset setting'),
  });
}

/**
 * Convenience selector: pull a single key's effective value from the resolver
 * payload. Returns the entire row so callers can also inspect `source`.
 */
export function findEffectiveSetting(
  payload: VehicleSettingsResponse | undefined,
  key: string,
): EffectiveSetting | undefined {
  return payload?.settings?.find(s => s.key === key);
}
