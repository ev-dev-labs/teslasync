/**
 * HelixStatusStrip contract.
 *
 * The status strip condenses the Helix configuration into a four-tile KPI
 * band (mode / features enabled / provider / spend today). These tests lock
 * in the behaviour that matters:
 *
 *   1. Mode drives the "Status" tile label + the whole strip's a11y region.
 *   2. `providerName` maps through PROVIDER_LABELS, falls back to the raw
 *      key when unmapped, trims stray whitespace, and degrades a blank
 *      value to the em-dash.
 *   3. The spend tile reads `/ai/usage/today` and converts micro-cents →
 *      dollars before currency formatting (1 dollar = 1_000_000 micro-cents),
 *      staying at the em-dash while loading, on error, and when Helix is off.
 *   4. When Helix is off the usage fetch is skipped entirely.
 *   5. A non-finite feature count is guarded to 0.
 *
 * The shared `request` client is mocked so the real `useAiUsageToday` hook
 * runs end-to-end without a network. `react-i18next` is stubbed to fall back
 * to the `defaultValue` argument, matching the repo convention.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import type { AiUsageToday } from '@/api/hooks/useAiUsage'
import { HelixStatusStrip } from './HelixStatusStrip'

const EM_DASH = '\u2014'

const requestMock = vi.fn()
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) =>
        typeof fallbackOrOpts === 'string' ? fallbackOrOpts : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

function makeUsage(overrides: Partial<AiUsageToday> = {}): AiUsageToday {
  return {
    user_subject: 'user-1',
    call_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_micro_cents: 0,
    error_count: 0,
    avg_latency_ms: 0,
    ...overrides,
  }
}

type StripProps = {
  mode: 'off' | 'local' | 'cloud'
  enabledCount: number
  providerName: string
}

function renderStrip(props: StripProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <HelixStatusStrip {...props} />
    </QueryClientProvider>,
  )
}

/**
 * Read the value rendered next to a MetricCard label. The label text lives in
 * a <span> inside the `.metric-label` <p>; the value is that <p>'s next
 * sibling. Resolving by label keeps the assertion robust against tile order.
 */
function tileValue(label: string): string {
  const labelSpan = screen.getByText(label)
  const labelParagraph = labelSpan.closest('p')
  const valueEl = labelParagraph?.nextElementSibling as HTMLElement | null
  return (valueEl?.textContent ?? '').trim()
}

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockResolvedValue(makeUsage())
})

describe('HelixStatusStrip', () => {
  it('renders all four tiles with live cloud usage', async () => {
    requestMock.mockResolvedValue(makeUsage({ call_count: 5, cost_micro_cents: 12_500_000 }))

    renderStrip({ mode: 'cloud', enabledCount: 3, providerName: 'openai' })

    // The strip is an accessible landmark region named for the panel.
    expect(
      screen.getByRole('region', { name: 'Helix status' }),
    ).toBe(screen.getByTestId('helix-status-strip'))

    expect(tileValue('Status')).toBe('Cloud')
    expect(tileValue('Features enabled')).toBe('3')
    expect(tileValue('Provider')).toBe('OpenAI')

    // Spend resolves asynchronously: 12_500_000 micro-cents → $12.50.
    await waitFor(() => expect(tileValue('Spend today')).toBe('$12.50'))
    expect(requestMock).toHaveBeenCalledWith('/ai/usage/today', expect.anything())
  })

  it('skips the usage fetch and shows placeholders when Helix is off', () => {
    renderStrip({ mode: 'off', enabledCount: 2, providerName: 'openai' })

    expect(tileValue('Status')).toBe('Off (default)')
    // Provider + spend degrade to the em-dash regardless of the props.
    expect(tileValue('Provider')).toBe(EM_DASH)
    expect(tileValue('Spend today')).toBe(EM_DASH)
    // The feature count still reflects the real value.
    expect(tileValue('Features enabled')).toBe('2')
    // No network is attempted while off (the endpoint would 403).
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('renders local mode with a mapped provider and formats zero spend', async () => {
    requestMock.mockResolvedValue(makeUsage({ cost_micro_cents: 0 }))

    renderStrip({ mode: 'local', enabledCount: 1, providerName: 'ollama' })

    expect(tileValue('Status')).toBe('Local-only')
    expect(tileValue('Provider')).toBe('Ollama')
    // A resolved all-zeros payload formats as currency, not the placeholder.
    await waitFor(() => expect(tileValue('Spend today')).toBe('$0.00'))
  })

  it('falls back to the raw provider key when it is not in the label map', () => {
    renderStrip({ mode: 'cloud', enabledCount: 4, providerName: 'my-custom-llm' })

    expect(tileValue('Provider')).toBe('my-custom-llm')
    expect(tileValue('Features enabled')).toBe('4')
  })

  it('trims the provider key and degrades a blank provider to the em-dash', () => {
    const first = renderStrip({ mode: 'cloud', enabledCount: 1, providerName: '  openai  ' })
    // Padded key still resolves through PROVIDER_LABELS after trimming.
    expect(tileValue('Provider')).toBe('OpenAI')
    first.unmount()

    renderStrip({ mode: 'cloud', enabledCount: 1, providerName: '   ' })
    // Whitespace-only collapses to blank → placeholder, not an empty tile.
    expect(tileValue('Provider')).toBe(EM_DASH)
  })

  it('guards a non-finite feature count so it never renders as "NaN"', () => {
    renderStrip({ mode: 'cloud', enabledCount: Number.NaN, providerName: 'openai' })

    expect(tileValue('Features enabled')).toBe('0')
    expect(tileValue('Features enabled')).not.toContain('NaN')
  })

  it('keeps the spend tile at the em-dash while loading and on error', async () => {
    // Loading: the query never settles, so the tile shows the placeholder.
    requestMock.mockReturnValue(new Promise(() => {}))
    const loading = renderStrip({ mode: 'cloud', enabledCount: 1, providerName: 'openai' })
    expect(tileValue('Spend today')).toBe(EM_DASH)
    loading.unmount()

    // Error: a rejected fetch leaves the tile at the placeholder too.
    requestMock.mockRejectedValue(new Error('500 server error'))
    renderStrip({ mode: 'cloud', enabledCount: 1, providerName: 'openai' })
    await waitFor(() => expect(requestMock).toHaveBeenCalled())
    expect(tileValue('Spend today')).toBe(EM_DASH)
  })
})
