/**
 * HelixStatusStrip contract.
 *
 * The status strip condenses the Helix configuration into a four-tile KPI
 * band (mode / features enabled / provider / spend today). These tests lock
 * in the behaviour that matters:
 *
 *   1. Mode drives the "Status" tile label + the whole strip's a11y region.
 *   2. `providerName` maps through PROVIDER_LABELS, falls back to the raw
 *      key when unmapped, trims stray whitespace, and omits the tile for a
 *      blank value (counted in the drawer).
 *   3. The spend tile reads `/ai/usage/today` and converts micro-cents →
 *      dollars before currency formatting (1 dollar = 1_000_000 micro-cents),
 *      omitted while loading, on error, and when Helix is off.
 *      Non-zero sub-cent costs retain six decimals, including signed values.
 *   4. When Helix is off the usage fetch is skipped entirely.
 *   5. A non-finite feature count is invalid, distinct from a measured zero.
 *
 * The shared `request` client is mocked so the real `useAiUsageToday` hook
 * runs end-to-end without a network. `react-i18next` is stubbed to fall back
 * to the `defaultValue` argument, matching the repo convention.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import type { AiUsageToday } from '@/api/hooks/useAiUsage'
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics'
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions'
import { HelixStatusStrip } from './HelixStatusStrip'

const requestMock = vi.fn()
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

// Passthrough spy: omitted tiles carry no drawer group, so missing/invalid
// classifications are pinned on the mapped hook output instead.
vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>('@/hooks/useOperationalMetrics')
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, optsArg?: unknown) => {
        if (typeof fallbackOrOpts !== 'string') return key
        let out = fallbackOrOpts
        const opts = optsArg as Record<string, unknown> | undefined
        if (opts && typeof opts === 'object') {
          // Match the shared plural-capable fixture: counted sentences honour
          // one/other defaults so the drawer's hidden-count reads correctly.
          if (typeof opts.count === 'number' && (opts.defaultValue_one != null || opts.defaultValue_other != null)) {
            out = String(opts.count === 1 ? (opts.defaultValue_one ?? out) : (opts.defaultValue_other ?? out))
          }
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
          }
        }
        return out
      },
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
 * Resolve the actual Brief value by its labelled metric occurrence, not by
 * assumptions about the shared renderer's typography elements.
 */
function tileValue(label: string): string {
  const labelSpan = screen.getByText(label)
  const valueEl = labelSpan.closest('[data-operational-metric]')?.querySelector('[data-operational-value]')
  return (valueEl?.textContent ?? '').trim()
}

// Unknown readings are omitted from the brief face; the Review-details
// drawer counts them. Pins the exact hidden-count sentence.
function expectHiddenCount(strip: HTMLElement, text: string) {
  fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }))
  const drawer = screen.getByRole('dialog')
  try {
    expect(within(drawer).getByText(text)).toBeInTheDocument()
  } finally {
    fireEvent.keyDown(drawer, { key: 'Escape' })
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
}

function mappedSpendState(): string | undefined {
  const mapped = vi.mocked(useOperationalMetrics).mock.results.at(-1)?.value as
    readonly { valueState?: string }[] | undefined
  return mapped?.[3]?.valueState
}

beforeEach(() => {
  requestMock.mockReset()
  requestMock.mockResolvedValue(makeUsage())
  vi.mocked(useOperationalMetrics).mockClear()
})

describe('HelixStatusStrip', () => {
  it('retains independent draft and daily usage context in the real Review drawer', async () => {
    requestMock.mockResolvedValue(makeUsage({ cost_micro_cents: 12_500_000 }))
    renderStrip({ mode: 'cloud', enabledCount: 3, providerName: 'openai' })
    await waitFor(() => expect(tileValue('Spend today')).toBe('$12.50'))
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    const drawer = screen.getByRole('dialog')
    expect(within(drawer).getByText('OpenAI')).toBeInTheDocument()
    expect(within(drawer).getByText('$12.50')).toBeInTheDocument()
    expect(within(drawer).getByText('Today · UTC')).toBeInTheDocument()
  })

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
    // Provider + spend tiles are omitted regardless of the props.
    const strip = screen.getByTestId('helix-status-strip')
    assertOperationalMetricUnavailable(strip, 'Provider')
    assertOperationalMetricUnavailable(strip, 'Spend today')
    expectHiddenCount(strip, '2 empty fields are hidden.')
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
    expect(screen.getByText('Spend today').closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value')
  })

  it.each([
    [1, '$0.000001'],
    [1_234.5, '$0.001235'],
    [9_999, '$0.009999'],
    [-1, '$-0.000001'],
    [-1_234.5, '$-0.001235'],
    [-9_999, '$-0.009999'],
    [10_000, '$0.01'],
    [-10_000, '$-0.01'],
    [12_345_678, '$12.35'],
    [-12_345_678, '$-12.35'],
  ])('preserves specialist precision for %s micro-cents in the strip and Review drawer', async (cost, expected) => {
    requestMock.mockResolvedValue(makeUsage({ cost_micro_cents: cost }))
    renderStrip({ mode: 'cloud', enabledCount: 1, providerName: 'openai' })

    await waitFor(() => expect(tileValue('Spend today')).toBe(expected))
    expect(screen.getByText('Spend today').closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value')
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    expect(within(screen.getByRole('dialog')).getByText(expected)).toBeInTheDocument()
  })

  it.each([
    ['undefined', undefined, 'missing'],
    ['null', null, 'missing'],
    ['NaN', Number.NaN, 'invalid'],
    ['positive infinity', Number.POSITIVE_INFINITY, 'invalid'],
    ['negative infinity', Number.NEGATIVE_INFINITY, 'invalid'],
    ['numeric string', '1000', 'invalid'],
    ['empty string', '', 'invalid'],
    ['boolean', false, 'invalid'],
  ])('keeps %s cost distinct from measured zero', async (_name, cost, state) => {
    requestMock.mockResolvedValue({ ...makeUsage(), cost_micro_cents: cost })
    renderStrip({ mode: 'cloud', enabledCount: 1, providerName: 'openai' })

    // Settle the usage query, then pin the omission: the unknown spend tile
    // is absent from the face and counted in the drawer.
    await waitFor(() => expect(requestMock).toHaveBeenCalled())
    await waitFor(() => expect(vi.mocked(useOperationalMetrics).mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(mappedSpendState()).toBe(state))
    const strip = screen.getByTestId('helix-status-strip')
    assertOperationalMetricUnavailable(strip, 'Spend today')
    expectHiddenCount(strip, '1 empty field is hidden.')
  })

  it('falls back to the raw provider key when it is not in the label map', () => {
    renderStrip({ mode: 'cloud', enabledCount: 4, providerName: 'my-custom-llm' })

    expect(tileValue('Provider')).toBe('my-custom-llm')
    expect(tileValue('Features enabled')).toBe('4')
  })

  it('trims the provider key and omits a blank provider tile', async () => {
    const first = renderStrip({ mode: 'cloud', enabledCount: 1, providerName: '  openai  ' })
    // Padded key still resolves through PROVIDER_LABELS after trimming.
    expect(tileValue('Provider')).toBe('OpenAI')
    first.unmount()

    renderStrip({ mode: 'cloud', enabledCount: 1, providerName: '   ' })
    // Whitespace-only collapses to blank → omitted tile, not an empty tile.
    const blankStrip = screen.getByTestId('helix-status-strip')
    assertOperationalMetricUnavailable(blankStrip, 'Provider')
    // The default usage payload settles to measured-zero spend, leaving the
    // blank provider as the single hidden field.
    await waitFor(() => expect(tileValue('Spend today')).toBe('$0.00'))
    expectHiddenCount(blankStrip, '1 empty field is hidden.')
  })

  it('guards a non-finite feature count so it never renders as "NaN"', async () => {
    renderStrip({ mode: 'cloud', enabledCount: Number.NaN, providerName: 'openai' })

    const strip = screen.getByTestId('helix-status-strip')
    assertOperationalMetricUnavailable(strip, 'Features enabled')
    // Omitted tiles carry no drawer group, so the invalid classification is
    // pinned on the mapped hook output instead.
    const mapped = vi.mocked(useOperationalMetrics).mock.results.at(-1)?.value as
      readonly { valueState?: string }[] | undefined
    expect(mapped?.[1]?.valueState).toBe('invalid')
    expect(screen.queryByText('NaN')).not.toBeInTheDocument()
    await waitFor(() => expect(tileValue('Spend today')).toBe('$0.00'))
    expectHiddenCount(strip, '1 empty field is hidden.')
  })

  it('omits the spend tile while loading and on error', async () => {
    // Loading: the query never settles, so the tile stays omitted.
    requestMock.mockReturnValue(new Promise(() => {}))
    const loading = renderStrip({ mode: 'cloud', enabledCount: 1, providerName: 'openai' })
    const loadingStrip = screen.getByTestId('helix-status-strip')
    assertOperationalMetricUnavailable(loadingStrip, 'Spend today')
    expectHiddenCount(loadingStrip, '1 empty field is hidden.')
    loading.unmount()

    // Error: a rejected fetch leaves the tile omitted too.
    requestMock.mockRejectedValue(new Error('500 server error'))
    renderStrip({ mode: 'cloud', enabledCount: 1, providerName: 'openai' })
    await waitFor(() => expect(requestMock).toHaveBeenCalled())
    const errorStrip = screen.getByTestId('helix-status-strip')
    assertOperationalMetricUnavailable(errorStrip, 'Spend today')
    expectHiddenCount(errorStrip, '1 empty field is hidden.')
  })
})
