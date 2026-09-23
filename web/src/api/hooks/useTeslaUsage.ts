import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'
import type { APIUsage, TeslaUsageSeries } from '@/api/types'

export function useTeslaUsage() {
  return useQuery({
    queryKey: ['system-status', 'api-usage'],
    queryFn: ({ signal }) => request<APIUsage>('/system/api-usage?limit=12&offset=0', { signal }),
    refetchInterval: 5 * 60_000,
  })
}

export function useTeslaUsageHistory(start: string, end: string, bucket: 'day' | 'week', enabled = true) {
  return useQuery({
    queryKey: ['system-status', 'tesla-usage-history', start, end, bucket],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ start, end, bucket })
      return request<TeslaUsageSeries>(`/system/api-usage/history?${params.toString()}`, { signal })
    },
    enabled: enabled && !!start && !!end,
    refetchInterval: 5 * 60_000,
  })
}
