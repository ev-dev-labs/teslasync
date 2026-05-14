/**
 * AiUsageCard — Phase-50 / 0004 — F3 AI Call Log + Usage Card.
 *
 * Verifies:
 *
 *   - Off mode (`ai_mode === 'off'`) renders nothing — the
 *     data-ai-feature marker MUST NOT enter the DOM (ADR-015 §I4).
 *   - Local / openai modes render the marker + the populated card
 *     when there are calls.
 *   - The empty-state branch fires when `today.call_count === 0`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { AppSettings } from '@/api/types'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}))

const requestMock = vi.fn()
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import { useSettings } from '@/hooks/useSettings'
import { AiUsageCard } from '../AiUsageCard'

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>

function settingsPayload(partial: Partial<AppSettings>): { settings: AppSettings } {
  const base: AppSettings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant',
  }
  return { settings: { ...base, ...partial } as AppSettings }
}

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  mockUseSettings.mockReset()
  requestMock.mockReset()
})

describe('AiUsageCard — off mode', () => {
  it('renders nothing when settings are not loaded', () => {
    mockUseSettings.mockReturnValue({ settings: undefined })
    const Wrapper = makeWrapper()
    const { container } = render(
      <Wrapper>
        <AiUsageCard />
      </Wrapper>,
    )
    expect(container.querySelector('[data-ai-feature]')).toBeNull()
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('renders nothing when ai_mode is off', () => {
    mockUseSettings.mockReturnValue(settingsPayload({ ai_mode: 'off' } as Partial<AppSettings>))
    const Wrapper = makeWrapper()
    const { container } = render(
      <Wrapper>
        <AiUsageCard />
      </Wrapper>,
    )
    expect(container.querySelector('[data-ai-feature]')).toBeNull()
    expect(requestMock).not.toHaveBeenCalled()
  })
})

describe('AiUsageCard — on mode', () => {
  it('renders the empty branch when no calls have been audited yet', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'local' } as Partial<AppSettings>),
    )
    requestMock.mockImplementation(async (path: string) => {
      if (path === '/ai/usage/today') {
        return {
          user_subject: '',
          call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cost_micro_cents: 0,
          error_count: 0,
          avg_latency_ms: 0,
        }
      }
      if (path.startsWith('/ai/usage/by-feature')) {
        return { since: '2025-01-01T00:00:00Z', rows: [] }
      }
      if (path.startsWith('/ai/usage/recent')) {
        return { limit: 10, rows: [] }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <AiUsageCard />
      </Wrapper>,
    )
    await waitFor(() =>
      expect(screen.getByText(/no ai calls yet/i)).toBeInTheDocument(),
    )
    expect(screen.getByTestId('ai-feature-usage')).toBeInTheDocument()
  })

  it('renders the populated card when calls have been audited', async () => {
    mockUseSettings.mockReturnValue(
      settingsPayload({ ai_mode: 'cloud' } as Partial<AppSettings>),
    )
    requestMock.mockImplementation(async (path: string) => {
      if (path === '/ai/usage/today') {
        return {
          user_subject: 'alice',
          call_count: 3,
          input_tokens: 100,
          output_tokens: 200,
          cost_micro_cents: 25_000,
          error_count: 1,
          avg_latency_ms: 312,
        }
      }
      if (path.startsWith('/ai/usage/by-feature')) {
        return {
          since: '2025-01-01T00:00:00Z',
          rows: [
            {
              feature_id: 'chatbot',
              call_count: 2,
              input_tokens: 70,
              output_tokens: 140,
              cost_micro_cents: 18_000,
              error_count: 0,
              avg_latency_ms: 290,
            },
            {
              feature_id: 'route_summary',
              call_count: 1,
              input_tokens: 30,
              output_tokens: 60,
              cost_micro_cents: 7_000,
              error_count: 1,
              avg_latency_ms: 350,
            },
          ],
        }
      }
      if (path.startsWith('/ai/usage/recent')) {
        return {
          limit: 10,
          rows: [
            {
              id: 1,
              feature_id: 'chatbot',
              provider: 'openai',
              model: 'gpt-4o-mini',
              input_tokens: 50,
              output_tokens: 80,
              cost_micro_cents: 9_500,
              latency_ms: 280,
              finish_reason: 'stop',
              request_hash: 'abc',
              redacted_digest: 'def',
              error: '',
              started_at: new Date(Date.now() - 30_000).toISOString(),
              finished_at: new Date(Date.now() - 28_000).toISOString(),
            },
          ],
        }
      }
      throw new Error(`unexpected path ${path}`)
    })
    const Wrapper = makeWrapper()
    render(
      <Wrapper>
        <AiUsageCard />
      </Wrapper>,
    )
    await waitFor(() => expect(screen.getByTestId('ai-feature-usage')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Today')).toBeInTheDocument())
    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('Cost / latency')).toBeInTheDocument()
    expect(screen.getByText('By feature (7 days)')).toBeInTheDocument()
    expect(screen.getByText('chatbot')).toBeInTheDocument()
    expect(screen.getByText('route_summary')).toBeInTheDocument()
    expect(screen.getByText('Recent calls')).toBeInTheDocument()
  })
})
