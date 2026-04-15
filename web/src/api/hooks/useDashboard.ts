import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { DashboardStats } from '@/types/dashboard';

export const dashboardKeys = {
  stats: ['dashboard', 'stats'] as const,
};

export function useDashboardStats() {
  return useQuery({
    queryKey: dashboardKeys.stats,
    queryFn: () => request<DashboardStats>('/dashboard/stats'),
    staleTime: 60_000,
  });
}
