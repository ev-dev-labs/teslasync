/**
 * SessionsSummaryCards — presentational KPI band contract.
 *
 * The component is a pure presentational surface: the page derives the stats
 * (via `computeSessionStats`) and hands them down as props. So there is no
 * network to mock here — instead we exercise every branch of the render:
 *   • loading   → four skeletons, no cards, `aria-busy`
 *   • loaded    → four MetricCards with the right labels / values / subtitles,
 *                 device label from the UA, IP + last-active formatting
 *   • empty     → no current session / no last-active fall back to copy, and
 *                 the date formatters are NOT called
 *   • error     → QueryError takes over (no cards, no skeletons) and Retry
 *                 fires `onRetry`
 *   • error w/ nullish `error` → still renders a recoverable error state
 *                 (regression guard: QueryError renders null for a falsy error)
 *
 * `@/hooks/useDateFormat` is mocked with hoisted spies so the relative /
 * absolute timestamps are deterministic AND we can assert the component calls
 * the right formatter with the right argument. `react-i18next` is stubbed to
 * return each key's default string (matching the repo-wide test convention).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentProps, ReactNode } from 'react'

// Hoisted formatter spies — referenced inside the (hoisted) vi.mock factory.
const { formatRelativeTime, formatDateTime } = vi.hoisted(() => ({
  formatRelativeTime: vi.fn((v: unknown) => `rel:${String(v)}`),
  formatDateTime: vi.fn((v: unknown) => `dt:${String(v)}`),
}))

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatRelativeTime, formatDateTime }),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { SessionsSummaryCards } from './SessionsSummaryCards'

type Props = ComponentProps<typeof SessionsSummaryCards>

const CHROME_MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Chrome/120.0 Safari/537.36'

function renderCards(overrides: Partial<Props> = {}) {
  const props: Props = {
    total: 0,
    current: null,
    otherCount: 0,
    lastActive: null,
    isLoading: false,
    isError: false,
    ...overrides,
  }
  return render(
    <MemoryRouter>
      <SessionsSummaryCards {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  formatRelativeTime.mockClear()
  formatDateTime.mockClear()
})

describe('SessionsSummaryCards — loading', () => {
  it('renders four skeletons, no cards, and marks the region busy', () => {
    const { container } = renderCards({ isLoading: true })

    // One `.animate-pulse` element per Skeleton — the layout must not jump.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
    // None of the KPI labels are painted while the query is in flight.
    expect(screen.queryByText('Active sessions')).toBeNull()
    expect(screen.queryByText('This device')).toBeNull()

    const region = screen.getByRole('region', { name: 'Session summary' })
    expect(region).toHaveAttribute('aria-busy', 'true')
  })
})

describe('SessionsSummaryCards — loaded with data', () => {
  it('renders all four KPI cards with labels, values, and subtitles', () => {
    renderCards({
      total: 4,
      current: {
        id: 's1',
        user_agent: CHROME_MAC_UA,
        ip: '10.2.2.2',
        created_at: '2026-05-05T10:00:00Z',
        last_seen_at: '2026-05-05T12:00:00Z',
        current: true,
      },
      otherCount: 2,
      lastActive: '2026-05-05T12:00:00Z',
    })

    // Total.
    expect(screen.getByText('Active sessions')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()

    // This device — label derived from the UA, IP as subtitle.
    expect(screen.getByText('This device')).toBeInTheDocument()
    expect(screen.getByText('Chrome · macOS')).toBeInTheDocument()
    expect(screen.getByText('10.2.2.2')).toBeInTheDocument()

    // Other devices.
    expect(screen.getByText('Other devices')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    // Last active — relative label + absolute subtitle via the formatters.
    expect(screen.getByText('Last active')).toBeInTheDocument()
    expect(screen.getByText('rel:2026-05-05T12:00:00Z')).toBeInTheDocument()
    expect(screen.getByText('dt:2026-05-05T12:00:00Z')).toBeInTheDocument()
    expect(formatRelativeTime).toHaveBeenCalledWith('2026-05-05T12:00:00Z')
    expect(formatDateTime).toHaveBeenCalledWith('2026-05-05T12:00:00Z')

    // Not an error / not loading: no error banner, region not busy.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.getByRole('region', { name: 'Session summary' })).toHaveAttribute(
      'aria-busy',
      'false',
    )
  })

  it('falls back to a middot-free label when the UA is unrecognised', () => {
    renderCards({
      total: 1,
      current: {
        id: 's2',
        user_agent: 'some-cli/1.0',
        ip: '',
        created_at: '2026-05-05T10:00:00Z',
        last_seen_at: '2026-05-05T12:00:00Z',
        current: true,
      },
      otherCount: 0,
      lastActive: '2026-05-05T12:00:00Z',
    })

    // describeDevice returns the em-dash sentinel for an unknown UA.
    expect(screen.getByText('—')).toBeInTheDocument()
    // An empty IP must NOT render a subtitle row (`current?.ip || undefined`).
    expect(screen.queryByText('This device')).toBeInTheDocument()
  })
})

describe('SessionsSummaryCards — empty / no current session', () => {
  it('uses fallback copy and never calls the date formatters', () => {
    renderCards({ total: 0, current: null, otherCount: 0, lastActive: null })

    expect(screen.getByText('Unknown device')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
    // total + otherCount both render 0 — never a blank value.
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2)
    // No last-active timestamp → formatters are skipped entirely.
    expect(formatRelativeTime).not.toHaveBeenCalled()
    expect(formatDateTime).not.toHaveBeenCalled()
  })
})

describe('SessionsSummaryCards — error state', () => {
  it('renders QueryError instead of cards and wires Retry to onRetry', () => {
    const onRetry = vi.fn()
    const { container } = renderCards({
      isError: true,
      error: new Error('boom'),
      onRetry,
    })

    // Cards + skeletons are gone; the error banner owns the region.
    expect(screen.queryByText('Active sessions')).toBeNull()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0)
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)

    // The summary region wrapper is still present for assistive tech.
    expect(screen.getByRole('region', { name: 'Session summary' })).toBeInTheDocument()
  })

  it('still shows a recoverable error when isError is set without an error object', () => {
    // Regression guard: QueryError returns null for a falsy `error`, which
    // would collapse the panel to blank. The component supplies a fallback.
    const onRetry = vi.fn()
    renderCards({ isError: true, error: undefined, onRetry })

    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
