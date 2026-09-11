import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from '@/hooks/useMutationToast';
import { invalidateAndBroadcast } from '@/lib/querySync';

/**
 * Cabin Comfort: calendar-aware preconditioning per vehicle. Reads the
 * backend routes registered in internal/api/router.go:
 *
 *   GET  /comfort/next?vehicle_id=
 *   PUT  /comfort/config
 *   POST /comfort/now
 *   GET  /comfort/runs?vehicle_id=&limit=
 *
 * `request()` prepends the version prefix automatically, so the paths below
 * must NOT include it. All field names are snake_case to mirror the Go JSON
 * tags.
 */

export interface ComfortConfig {
  vehicle_id: number;
  enabled: boolean;
  target_temp_c: number;
  lead_minutes: number;
  ics_url: string;
  updated_at: string;
}

export interface ComfortEvent {
  uid: string;
  title: string;
  location: string;
  starts_at: string;
  all_day: boolean;
}

export interface ComfortNext {
  config: ComfortConfig;
  event?: ComfortEvent;
}

export interface ComfortRun {
  id: number;
  vehicle_id: number;
  event_uid: string;
  event_title: string;
  starts_at: string;
  acted_at: string;
}

export interface ComfortConfigRequest {
  vehicle_id: number;
  enabled: boolean;
  target_temp_c: number;
  lead_minutes: number;
  ics_url: string;
}

export const comfortKeys = {
  all: ['comfort'] as const,
  next: (vehicleId: number) => ['comfort', 'next', vehicleId] as const,
  runs: (vehicleId: number) => ['comfort', 'runs', vehicleId] as const,
};

/** Stored config plus the next offsite event inside the lead window. */
export function useComfortNext(vehicleId?: number | null) {
  return useQuery({
    queryKey: comfortKeys.next(vehicleId!),
    queryFn: ({ signal }) =>
      request<ComfortNext>(`/comfort/next?vehicle_id=${vehicleId}`, { signal }),
    enabled: vehicleId != null,
    staleTime: STALE_TIMES.FAST,
  });
}

/** Recent preconditioning runs, newest first. */
export function useComfortRuns(vehicleId?: number | null) {
  return useQuery({
    queryKey: comfortKeys.runs(vehicleId!),
    queryFn: ({ signal }) =>
      request<ComfortRun[]>(`/comfort/runs?vehicle_id=${vehicleId}&limit=10`, { signal }),
    enabled: vehicleId != null,
    staleTime: STALE_TIMES.FAST,
    select: safeArray,
  });
}

/** Saves the comfort config (arm + target temp + lead + ICS url). */
export function useSaveComfortConfig() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: ComfortConfigRequest) =>
      request<ComfortConfig>('/comfort/config', {
        method: 'PUT',
        body: JSON.stringify(params),
      }),
    onSuccess: (cfg) => {
      invalidateAndBroadcast(qc, { queryKey: comfortKeys.next(cfg.vehicle_id) });
      success('toast.comfort.save.success', 'Comfort autopilot saved');
    },
    onError: (err) => error(err, 'toast.comfort.save.error', 'Failed to save comfort autopilot'),
  });
}

/** One-tap precondition now at the configured target. Issues a live Tesla
 * command, so it requires live mode like other actuation mutations. */
export function usePreconditionNow() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (vehicleId: number) =>
      request<{ status: string; target_temp_c: number }>('/comfort/now', {
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify({ vehicle_id: vehicleId }),
      }),
    onSuccess: (res, vehicleId) => {
      invalidateAndBroadcast(qc, { queryKey: comfortKeys.runs(vehicleId) });
      success('toast.comfort.now.success', `Preconditioning to ${res.target_temp_c}°C`);
    },
    onError: (err) => error(err, 'toast.comfort.now.error', 'Failed to start preconditioning'),
  });
}
