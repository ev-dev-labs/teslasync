/**
 * AIUsageCard (Settings) — wires `useAiUsageToday()` into the live
 * "Usage today" panel on the Helix settings page.
 *
 * Phase L follow-up: the original F2 placeholder hardcoded "—" for
 * every cell because F3 wasn't wired. This test locks in:
 *
 *   1. The card calls `/ai/usage/today` (TanStack Query).
 *   2. Tokens-in / tokens-out / cost render the live values.
 *   3. micro-cents → dollars conversion is applied before currency
 *      formatting (1 dollar = 1_000_000 micro-cents).
 *   4. Loading + zero-data states fall back to "—" (visual stability).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

describe('AIUsageCard (Settings)', () => {
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
      const values = screen.getAllByTestId('ai-usage-value')
      expect(values[0].textContent).toMatch(/134,?795/)
      expect(values[1].textContent).toMatch(/8,?512/)
    })
    const values = screen.getAllByTestId('ai-usage-value')
    // Cost cell: micro-cents → $12.50 (locale-formatted currency).
    expect(values[2].textContent).toMatch(/12\.50/)
    // Live caption replaces the placeholder when call_count > 0.
    expect(screen.getByText(/80 Helix calls today/i)).toBeInTheDocument()
  })

  it('falls back to em-dash placeholders when no data has loaded yet', () => {
    requestMock.mockImplementation(() => new Promise(() => {})) // never resolves
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <AIUsageCard />
      </Wrapper>,
    )
    const values = screen.getAllByTestId('ai-usage-value')
    expect(values).toHaveLength(3)
    for (const v of values) {
      expect(v.textContent).toBe('—')
    }
    expect(screen.getByText(/Usage populates as features run/i)).toBeInTheDocument()
  })

  it('keeps the em-dash placeholders on error', async () => {
    requestMock.mockRejectedValue(new Error('500 server error'))
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <AIUsageCard />
      </Wrapper>,
    )
    await waitFor(() => {
      const values = screen.getAllByTestId('ai-usage-value')
      for (const v of values) {
        expect(v.textContent).toBe('—')
      }
    })
  })
})
