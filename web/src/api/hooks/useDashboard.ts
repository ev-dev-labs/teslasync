import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';
import type { DashboardStats } from '@/types/dashboard';

export const dashboardKeys = {
  stats: ['dashboard', 'stats'] as const,
};

export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: ({ signal }) => request<DashboardStats>('/dashboard/stats', { signal }),
    staleTime: STALE_TIMES.STANDARD,
  });
}
