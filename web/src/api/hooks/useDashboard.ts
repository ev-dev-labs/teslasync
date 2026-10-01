import { useMutation, useQuery } from '@tanstack/react-query';
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

export interface DashboardWidgetDraft {
  title: string;
  widget_ids: string[];
}

export function useDraftDashboardWidgets() {
  return useMutation({
    mutationFn: (input: { prompt: string; widgets: Array<{ id: string; name: string; description: string }> }) =>
      request<DashboardWidgetDraft>('/ai/dashboard/widgets/draft', {
        method: 'POST',
        body: JSON.stringify(input),
        requiresLiveMode: true,
      }),
  });
}
