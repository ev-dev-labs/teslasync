/**
 * AIUsageCard (Settings) — wires `useAiUsageToday()` into the live
 * "Usage today" panel on the Helix settings page.
 *
 * The original placeholder hardcoded "—" for every cell. This test locks in:
 *
 *   1. The card calls `/ai/usage/today` (TanStack Query).
 *   2. Tokens-in / tokens-out / cost render the live values.
 *   3. micro-cents → dollars conversion is applied before currency
 *      formatting (1 dollar = 1_000_000 micro-cents).
 *   4. Loading, zero-data, off, and failures remain distinct.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'

const requestMock = vi.fn()
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import { AIUsageCard } from '../AIUsageCard'
import * as settingsHook from '@/hooks/useSettings'
import { aiUsageKeys, type AiUsageToday } from '@/api/hooks/useAiUsage'

const totals: AiUsageToday = {
  user_subject: 'test', call_count: 1, input_tokens: 42, output_tokens: 10,
  cost_micro_cents: 1200, error_count: 0, avg_latency_ms: 10,
}

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
afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})
function usageValues() {
  return Array.from(screen.getByTestId('helix-usage-summary').querySelectorAll('[data-operational-value]'))
}

describe('AIUsageCard (Settings)', () => {
  it.each([
    { symbol: '€', cost: 1_234_500_000, expected: '$1.234,50' },
    { symbol: 'CAD$', cost: 1200, expected: '$0,001200' },
  ])('keeps USD and locale-formatted magnitude with a $symbol preference', async ({ symbol, cost, expected }) => {
    const { result, unmount } = renderHook(() => settingsHook.useSettings(), { wrapper: makeWrapper() })
    const defaults = result.current
    unmount()
    vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
      ...defaults,
      settings: { ...defaults.settings, currency_symbol: symbol, locale: 'de-DE' },
      locale: 'de-DE',
    })
    requestMock.mockResolvedValue({
      call_count: 1, input_tokens: 42, output_tokens: 10,
      cost_micro_cents: cost, error_count: 0, avg_latency_ms: 10,
    })
    const Wrapper = makeWrapper()
    render(<Wrapper><AIUsageCard /></Wrapper>)

    await screen.findByText('1 call · 0 errors')
    expect(usageValues()[2].textContent).toBe(expected)
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    expect(within(screen.getByRole('dialog')).getByText(expected)).toBeInTheDocument()
  })

  it('opens the real Review drawer without changing usage or requesting a mutation', async () => {
    requestMock.mockResolvedValue({
      call_count: 1, input_tokens: 42, output_tokens: 10,
      cost_micro_cents: 1200, error_count: 0, avg_latency_ms: 10,
    })
    const Wrapper = makeWrapper()
    render(<Wrapper><AIUsageCard /></Wrapper>)
    await screen.findByText('1 call · 0 errors')
    expect(screen.getByText('Tokens in').closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value')
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('42')).toBeInTheDocument()
    expect(within(drawer).getByText('$0.001200')).toBeInTheDocument()
    expect(requestMock.mock.calls.some(call => ['POST', 'PUT', 'DELETE'].includes(
      (call[1] as RequestInit | undefined)?.method ?? 'GET',
    ))).toBe(false)
  })

  it('renders the live numbers from /ai/usage/today', async () => {
    requestMock.mockImplementation(async (path: string) => {
      if (path === '/ai/usage/today') {
        return {
          call_count: 80,
          input_tokens: 134795,
          output_tokens: 8512,
          cost_micro_cents: 12_500_000, // = $12.50
          error_count: 0,
          avg_latency_ms: 0,
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <AIUsageCard />
      </Wrapper>,
    )

    await waitFor(() => {
      const values = usageValues()
      expect(values[0].textContent).toMatch(/134,?795/)
      expect(values[1].textContent).toMatch(/8,?512/)
    })
    const values = usageValues()
    // Cost cell: micro-cents → $12.50 (locale-formatted currency).
    expect(values[2].textContent).toMatch(/12\.50/)
    expect(screen.getByText(/80 calls · 0 errors/i)).toBeInTheDocument()
  })

  it('retains the loading Brief without claiming measurements before data arrives', () => {
    requestMock.mockImplementation(() => new Promise(() => {})) // never resolves
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <AIUsageCard />
      </Wrapper>,
    )
    expect(screen.getByTestId('helix-usage-summary')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('helix-usage-summary').querySelectorAll('[data-operational-metric]')).toHaveLength(3)
    expect(usageValues()).toHaveLength(0)
    expect(screen.getByText(/Loading today’s usage/i)).toBeInTheDocument()
  })

  it('shows a retryable error instead of reporting unknown totals as zero', async () => {
    requestMock.mockRejectedValue(new Error('500 server error'))
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <AIUsageCard />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Usage could not be loaded.')
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(usageValues().map(node => node.textContent)).toEqual(['—', '—', '—'])
    expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument()
    requestMock.mockResolvedValue(totals)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('1 call · 0 errors')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a real zero state and precise small estimated costs', async () => {
    requestMock.mockResolvedValue({
      call_count: 0, input_tokens: 0, output_tokens: 0,
      cost_micro_cents: 0, error_count: 0, avg_latency_ms: 0,
    })
    const Wrapper = makeWrapper()
    const { unmount } = render(<Wrapper><AIUsageCard /></Wrapper>)
    expect(await screen.findByText('No Helix calls yet today.')).toBeInTheDocument()
    expect(usageValues().map(node => node.textContent)).toEqual(['0', '0', '$0.00'])
    unmount()

    requestMock.mockResolvedValue({
      call_count: 1, input_tokens: 42, output_tokens: 10,
      cost_micro_cents: 1200, error_count: 0, avg_latency_ms: 10,
    })
    render(<Wrapper><AIUsageCard /></Wrapper>)
    await screen.findByText('1 call · 0 errors')
    expect(usageValues()[2]).toHaveTextContent('$0.001200')
  })

  it('does not call the guarded endpoint while Helix is off', () => {
    const Wrapper = makeWrapper()
    render(<Wrapper><AIUsageCard enabled={false} /></Wrapper>)
    expect(screen.getByText('Helix is off. Enable it and make a call to see usage.')).toBeInTheDocument()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('distinguishes a paused first load from active loading and failure, then recovers', async () => {
    onlineManager.setOnline(false)
    requestMock.mockResolvedValue(totals)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><AIUsageCard /></QueryClientProvider>)

    expect(screen.getByTestId('helix-usage-summary')).not.toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('helix-daily-source-notice')).toHaveTextContent('Refresh paused')
    expect(screen.queryByText(/Loading today’s usage/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Refresh failed/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(usageValues().map(node => node.textContent)).toEqual(['—', '—', '—'])
    expect(requestMock).not.toHaveBeenCalled()

    act(() => onlineManager.setOnline(true))
    await screen.findByText('1 call · 0 errors')
    expect(screen.queryByTestId('helix-daily-source-notice')).not.toBeInTheDocument()
    expect(screen.getByText(/Last updated:/).tagName).toBe('TIME')
  })

  it.each(['paused', 'failed'] as const)('retains totals and source time during a %s refresh and recovers', async mode => {
    requestMock.mockResolvedValue(totals)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><AIUsageCard /></QueryClientProvider>)
    await screen.findByText('1 call · 0 errors')
    const timestamp = screen.getByText(/Last updated:/).getAttribute('datetime')

    if (mode === 'paused') {
      act(() => onlineManager.setOnline(false))
      act(() => { void client.invalidateQueries({ queryKey: aiUsageKeys.today() }) })
    } else {
      requestMock.mockRejectedValue(new Error('refresh unavailable'))
      await act(async () => { await client.invalidateQueries({ queryKey: aiUsageKeys.today() }) })
    }
    const notice = await screen.findByTestId('helix-daily-source-notice')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(mode === 'paused' ? 'Refresh paused' : 'Refresh failed.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(usageValues().map(node => node.textContent)).toEqual(['42', '10', '$0.001200'])
    expect(screen.getByText(/Last updated:/)).toHaveAttribute('datetime', timestamp)

    requestMock.mockResolvedValue({ ...totals, input_tokens: 99 })
    if (mode === 'paused') {
      act(() => onlineManager.setOnline(true))
    } else {
      fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }))
    }
    await waitFor(() => expect(usageValues()[0]).toHaveTextContent('99'))
    expect(screen.queryByTestId('helix-daily-source-notice')).not.toBeInTheDocument()
  })

  it('keeps one recovery notice when two daily consumers share an explicit notice owner', async () => {
    requestMock.mockResolvedValue(totals)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}>
      <AIUsageCard />
      <AIUsageCard showSourceNotice={false} />
    </QueryClientProvider>)
    await screen.findAllByText('1 call · 0 errors')
    expect(requestMock).toHaveBeenCalledTimes(1)
    requestMock.mockRejectedValue(new Error('daily refresh unavailable'))
    await act(async () => { await client.invalidateQueries({ queryKey: aiUsageKeys.today() }) })
    await screen.findByTestId('helix-daily-source-notice')
    expect(screen.getAllByTestId('helix-daily-source-notice')).toHaveLength(1)
    for (const card of screen.getAllByTestId('ai-usage-card')) {
      expect(within(card).getByText('1 call · 0 errors')).toBeInTheDocument()
      expect(within(card).getByText(/Last updated:/)).toBeInTheDocument()
    }
    requestMock.mockResolvedValue(totals)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByTestId('helix-daily-source-notice')).not.toBeInTheDocument())
  })

  it('disables retry during recovery without replacing retained measurements with skeletons', async () => {
    requestMock.mockResolvedValue(totals)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><AIUsageCard /></QueryClientProvider>)
    await screen.findByText('1 call · 0 errors')
    requestMock.mockRejectedValue(new Error('refresh unavailable'))
    await act(async () => { await client.invalidateQueries({ queryKey: aiUsageKeys.today() }) })
    await screen.findByTestId('helix-daily-source-notice')

    let recover!: (value: AiUsageToday) => void
    requestMock.mockImplementation(() => new Promise<AiUsageToday>(resolve => { recover = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Updating…' })).toBeDisabled()
    expect(usageValues().map(node => node.textContent)).toEqual(['42', '10', '$0.001200'])
    expect(screen.getByTestId('helix-usage-summary')).not.toHaveAttribute('aria-busy', 'true')
    await act(async () => { recover({ ...totals, input_tokens: 99 }) })
    await waitFor(() => expect(usageValues()[0]).toHaveTextContent('99'))
    expect(screen.queryByTestId('helix-daily-source-notice')).not.toBeInTheDocument()
  })
})
