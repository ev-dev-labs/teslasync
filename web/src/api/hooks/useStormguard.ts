import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from '@/hooks/useMutationToast';
import { invalidateAndBroadcast } from '@/lib/querySync';

/**
 * Storm Guardian: severe-weather auto-prep per vehicle. Reads the backend
 * routes registered in internal/api/router.go:
 *
 *   GET /stormguard/status?vehicle_id=
 *   PUT /stormguard/config
 *   GET /stormguard/events?vehicle_id=&limit=
 *
 * `request()` prepends the version prefix automatically, so the paths below
 * must NOT include it. All field names are snake_case to mirror the Go JSON
 * tags.
 */

export type StormLevel = 'none' | 'watch' | 'warning';

export interface StormguardConfig {
  vehicle_id: number;
  enabled: boolean;
  lat: number;
  lng: number;
  target_soc: number;
  updated_at: string;
}

export interface StormAssessment {
  level: StormLevel;
  reason: string;
  starts_at: string | null;
  peak_gust_ms: number;
}

export interface StormguardStatus {
  config: StormguardConfig;
  assessment: StormAssessment;
  current_soc?: number;
}

export interface StormguardEvent {
  id: number;
  vehicle_id: number;
  level: StormLevel;
  reason: string;
  acted: boolean;
  created_at: string;
}

export interface StormguardConfigRequest {
  vehicle_id: number;
  enabled: boolean;
  lat: number;
  lng: number;
  target_soc: number;
}

export const stormguardKeys = {
  all: ['stormguard'] as const,
  status: (vehicleId: number) => ['stormguard', 'status', vehicleId] as const,
  events: (vehicleId: number) => ['stormguard', 'events', vehicleId] as const,
};

/** Live storm assessment for the stored home coordinates. */
export function useStormguardStatus(vehicleId?: number | null) {
  return useQuery({
    queryKey: stormguardKeys.status(vehicleId!),
    queryFn: ({ signal }) =>
      request<StormguardStatus>(`/stormguard/status?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId != null,
    staleTime: STALE_TIMES.FAST,
  });
}

/** Recent assessment/action log, newest first. */
export function useStormguardEvents(vehicleId?: number | null) {
  return useQuery({
    queryKey: stormguardKeys.events(vehicleId!),
    queryFn: ({ signal }) =>
      request<StormguardEvent[]>(`/stormguard/events?vehicle_id=${vehicleId}&limit=10`, { signal }),
    enabled: vehicleId != null,
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}

/** Arms/disarms the guard and stores home coords + pre-storm target. */
export function useSaveStormguardConfig() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: StormguardConfigRequest) =>
      request<StormguardConfig>('/stormguard/config', {
        method: 'PUT',
        body: JSON.stringify(params),
      }),
    onSuccess: (cfg) => {
      invalidateAndBroadcast(qc, { queryKey: stormguardKeys.status(cfg.vehicle_id) });
      invalidateAndBroadcast(qc, { queryKey: stormguardKeys.events(cfg.vehicle_id) });
      success('toast.stormguard.save.success', 'Storm guard saved');
    },
    onError: (err) => error(err, 'toast.stormguard.save.error', 'Failed to save storm guard'),
  });
}
