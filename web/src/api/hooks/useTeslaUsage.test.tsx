import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TeslaUsageContractError, useTeslaUsage, useTeslaUsageHistory } from './useTeslaUsage'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', () => ({ request: requestMock }))

describe('useTeslaUsage', () => {
  it('rejects the legacy usage response instead of displaying it as a current cycle', async () => {
    requestMock.mockReset().mockResolvedValue({
      total_requests: 20, estimated_cost: 0.2, monthly_credit: 10,
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result, unmount } = renderHook(() => useTeslaUsage(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(TeslaUsageContractError)
    expect(result.current.data).toBeUndefined()
    expect(requestMock).toHaveBeenCalledTimes(1)
    unmount()
    client.clear()
  })
  it('queries the existing system route without a second /api/v1 prefix', async () => {
    requestMock.mockReset()
    requestMock.mockResolvedValueOnce({
      current: { start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z',
        signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0 },
      history: [], rate_source: 'https://developer.tesla.com/', disclaimer: 'Estimate',
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result, unmount } = renderHook(() => useTeslaUsage(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith('/system/api-usage?limit=12&offset=0', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    unmount()
    client.clear()
  })
  it('requests bounded daily and weekly history without the API prefix and guards empty ranges', async () => {
    requestMock.mockReset().mockImplementation((url: string) => Promise.resolve({
      start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z',
      bucket: url.includes('bucket=week') ? 'week' : 'day',
      total: { start: '2025-01-01T00:00:00Z', end: '2025-02-01T00:00:00Z',
        signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0 },
      points: [],
    }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result, rerender, unmount } = renderHook(
      ({ start, end, bucket, enabled }: { start: string; end: string; bucket: 'day' | 'week'; enabled: boolean }) =>
        useTeslaUsageHistory(start, end, bucket, enabled),
      { initialProps: { start: '', end: '', bucket: 'day' as const, enabled: true }, wrapper },
    )
    expect(requestMock).not.toHaveBeenCalled()
    rerender({ start: '2025-01-01T00:00:00.000Z', end: '2025-02-01T00:00:00.000Z', bucket: 'day', enabled: false })
    expect(requestMock).not.toHaveBeenCalled()
    rerender({ start: '2025-01-01T00:00:00.000Z', end: '2025-02-01T00:00:00.000Z', bucket: 'day', enabled: true })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith(
      '/system/api-usage/history?start=2025-01-01T00%3A00%3A00.000Z&end=2025-02-01T00%3A00%3A00.000Z&bucket=day',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    rerender({ start: '2025-01-01T00:00:00.000Z', end: '2025-02-01T00:00:00.000Z', bucket: 'week', enabled: true })
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2))
    expect(requestMock.mock.calls[1][0]).toContain('bucket=week')
    unmount()
    client.clear()
  })
  it('rejects an incomplete history response instead of showing a fabricated zero estimate', async () => {
    requestMock.mockReset().mockResolvedValue({ points: [], bucket: 'day' })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result, unmount } = renderHook(
      () => useTeslaUsageHistory('2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z', 'day'),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(TeslaUsageContractError)
    unmount()
    client.clear()
  })
})
