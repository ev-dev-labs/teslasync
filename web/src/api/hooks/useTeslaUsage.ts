import { useQuery } from '@tanstack/react-query'
import { request } from '@/api/client'
import type { APIUsage, TeslaUsageCycle, TeslaUsagePoint, TeslaUsageSeries } from '@/api/types'

export class TeslaUsageContractError extends Error {
  constructor() {
    super('Tesla usage response is incompatible with this app version')
  }
}

function hasAmounts(value: Record<string, unknown>): boolean {
  return ['signals', 'commands', 'data_requests', 'wakes', 'estimated_usd']
    .every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
}

function isCycle(value: unknown): value is TeslaUsageCycle {
  if (value === null || typeof value !== 'object') return false
  const cycle = value as Record<string, unknown>
  return typeof cycle.start === 'string' && typeof cycle.end === 'string' && hasAmounts(cycle)
}

function isPoint(value: unknown): value is TeslaUsagePoint {
  if (value === null || typeof value !== 'object') return false
  const point = value as Record<string, unknown>
  return typeof point.bucket_start === 'string' && hasAmounts(point)
}

function isUsage(value: unknown): value is APIUsage {
  if (value === null || typeof value !== 'object') return false
  const usage = value as Record<string, unknown>
  return isCycle(usage.current) && Array.isArray(usage.history)
    && usage.history.every(isCycle)
    && typeof usage.rate_source === 'string'
    && typeof usage.disclaimer === 'string'
}

function isSeries(value: unknown): value is TeslaUsageSeries {
  if (value === null || typeof value !== 'object') return false
  const series = value as Record<string, unknown>
  return typeof series.start === 'string' && typeof series.end === 'string'
    && (series.bucket === 'day' || series.bucket === 'week')
    && isCycle(series.total) && Array.isArray(series.points)
    && series.points.every(isPoint)
}

export function useTeslaUsage() {
  return useQuery({
    queryKey: ['system-status', 'api-usage'],
    queryFn: async ({ signal }) => {
      const response = await request<unknown>('/system/api-usage?limit=12&offset=0', { signal })
      if (!isUsage(response)) throw new TeslaUsageContractError()
      return response
    },
    retry: (failures, error) => !(error instanceof TeslaUsageContractError) && failures < 3,
    refetchInterval: 5 * 60_000,
  })
}

export function useTeslaUsageHistory(start: string, end: string, bucket: 'day' | 'week', enabled = true) {
  return useQuery({
    queryKey: ['system-status', 'tesla-usage-history', start, end, bucket],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ start, end, bucket })
      const response = await request<unknown>(`/system/api-usage/history?${params.toString()}`, { signal })
      if (!isSeries(response)) throw new TeslaUsageContractError()
      return response
    },
    retry: (failures, error) => !(error instanceof TeslaUsageContractError) && failures < 3,
    enabled: enabled && !!start && !!end,
    refetchInterval: 5 * 60_000,
  })
}
