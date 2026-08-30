import { useMutation, useQueryClient } from '@tanstack/react-query';

import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { vehicleKeys } from './useVehicles';

export const MAX_BULK_WAKE_VEHICLES = 10;

export interface FleetWakeProgress {
  completed: number;
  total: number;
  succeeded: number;
  failed: number;
}

export interface FleetWakeRequest {
  vehicleIds: readonly number[];
  onProgress?: (progress: FleetWakeProgress) => void;
}

export interface FleetWakeFailure {
  vehicleId: number;
  message: string;
}

export interface FleetWakeResult {
  requested: number;
  submitted: number;
  omitted: number;
  succeeded: number[];
  failed: FleetWakeFailure[];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Wake request failed';
}

/**
 * Send a bounded, sequential fleet wake batch.
 *
 * The endpoint is rate-limited and waking a vehicle consumes standby energy,
 * so this hook deliberately caps each operator-confirmed batch and avoids a
 * burst of concurrent commands. Every item is reported as success or failure.
 */
export function useWakeVehiclesBulk() {
  const queryClient = useQueryClient();
  const toast = useMutationToast();

  return useMutation<FleetWakeResult, Error, FleetWakeRequest>({
    mutationFn: async ({ vehicleIds, onProgress }) => {
      const uniqueIds = [...new Set(vehicleIds)].filter(
        (vehicleId) => Number.isInteger(vehicleId) && vehicleId > 0,
      );
      if (uniqueIds.length === 0) {
        throw new Error('At least one valid vehicle is required');
      }

      const selectedIds = uniqueIds.slice(0, MAX_BULK_WAKE_VEHICLES);
      const succeeded: number[] = [];
      const failed: FleetWakeFailure[] = [];

      for (const vehicleId of selectedIds) {
        try {
          await request<{ status: string }>(`/vehicles/${vehicleId}/wake`, {
            method: 'POST',
            requiresLiveMode: true,
          });
          succeeded.push(vehicleId);
        } catch (error) {
          failed.push({ vehicleId, message: errorMessage(error) });
        }
        onProgress?.({
          completed: succeeded.length + failed.length,
          total: selectedIds.length,
          succeeded: succeeded.length,
          failed: failed.length,
        });
      }

      return {
        requested: uniqueIds.length,
        submitted: selectedIds.length,
        omitted: uniqueIds.length - selectedIds.length,
        succeeded,
        failed,
      };
    },
    networkMode: 'always',
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-states'] });
      result.succeeded.forEach((vehicleId) => {
        void queryClient.invalidateQueries({
          queryKey: vehicleKeys.state(vehicleId),
        });
      });

      if (result.failed.length > 0 || result.omitted > 0) {
        toast.warning(
          'toast.fleetWake.partial',
          '{{succeeded}} wake command(s) sent; {{failed}} failed; {{omitted}} deferred.',
          {
            succeeded: result.succeeded.length,
            failed: result.failed.length,
            omitted: result.omitted,
          },
        );
        return;
      }
      toast.success(
        'toast.fleetWake.success',
        'Wake commands sent to {{count}} vehicle(s).',
        { count: result.succeeded.length },
      );
    },
    onError: (error) => {
      toast.error(
        error,
        'toast.fleetWake.error',
        'Wake commands could not be started',
      );
    },
  });
}
