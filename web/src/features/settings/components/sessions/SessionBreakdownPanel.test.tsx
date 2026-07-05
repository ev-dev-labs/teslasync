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
import { render, screen, fireEvent } from '@testing-library/react'
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
import { chartTokens } from '@/lib/tokens'
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
    render(
      <MemoryRouter>
        <SessionBreakdownPanel
          {...base}
          items={[{ key: 'a', label: 'A', count: 5 }]}
          colorOffset={0}
        />
        <SessionBreakdownPanel
          {...base}
          items={[{ key: 'b', label: 'B', count: 7 }]}
          colorOffset={3}
        />
      </MemoryRouter>,
    )

    const first = screen.getByText('5')
    const second = screen.getByText('7')

    expect(first).toHaveStyle({ color: chartTokens.series[0] })
    expect(second).toHaveStyle({ color: chartTokens.series[3] })
    expect((first as HTMLElement).style.color).not.toBe(
      (second as HTMLElement).style.color,
    )
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
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
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
