import { useQuery } from '@tanstack/react-query';

import { request } from '../client';

const STALE_TIMES = {
  STANDARD: 60_000,
} as const;

export interface DashboardStats {
  totalVehicles: number;
  totalM: number;
  totalEnergyWh: number;
  totalChargingSessions: number;
  totalTrips: number;
  avgEfficiency: number;
  totalCostCents: number;
}

export const dashboardKeys = {
  stats: ['dashboard', 'stats'] as const,
};

export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: ({ signal }) =>
      request<DashboardStats>('/dashboard/stats', { signal }),
    staleTime: STALE_TIMES.STANDARD,
  });
}
