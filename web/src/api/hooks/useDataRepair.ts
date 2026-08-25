import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';

/**
 * Data-repair hooks — the ONE data layer for the /system/data-repair page.
 *
 * Field naming follows the SI-canonical backend contract exactly:
 *   - GET  /data-repair/stale-sessions          → { stale_charging, stale_drives }
 *   - PUT  /data-repair/charging/{id}   (sudo)   → PartialUpdate (ChargingPartialAllowed)
 *   - POST /data-repair/charging/{id}/close      → sets ended_at = now
 *   - DEL  /data-repair/charging/{id}   (sudo)
 *   - PUT  /data-repair/drive/{id}      (sudo)   → PartialUpdate (DrivePartialAllowed)
 *   - POST /data-repair/drive/{id}/close         → sets ended_at + duration_s
 *   - DEL  /data-repair/drive/{id}      (sudo)
 *
 * NOTE the drive routes are SINGULAR (`/drive/`), matching `internal/api/router.go`.
 * The pre-refactor page used `/drives/`, which 404'd every drive mutation.
 *
 * Update payloads MUST be keyed by the SI-canonical column names the repo
 * whitelist accepts (`ended_at`, `end_soc_pct`, `total_energy_added_wh`,
 * `peak_power_w`, `cost_decimal`, `distance_m`, `duration_s`, `max_speed_mps`,
 * …). Any other key is silently dropped by the backend filter.
 */

export const dataRepairKeys = {
  stale: ['data-repair', 'stale-sessions'] as const,
};

/** A charging session that is still open (no `ended_at`) past the stale cutoff. */
export interface StaleChargingSession {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at?: string | null;
  start_soc_pct?: number | null;
  end_soc_pct?: number | null;
  delta_soc_pct?: number | null;
  total_energy_added_wh?: number | null;
  peak_power_w?: number | null;
  avg_power_w?: number | null;
  cost_decimal?: number | null;
  cost_currency?: string | null;
}

/** A drive that is still open (no `end_ts`) past the stale cutoff. */
export interface StaleDrive {
  id: number;
  vehicle_id: number;
  start_ts: string;
  end_ts?: string | null;
  duration_s?: number | null;
  distance_m?: number | null;
  start_battery_pct?: number | null;
  end_battery_pct?: number | null;
  max_speed_mps?: number | null;
  avg_speed_mps?: number | null;
  energy_used_wh?: number | null;
}

export interface StaleSessionsResponse {
  stale_charging: StaleChargingSession[];
  stale_drives: StaleDrive[];
}

/** Partial patch keyed by SI-canonical column names accepted by the repo whitelist. */
export type RepairPatch = Record<string, string | number>;

/**
 * useStaleSessions — GET /data-repair/stale-sessions.
 * Polls every 30s so the worklist reflects sessions that self-close in the
 * background while the operator is triaging.
 */
export function useStaleSessions() {
  return useQuery({
    queryKey: dataRepairKeys.stale,
    queryFn: ({ signal }) =>
      request<StaleSessionsResponse>('/data-repair/stale-sessions', { signal }),
    refetchInterval: 30_000,
  });
}

// ─── Charging mutations ──────────────────────────────────────────────────────

export function useUpdateCharging() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RepairPatch }) =>
      request(`/data-repair/charging/${id}`, {
        method: 'PUT',
        requiresLiveMode: true,
        body: JSON.stringify(patch),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.charging.update.success', 'Charging session updated');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.update.error', 'Failed to update charging session'),
  });
}

export function useCloseCharging() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request(`/data-repair/charging/${id}/close`, {
        method: 'POST',
        requiresLiveMode: true,
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.charging.close.success', 'Charging session closed');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.close.error', 'Failed to close charging session'),
  });
}

export function useDiscardCharging() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request(`/data-repair/charging/${id}`, {
        method: 'DELETE',
        requiresLiveMode: true,
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.charging.discard.success', 'Charging session discarded');
    },
    onError: (e) =>
      error(e, 'toast.dataRepair.charging.discard.error', 'Failed to discard charging session'),
  });
}

// ─── Drive mutations ─────────────────────────────────────────────────────────

export function useUpdateDrive() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: RepairPatch }) =>
      request(`/data-repair/drive/${id}`, {
        method: 'PUT',
        requiresLiveMode: true,
        body: JSON.stringify(patch),
      }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.drive.update.success', 'Drive updated');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.update.error', 'Failed to update drive'),
  });
}

export function useCloseDrive() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request(`/data-repair/drive/${id}/close`, {
      method: 'POST',
      requiresLiveMode: true,
    }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.drive.close.success', 'Drive closed');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.close.error', 'Failed to close drive'),
  });
}

export function useDiscardDrive() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) => request(`/data-repair/drive/${id}`, {
      method: 'DELETE',
      requiresLiveMode: true,
    }),
    networkMode: 'always',
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: dataRepairKeys.stale });
      success('toast.dataRepair.drive.discard.success', 'Drive discarded');
    },
    onError: (e) => error(e, 'toast.dataRepair.drive.discard.error', 'Failed to discard drive'),
  });
}
