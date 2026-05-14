import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  aiUsageKeys,
  useAiUsageToday,
  useAiUsageByFeature,
  useAiUsageRecent,
  type AiUsageToday,
  type AiUsageByFeatureResponse,
  type AiUsageRecentResponse,
} from '../useAiUsage'

const requestMock = vi.fn()
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('aiUsageKeys', () => {
  it('namespaces all keys under [ai, usage]', () => {
    expect(aiUsageKeys.all).toEqual(['ai', 'usage'])
    expect(aiUsageKeys.today()).toEqual(['ai', 'usage', 'today'])
    expect(aiUsageKeys.byFeature()).toEqual(['ai', 'usage', 'by-feature', ''])
    expect(aiUsageKeys.byFeature('2025-01-01T00:00:00Z')).toEqual([
      'ai',
      'usage',
      'by-feature',
      '2025-01-01T00:00:00Z',
    ])
    expect(aiUsageKeys.recent()).toEqual(['ai', 'usage', 'recent', 0])
    expect(aiUsageKeys.recent(50)).toEqual(['ai', 'usage', 'recent', 50])
  })
})

describe('useAiUsageToday', () => {
  it('hits /ai/usage/today and returns the aggregate payload', async () => {
    const payload: AiUsageToday = {
      user_subject: 'alice',
      call_count: 3,
      input_tokens: 12,
      output_tokens: 34,
      cost_micro_cents: 12_345,
      error_count: 0,
      avg_latency_ms: 87,
    }
    requestMock.mockResolvedValueOnce(payload)
    const { result } = renderHook(() => useAiUsageToday(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith(
      '/ai/usage/today',
      expect.objectContaining({ signal: expect.anything() }),
    )
    expect(result.current.data).toEqual(payload)
  })
})

describe('useAiUsageByFeature', () => {
  it('omits the since query param when no argument is provided', async () => {
    const payload: AiUsageByFeatureResponse = {
      since: '2025-01-01T00:00:00Z',
      rows: [],
    }
    requestMock.mockResolvedValueOnce(payload)
    const { result } = renderHook(() => useAiUsageByFeature(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith(
      '/ai/usage/by-feature',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('encodes the since query param', async () => {
    const payload: AiUsageByFeatureResponse = {
      since: '2025-01-01T00:00:00Z',
      rows: [
        {
          feature_id: 'chatbot',
          call_count: 4,
          input_tokens: 10,
          output_tokens: 20,
          cost_micro_cents: 100,
          error_count: 0,
          avg_latency_ms: 50,
        },
      ],
    }
    requestMock.mockResolvedValueOnce(payload)
    const { result } = renderHook(
      () => useAiUsageByFeature('2025-01-01T00:00:00Z'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const calledPath = requestMock.mock.calls[0][0] as string
    expect(calledPath.startsWith('/ai/usage/by-feature?since=')).toBe(true)
    expect(calledPath).toContain(encodeURIComponent('2025-01-01T00:00:00Z'))
    expect(result.current.data?.rows).toHaveLength(1)
  })
})

describe('useAiUsageRecent', () => {
  it('omits the limit query param when no argument is provided', async () => {
    const payload: AiUsageRecentResponse = { limit: 50, rows: [] }
    requestMock.mockResolvedValueOnce(payload)
    const { result } = renderHook(() => useAiUsageRecent(), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith(
      '/ai/usage/recent',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('appends the limit query param when given', async () => {
    const payload: AiUsageRecentResponse = { limit: 25, rows: [] }
    requestMock.mockResolvedValueOnce(payload)
    const { result } = renderHook(() => useAiUsageRecent(25), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith(
      '/ai/usage/recent?limit=25',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })
})
