/**
 * SessionBreakdownPanel contract.
 *
 * One self-sufficient device-breakdown panel (by browser / platform /
 * network) on the Active Sessions page. It owns four render branches and
 * must never leave a blank body behind its title:
 *
 *   1. Loaded — a MetricBar per grouped row, labelled + counted, with a
 *      color drawn from the color-blind-safe series offset by `colorOffset`
 *      so sibling panels are visually distinct.
 *   2. Loading — a single skeleton (title still shown so the layout is
 *      stable).
 *   3. Empty — the caller-provided `emptyMessage`, including when the
 *      caller passes an undefined `items` list (null-safety).
 *   4. Error — a retryable QueryError, and (the harden point) NEVER a blank
 *      body even when `isError` is flagged without an error object —
 *      QueryError renders nothing for a falsy error, so the panel
 *      synthesises a fallback.
 *
 * react-i18next is stubbed so `t(key, default)` falls back to the default
 * string, matching the real i18next behaviour QueryError relies on.
 * QueryError pulls in `useNavigate`, so renders are wrapped in a
 * MemoryRouter. No network is touched — the component is pure props-in,
 * DOM-out.
 */

import { describe, it, expect, vi } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown) => (typeof arg2 === 'string' ? arg2 : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import SessionBreakdownPanelDefault, {
  SessionBreakdownPanel,
} from './SessionBreakdownPanel'
import { chartTokens, typography } from '@/lib/tokens'
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import type { BreakdownItem } from './sessionStats'

type Props = ComponentProps<typeof SessionBreakdownPanel>

const items: BreakdownItem[] = [
  { key: 'chrome', label: 'Chrome', count: 3 },
  { key: 'safari', label: 'Safari', count: 1 },
]

const base: Props = {
  title: 'By browser',
  icon: <svg data-testid="panel-icon" />,
  items,
  total: 4,
  isLoading: false,
  isError: false,
  emptyMessage: 'No sessions to summarize yet.',
}

function renderPanel(overrides: Partial<Props> = {}) {
  return render(
    <MemoryRouter>
      <SessionBreakdownPanel {...base} {...overrides} />
    </MemoryRouter>,
  )
}

describe('SessionBreakdownPanel', () => {
  it('exposes the same component as its default export', () => {
    expect(SessionBreakdownPanelDefault).toBe(SessionBreakdownPanel)
  })

  it.each<{ state: string; overrides: Partial<Props> }>([
    { state: 'loaded', overrides: {} },
    { state: 'loading', overrides: { isLoading: true } },
    { state: 'empty', overrides: { items: [] } },
    { state: 'error', overrides: { isError: true } },
  ])('keeps the icon muted and decorative when $state', ({ overrides }) => {
    renderPanel(overrides)

    const decoration = screen.getByTestId('panel-icon').parentElement
    expect(decoration).toHaveClass(typography.color.muted)
    expect(decoration).toHaveAttribute('aria-hidden', 'true')
    expect(decoration).not.toHaveClass('text-cyan-300')
    expect(screen.getByRole('heading', { name: 'By browser' })).toBeInTheDocument()
  })

  it('renders the title, a decorative icon, and one bar per item when loaded', () => {
    renderPanel()

    // Title heading.
    expect(screen.getByText('By browser')).toBeInTheDocument()

    // Icon is present but hidden from the accessibility tree.
    const icon = screen.getByTestId('panel-icon')
    expect(icon.parentElement).toHaveAttribute('aria-hidden', 'true')

    // One labelled + counted bar per grouped row.
    expect(screen.getByText('Chrome')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Safari')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()

    // No error / empty affordances in the happy path.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.queryByText('No sessions to summarize yet.'),
    ).not.toBeInTheDocument()
  })

  it('offsets bar colors by colorOffset so sibling panels differ', () => {
    // In-range counts: out-of-range readings intentionally render a
    // described group instead of a progressbar (see MetricBar), which is
    // not this test's scenario.
    render(
      <MemoryRouter>
        <SessionBreakdownPanel
          {...base}
          items={[{ key: 'a', label: 'A', count: 3 }]}
          colorOffset={0}
        />
        <SessionBreakdownPanel
          {...base}
          items={[{ key: 'b', label: 'B', count: 1 }]}
          colorOffset={3}
        />
      </MemoryRouter>,
    )

    const first = screen.getByText('3')
    const second = screen.getByText('1')

    expect(first).toHaveClass('text-[var(--text-primary)]')
    expect(second).toHaveClass('text-[var(--text-primary)]')
    const bars = screen.getAllByRole('progressbar')
    expect(bars[0].querySelector('.h-full')).toHaveStyle({ background: `linear-gradient(90deg, ${chartTokens.series[0]}99, ${chartTokens.series[0]})` })
    expect(bars[1].querySelector('.h-full')).toHaveStyle({ background: `linear-gradient(90deg, ${chartTokens.series[3]}99, ${chartTokens.series[3]})` })
  })

  it('reactively formats integer counts without changing raw bar values or maxima', () => {
    const preferences = getFormatterPreferences()
    try {
      act(() => {
        setGlobalLocale('en-US')
        setGlobalPrecision(3)
      })
      renderPanel({
        items: [{ key: 'chrome', label: 'Chrome', count: 1234 }],
        total: 2000,
      })

      const bar = screen.getByRole('progressbar', { name: 'Chrome' })
      expect(screen.getByText('1,234')).toBeInTheDocument()
      expect(bar).toHaveAttribute('aria-valuenow', '1234')
      expect(bar).toHaveAttribute('aria-valuemax', '2000')

      act(() => {
        setGlobalLocale('de-DE')
        setGlobalPrecision(5)
      })

      expect(screen.getByText('1.234')).toBeInTheDocument()
      expect(screen.queryByText('1,234')).not.toBeInTheDocument()
      expect(bar).toHaveAttribute('aria-valuenow', '1234')
      expect(bar).toHaveAttribute('aria-valuemax', '2000')
    } finally {
      act(() => {
        setGlobalLocale(preferences.locale)
        setGlobalPrecision(preferences.precision)
      })
    }
  })

  it('still renders a bar when total is zero (denominator fallback)', () => {
    // max = total > 0 ? total : 1 — a zero total must not crash or blank out.
    renderPanel({ items: [{ key: 'a', label: 'A', count: 2 }], total: 0 })

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows a skeleton and no bars while loading, keeping the title', () => {
    const { container } = renderPanel({ isLoading: true })

    expect(screen.getByText('By browser')).toBeInTheDocument()
    const placeholders = container.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]')
    expect(placeholders).toHaveLength(1)
    expect(placeholders[0]).toHaveClass('w-full', 'rounded')
    expect(placeholders[0]).toHaveStyle({ height: '168px' })
    expect(placeholders[0]).not.toHaveClass('animate-pulse', 'motion-safe:animate-pulse')
    expect(screen.queryByText('Chrome')).not.toBeInTheDocument()
  })

  it('renders the empty state with the provided message when there are no items', () => {
    renderPanel({ items: [] })

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No sessions to summarize yet.')).toBeInTheDocument()
    expect(screen.queryByText('Chrome')).not.toBeInTheDocument()
  })

  it('treats a missing items list as empty without crashing (null-safety)', () => {
    renderPanel({ items: undefined as unknown as BreakdownItem[] })

    expect(screen.getByText('No sessions to summarize yet.')).toBeInTheDocument()
  })

  it('renders a retryable server error and invokes onRetry on click', () => {
    const onRetry = vi.fn()
    renderPanel({
      isError: true,
      error: { name: 'ApiError', status: 500 },
      onRetry,
    })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Server error')).toBeInTheDocument()
    // Bars are replaced by the error card.
    expect(screen.queryByText('Chrome')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('never goes blank when isError is set without an error object', () => {
    // Regression guard: QueryError returns null for a falsy error, which
    // would otherwise leave the panel body empty behind its title. The
    // component synthesises a fallback so a retryable card always shows.
    const onRetry = vi.fn()
    renderPanel({ isError: true, error: undefined, onRetry })

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // jsdom reports the browser online, so the generic network branch shows.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
