import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AiUsageByFeatureResponse, AiUsageRecentResponse } from '@/api/hooks/useAiUsage'

vi.mock('@/api/client', () => ({ request: vi.fn() }))
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback: string, options?: Record<string, unknown>) =>
        Object.entries(options ?? {}).reduce(
          (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
          fallback ?? key,
        ),
      i18n: { language: 'en' },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { aiUsageKeys } from '@/api/hooks/useAiUsage'
import { AIFeatureSpendPanel } from './AIFeatureSpendPanel'

const requestMock = vi.mocked(request)
const byFeature: AiUsageByFeatureResponse = {
  since: '2026-09-18T00:00:00Z',
  rows: [
    { feature_id: 'chatbot-llm', call_count: 3, input_tokens: 120, output_tokens: 40, cost_micro_cents: 2_000_000, error_count: 0, avg_latency_ms: 20, last_call_at: '2026-09-24T12:00:00Z' },
    { feature_id: 'rag-help', call_count: 1, input_tokens: 50, output_tokens: 20, cost_micro_cents: 5_000_000, error_count: 0, avg_latency_ms: 20, last_call_at: '2026-09-25T12:00:00Z' },
    { feature_id: 'drive-coaching', call_count: 1, input_tokens: 5, output_tokens: 1, cost_micro_cents: 100_000, error_count: 0, avg_latency_ms: 20, last_call_at: '2026-09-23T12:00:00Z' },
  ],
}
const recent: AiUsageRecentResponse = {
  limit: 50,
  rows: [
    { id: 1, feature_id: 'rag-help', provider: 'anthropic', model: 'claude-sonnet', input_tokens: 50, output_tokens: 20, cost_micro_cents: 5_000_000, latency_ms: 20, finish_reason: '', request_hash: '', redacted_digest: '', error: '', started_at: '2026-09-25T12:00:00Z', finished_at: '2026-09-25T12:00:01Z' },
  ],
}

function renderPanel(enabled = true, seed?: AiUsageByFeatureResponse) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  if (seed) client.setQueryData(aiUsageKeys.byFeature(), seed)
  render(<QueryClientProvider client={client}><AIFeatureSpendPanel enabled={enabled} capCents={1000} /></QueryClientProvider>)
  return client
}

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockImplementation((path) => Promise.resolve(path === '/ai/usage/by-feature' ? byFeature : recent) as ReturnType<typeof request>)
})

describe('AIFeatureSpendPanel', () => {
  it('makes no usage requests when AI is off', async () => {
    renderPanel(false)
    expect(screen.getByText(/Save an enabled Helix mode/)).toBeInTheDocument()
    await waitFor(() => expect(requestMock).not.toHaveBeenCalled())
  })

  it('sorts actual seven-day spend and only attributes sampled calls', async () => {
    renderPanel()
    const items = await screen.findAllByRole('listitem')
    expect(requestMock).toHaveBeenCalledWith('/ai/usage/by-feature', expect.anything())
    expect(requestMock).toHaveBeenCalledWith('/ai/usage/recent?limit=50', expect.anything())
    expect(within(items[0]).getByText('$5.00')).toBeInTheDocument()
    expect(within(items[0]).getByText(/Recent call: anthropic \/ claude-sonnet/)).toBeInTheDocument()
    expect(within(items[1]).getByText('$2.00')).toBeInTheDocument()
    expect(within(items[1]).getByText(/No recent provider\/model sample/)).toBeInTheDocument()
    expect(within(items[0]).getByText(/1 calls · 50 in \/ 20 out/)).toBeInTheDocument()
    expect(screen.getByText(/daily cap applies to all Helix calls combined/)).toBeInTheDocument()
  })

  it('keeps the panel during loading, empty, error and retry', async () => {
    let rejectFirst!: (reason: Error) => void
    requestMock.mockImplementation((path) =>
      path === '/ai/usage/by-feature'
        ? new Promise((_resolve, reject) => { rejectFirst = reject })
        : Promise.resolve(recent),
    )
    renderPanel()
    expect(screen.getByText('Loading feature spend…')).toBeInTheDocument()
    rejectFirst(new Error('unavailable'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Feature spend could not be loaded.')
    requestMock.mockImplementation((path) => Promise.resolve(path === '/ai/usage/by-feature'
      ? { ...byFeature, rows: [] } : recent) as ReturnType<typeof request>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No audited Helix calls in the last 7 days.')).toBeInTheDocument()
  })

  it('retains totals on a failed refresh and flags them stale', async () => {
    requestMock.mockImplementation((path) => path === '/ai/usage/by-feature'
      ? Promise.reject(new Error('offline'))
      : Promise.resolve(recent) as ReturnType<typeof request>)
    const client = renderPanel(true, byFeature)
    await waitFor(() => expect(client.getQueryState(aiUsageKeys.byFeature())?.error).not.toBeNull())
    expect(screen.getByText(/Showing retained spend/)).toBeInTheDocument()
    expect(screen.getByText('$5.00')).toBeInTheDocument()
  })
})
