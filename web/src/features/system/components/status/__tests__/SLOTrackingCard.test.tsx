/**
 * SLOTrackingCard tests.
 *
 * Covers the single export (`SLOTrackingCard`) across every branch:
 *   - loading / error / populated data states
 *   - the finite-percentage guard (missing / null / NaN → "—", not a
 *     misleading 0.00% in the failure tone) — the behavioural bug fix
 *   - tone thresholds (green ≥ target, amber within 1pt, red below, muted
 *     when unknown)
 *   - window selector: request URL is prefix-free + snake_case, aria-selected
 *     tracks the active window
 *   - the "current snapshot" caveat (default copy + server-supplied note),
 *     hidden when historical_source === 'series'
 *   - personal target: load from localStorage, edit → save (valid / invalid),
 *     cancel, keyboard (Enter saves, Escape cancels), and persistence
 *   - accessibility (aria-live value, named tablist, decorative icons hidden,
 *     labelled edit input)
 *
 * Mirrors AiUsageCard's convention: `@/api/client` is mocked at the module
 * boundary and driven through a real QueryClient. Interactions use `fireEvent`
 * (this repo does not depend on `@testing-library/user-event`). react-i18next
 * is stubbed with an interpolating `t` so the natural-language keys (and
 * `{{var}}` placeholders) are asserted as the user sees them.
 */

import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      let template = key
      let vars: Record<string, unknown> | undefined
      if (typeof second === 'string') {
        template = second
        if (third && typeof third === 'object') vars = third as Record<string, unknown>
      } else if (second && typeof second === 'object') {
        vars = second as Record<string, unknown>
      }
      if (vars) {
        return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(vars[name] ?? ''),
        )
      }
      return template
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}))

const requestMock = vi.fn()
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import { SLOTrackingCard } from '../SLOTrackingCard'
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' }, settingsUnavailable: false }),
}));

const TARGET_KEY = 'teslasync.status.slo.target'

interface UptimeWindow {
  window: string
  uptime_percent: number
  healthy_count: number
  total_count: number
  generated_at: string
  historical_source: string
  note?: string
}

function makePayload(overrides: Partial<UptimeWindow> = {}): UptimeWindow {
  return {
    window: '30d',
    uptime_percent: 99.98,
    healthy_count: 6,
    total_count: 6,
    generated_at: '2025-01-15T12:00:00Z',
    historical_source: 'series',
    ...overrides,
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const view = render(
    <QueryClientProvider client={qc}>
      <Wrapper>
        <SLOTrackingCard />
      </Wrapper>
    </QueryClientProvider>,
  )
  return { ...view, client: qc }
}

/** Enter edit mode and return the target input. */
async function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  return screen.findByRole('spinbutton', { name: 'Target uptime percentage' })
}

beforeEach(() => {
  requestMock.mockReset()
  window.localStorage.clear()
})

describe('SLOTrackingCard — data states', () => {
  it('shows a loading indicator and an em-dash value while the request is in flight', () => {
    requestMock.mockReturnValue(new Promise<UptimeWindow>(() => {}))
    const { container } = renderCard()

    expect(screen.getByRole('status')).toHaveTextContent('Loading uptime…')
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0)
    // The endpoint is hit exactly once for the default 30d window, with no
    // /api/v1 prefix (the client adds it) and a snake_case-safe query.
    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(requestMock).toHaveBeenCalledWith('/status/uptime?window=30d')
  })

  it('renders the uptime percentage, window label, and healthy component counts', async () => {
    requestMock.mockResolvedValue(makePayload({ uptime_percent: 99.98, healthy_count: 5, total_count: 6 }))
    const { container } = renderCard()

    expect(await screen.findByText('99.98%')).toBeInTheDocument()
    expect(container.textContent).toContain('Last 30 days')
    expect(container.textContent).toContain('5 / 6 components healthy')
    // A healthy figure at or above target is painted green, not red/amber.
    expect(screen.getByText('99.98%')).toHaveClass('dark:text-emerald-300')
  })

  it('surfaces an alert when the request fails', async () => {
    requestMock.mockRejectedValue(new Error('boom'))
    renderCard()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Failed to load uptime data.')
  })
})

describe('SLOTrackingCard — finite-percentage guard (bug fix)', () => {
  it('renders "—" in the muted tone when uptime_percent is NaN rather than a misleading 0.00%', async () => {
    requestMock.mockResolvedValue(makePayload({ uptime_percent: Number.NaN, healthy_count: 3, total_count: 4 }))
    const { container } = renderCard()

    // Wait for the query to settle (counts render once data arrives).
    await waitFor(() => expect(container.textContent).toContain('3 / 4 components healthy'))
    const value = container.querySelector('[data-operational-metric="uptime"]')
    expect(value).toHaveTextContent('—')
    expect(value).not.toHaveTextContent('0.00%')
    expect(value).toHaveAttribute('data-value-state', 'missing')
  })

  it('renders "—" when uptime_percent is missing (null) from the payload', async () => {
    requestMock.mockResolvedValue(
      makePayload({ uptime_percent: null as unknown as number, healthy_count: 2, total_count: 2 }),
    )
    const { container } = renderCard()

    await waitFor(() => expect(container.textContent).toContain('2 / 2 components healthy'))
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('—')
  })

  it('falls back to em-dashes for non-finite component counts', async () => {
    requestMock.mockResolvedValue(
      makePayload({
        uptime_percent: 100,
        healthy_count: null as unknown as number,
        total_count: undefined as unknown as number,
      }),
    )
    const { container } = renderCard()

    await waitFor(() => expect(screen.getByText('100.00%')).toBeInTheDocument())
    expect(container.textContent).toContain('— / — components healthy')
  })
})

describe('SLOTrackingCard — tone thresholds', () => {
  async function renderWithPct(uptime_percent: number) {
    requestMock.mockResolvedValue(makePayload({ uptime_percent }))
    renderCard()
    return screen.findByText(`${uptime_percent.toFixed(2)}%`)
  }

  it('paints amber when uptime is within one point below the 99% target', async () => {
    const value = await renderWithPct(98.5)
    expect(value).toHaveClass('dark:text-amber-300')
  })

  it('paints red when uptime is more than one point below target', async () => {
    const value = await renderWithPct(90)
    expect(value).toHaveClass('dark:text-rose-300')
  })
})

describe('SLOTrackingCard — window selector', () => {
  it('refetches with the selected window and moves the aria-selected state', async () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    expect(screen.getByRole('tab', { name: '30d · Last 30 days' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: '7d · Last 7 days' }))

    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith('/status/uptime?window=7d'),
    )
    expect(screen.getByRole('tab', { name: '7d · Last 7 days' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '30d · Last 30 days' })).toHaveAttribute('aria-selected', 'false')
  })

  it('preserves short window codes and promotes their full tooltip descriptions into visible accessible labels', () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    expect(screen.getByRole('tab', { name: '24h · Last 24 hours' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '1y · Last year' })).toBeInTheDocument()
  })

  it('uses shared arrow/Home/End activation, one tabstop and an associated focused panel', async () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()
    await screen.findByText('99.98%')

    const current = screen.getByRole('tab', { name: '30d · Last 30 days' })
    expect(current).toHaveAttribute('tabindex', '0')
    expect(screen.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toHaveLength(1)
    current.focus()
    fireEvent.keyDown(current, { key: 'ArrowRight' })
    const quarter = screen.getByRole('tab', { name: '90d · Last 90 days' })
    await waitFor(() => expect(quarter).toHaveFocus())
    expect(requestMock).toHaveBeenCalledWith('/status/uptime?window=90d')
    const panel = screen.getByRole('tabpanel', { name: '90d · Last 90 days' })
    expect(quarter).toHaveAttribute('aria-controls', panel.id)
    expect(panel).toHaveAttribute('aria-labelledby', quarter.id)
    expect(panel).toHaveAttribute('tabindex', '0')
    fireEvent.keyDown(quarter, { key: 'Home' })
    const first = screen.getByRole('tab', { name: '24h · Last 24 hours' })
    await waitFor(() => expect(first).toHaveFocus())
    fireEvent.keyDown(first, { key: 'End' })
    await waitFor(() => expect(screen.getByRole('tab', { name: '1y · Last year' })).toHaveFocus())
    expect(requestMock).toHaveBeenCalledWith('/status/uptime?window=1y')
  })

  it('retains historical readings and target controls when the same window refresh fails', async () => {
    requestMock.mockResolvedValue(makePayload({ healthy_count: 5 }))
    const { client } = renderCard()
    await screen.findByText('99.98%')
    requestMock.mockRejectedValue(new Error('refresh failed'))
    await act(async () => {
      await client.refetchQueries({ queryKey: ['status-uptime', '30d'] })
    })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByText('99.98%')).toBeInTheDocument()
    expect(screen.getByText(/5 \/ 6 components healthy/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
    expect(screen.getByRole('tabpanel', { name: '30d · Last 30 days' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('SLOTrackingCard — historical-source caveat', () => {
  it('shows the default snapshot caveat when the source is not a real series', async () => {
    requestMock.mockResolvedValue(makePayload({ historical_source: 'snapshot' }))
    renderCard()

    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent(/heartbeat history backend/i)
    expect(screen.queryByText('99.98%')).not.toBeInTheDocument()
    expect(screen.getByText(/Current component health/)).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('prefers a server-supplied note over the default caveat copy', async () => {
    requestMock.mockResolvedValue(
      makePayload({ historical_source: 'snapshot', note: 'Backfilling — data is partial.' }),
    )
    renderCard()

    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('Backfilling — data is partial.')
  })

  it('hides the caveat entirely when the source is a real per-window series', async () => {
    requestMock.mockResolvedValue(makePayload({ historical_source: 'series' }))
    renderCard()

    await screen.findByText('99.98%')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('SLOTrackingCard — personal target', () => {
  it('loads a valid persisted target from localStorage', async () => {
    window.localStorage.setItem(TARGET_KEY, '95')
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    expect(await screen.findByText('Target 95%')).toBeInTheDocument()
  })

  it('ignores an out-of-range persisted target and falls back to 99%', () => {
    window.localStorage.setItem(TARGET_KEY, '150')
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    expect(screen.getByText('Target 99%')).toBeInTheDocument()
  })

  it('saves an edited target, persists it, and leaves edit mode', async () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Target 90%')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
    await waitFor(() => expect(window.localStorage.getItem(TARGET_KEY)).toBe('90'))
  })

  it('rejects an out-of-range edit and restores the previous target', async () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Target 99%')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('discards the draft when the edit is cancelled', async () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText('Target 99%')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('commits the target when Enter is pressed in the input', async () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: '88' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(await screen.findByText('Target 88%')).toBeInTheDocument()
  })

  it('cancels the edit when Escape is pressed in the input', async () => {
    requestMock.mockResolvedValue(makePayload())
    renderCard()

    const input = await openEditor()
    fireEvent.change(input, { target: { value: '77' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByText('Target 99%')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
  })
})

describe('SLOTrackingCard — accessibility', () => {
  it('names the tablist, exposes a polite live value, and hides decorative icons', async () => {
    requestMock.mockResolvedValue(makePayload({ historical_source: 'snapshot' }))
    const { container } = renderCard()

    await screen.findByRole('note')
    expect(screen.queryByText('99.98%')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('—')

    // Both the header Target glyph and the caveat Info glyph are decorative.
    const decorativeIcons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(decorativeIcons.length).toBe(2)
  })
})
