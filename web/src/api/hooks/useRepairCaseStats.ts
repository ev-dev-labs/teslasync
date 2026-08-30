import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { request } from '../client';

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

/** Lightweight durable-case summary suitable for app chrome and workspaces. */
export function useRepairCaseStats(vehicleId?: number) {
  const query = vehicleId != null ? `?vehicle_id=${vehicleId}` : '';
  return useQuery({
    queryKey: repairCaseStatsKey(vehicleId),
    queryFn: ({ signal }) =>
      request<RepairCaseStats>(`/data-repair/cases/stats${query}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
