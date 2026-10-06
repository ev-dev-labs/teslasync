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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const requestMock = vi.fn()
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import { AIUsageCard } from '../AIUsageCard'

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
function usageValues() {
  return Array.from(screen.getByTestId('helix-usage-summary').querySelectorAll('[data-operational-value]'))
}

describe('AIUsageCard (Settings)', () => {
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
})
