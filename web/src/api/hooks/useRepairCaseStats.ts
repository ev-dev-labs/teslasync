import { request } from '../client';
import { useRepairScopedQuery } from './useDataRepair';

export interface RepairCaseStats {
  total: number;
  open: number;
  in_review: number;
  applied: number;
  dismissed: number;
  quarantined: number;
  restored: number;
  resolved: number;
  drive: number;
  charging: number;
  oldest_open_at?: string | null;
  last_scan_at?: string | null;
}

export const repairCaseStatsKey = (vehicleId?: number) =>
  ['data-repair', 'cases', 'stats', vehicleId ?? 'fleet'] as const;

const statsScope = (vehicleId: unknown) =>
  `/data-repair/cases/stats${vehicleId === 'fleet' || vehicleId == null ? '' : `?vehicle_id=${vehicleId}`}`;

/** Lightweight durable-case summary suitable for app chrome and workspaces. */
export function useRepairCaseStats(vehicleId?: number) {
  const query = vehicleId != null ? `?vehicle_id=${vehicleId}` : '';
  return useRepairScopedQuery(
    repairCaseStatsKey(vehicleId),
    ({ signal }) =>
      request<RepairCaseStats>(`/data-repair/cases/stats${query}`, { signal }),
    statsScope(vehicleId),
    (key) => statsScope(key[3]),
  );
}
