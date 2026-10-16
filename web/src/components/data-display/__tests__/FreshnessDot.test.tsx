import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  FreshnessDot,
  FreshnessDotAuto,
  FRESHNESS_COLORS,
  type FreshnessQuery,
} from '../FreshnessDot'
import {
  formatDate,
  formatDateTime,
  formatTime,
  formatDateShort,
  formatDateWithDay,
  formatRelative,
  formatRelativeTime,
  formatRelativeDays,
} from '@/lib/dateFormat'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      )
    },
  }),
}))

// `<FreshnessDot>` consults useReducedMotion via
// `useMotionPreference()`. We mock framer-motion's hook so individual tests
// can drive both motion-allowed and reduced-motion code paths without
// touching window.matchMedia (framer-motion v12 caches that at module load).
const reducedMotionMock = vi.fn<() => boolean | null>(() => false)
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotionMock(),
}))

// `<FreshnessDot>` reads locale + tz via `useDateFormat()` for its
// `title` attribute. Mock the hook so tests don't need a TanStack Query
// provider or a Router (both required by `useSettings` + `useTimezone`).
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    opts: {},
    tz: 'UTC',
    locale: 'en-US',
    formatDate,
    formatDateTime,
    formatTime,
    formatDateShort,
    formatDateWithDay,
    formatRelative,
    formatRelativeTime,
    formatRelativeDays,
  }),
}))

describe('FRESHNESS_COLORS', () => {
  it('exposes a dot + text color tier for every status', () => {
    expect(FRESHNESS_COLORS.fresh.dot).toBe('bg-[var(--semantic-success)]')
    expect(FRESHNESS_COLORS.fetching.dot).toBe('bg-[var(--semantic-info)]')
    expect(FRESHNESS_COLORS.stale.dot).toBe('bg-[var(--semantic-warning)]')
    expect(FRESHNESS_COLORS.error.dot).toBe('bg-[var(--semantic-danger)]')
  })
})

describe('FreshnessDot widget variant', () => {
  it('uses the freshness dot itself as the icon-only refresh action', () => {
    const onRefresh = vi.fn()
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now()}
        isFetching={false}
        isStale={false}
        isError={false}
        onRefresh={onRefresh}
        variant="widget"
      />,
    )

    const refresh = screen.getByRole('button', { name: /Refresh data/ })
    expect(refresh.querySelectorAll('span.rounded-full')).toHaveLength(1)
    expect(refresh.querySelector('span.rounded-full')).toHaveClass('bg-[var(--semantic-success)]')
    expect(refresh).toHaveAttribute('aria-describedby')
    expect(refresh).not.toHaveTextContent('Refresh data')
    fireEvent.click(refresh)
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(container.querySelector('svg.lucide-wifi, svg.lucide-wifi-off')).not.toBeInTheDocument()
  })

  it('uses one shared relative-time ticker for multiple indicators', () => {
    vi.useFakeTimers()
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const props = { updatedAt: Date.now(), isFetching: false, isStale: false, isError: false }
    const { unmount } = render(
      <>
        <FreshnessDot {...props} />
        <FreshnessDot {...props} />
        <FreshnessDot {...props} />
      </>,
    )
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    unmount()
    vi.clearAllTimers()
    vi.useRealTimers()
    setIntervalSpy.mockRestore()
  })

  it('pulses the widget dot twice when new data arrives', () => {
    vi.useFakeTimers()
    const props = { updatedAt: Date.now(), isFetching: false, isStale: false, isError: false, variant: 'widget' as const }
    const { container, rerender } = render(<FreshnessDot {...props} />)
    expect(container.querySelector('.animate-ping')).not.toBeInTheDocument()
    rerender(<FreshnessDot {...props} updatedAt={props.updatedAt + 1} />)
    expect(container.querySelector('.animate-ping')).toBeInTheDocument()
    expect(container.querySelector('.animate-ping')).toHaveClass('[animation-iteration-count:2]')
    act(() => vi.advanceTimersByTime(1600))
    expect(container.querySelector('.animate-ping')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('uses an outlined warning ring for stale data and a slow pulse for errors', () => {
    const props = { updatedAt: Date.now(), isFetching: false, isStale: false, isError: false, variant: 'widget' as const }
    const { container, rerender } = render(<FreshnessDot {...props} isStale />)
    expect(screen.getByRole('button').querySelector('span.rounded-full')).toHaveClass(
      'border-[var(--semantic-warning)]',
      'bg-transparent',
    )
    rerender(<FreshnessDot {...props} isError />)
    expect(screen.getByRole('button').querySelector('span.rounded-full')).toHaveClass(
      'animate-[pulse_2s_ease-in-out_infinite]',
    )
    expect(container.querySelector('svg.lucide-wifi, svg.lucide-wifi-off')).not.toBeInTheDocument()
  })
})

describe('FreshnessDot age thresholds', () => {
  it('marks automatically refreshed data stale at exactly two intervals', () => {
    const now = Date.now()
    const { container } = render(
      <FreshnessDot
        updatedAt={now - 2 * 60_000}
        isFetching={false}
        isStale={false}
        isError={false}
        refreshIntervalMs={60_000}
      />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.stale.dot)[0]).toBeInTheDocument()
  })

  it('uses the 15-minute manual freshness window when no polling cadence is supplied', () => {
    const now = Date.now()
    const { container } = render(
      <FreshnessDot
        updatedAt={now - 15 * 60_000}
        isFetching={false}
        isStale={false}
        isError={false}
        manual
      />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.stale.dot)[0]).toBeInTheDocument()
  })
})

describe('FreshnessDot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-02T00:00:00Z'))
    reducedMotionMock.mockReturnValue(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the fresh state when data is recent and not fetching', () => {
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 2_000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('just now')).toBeInTheDocument()
    expect(screen.getByText('just now')).toHaveClass(
      'inline-block', 'min-w-freshness-age', 'break-words', 'text-start', 'tabular-nums',
    )
    expect(screen.getByText('just now')).not.toHaveClass('min-w-[4.5rem]')
    expect(container.getElementsByClassName(FRESHNESS_COLORS.fresh.dot)[0]).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveClass('border-0', 'bg-transparent')
    expect(screen.getByRole('status')).not.toHaveClass('rounded-pill')
  })

  it('formats a 5-minute-old timestamp as "5m ago"', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 5 * 60_000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('5m ago')).toBeInTheDocument()
  })

  it('formats a 3-hour-old timestamp as "3h ago"', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 3 * 3600 * 1000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('3h ago')).toBeInTheDocument()
  })

  it('formats a 2-day-old timestamp as "2d ago"', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 2 * 86_400 * 1000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('2d ago')).toBeInTheDocument()
  })

  it('formats a 3-week-old timestamp as "3w ago"', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 3 * 604_800 * 1000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('3w ago')).toBeInTheDocument()
  })

  it('shows "updating…" while fetching', () => {
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('updating…')).toBeInTheDocument()
    expect(container.getElementsByClassName(FRESHNESS_COLORS.fetching.dot)[0]).toBeInTheDocument()
  })

  it('shows "error" with red dot when isError', () => {
    const { container } = render(
      <FreshnessDot
        updatedAt={null}
        isFetching={false}
        isStale={false}
        isError
      />,
    )
    expect(screen.getByText('error')).toBeInTheDocument()
    expect(container.getElementsByClassName(FRESHNESS_COLORS.error.dot)[0]).toBeInTheDocument()
  })

  it('flags stale state with amber dot', () => {
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 60_000}
        isFetching={false}
        isStale
        isError={false}
      />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.stale.dot)[0]).toBeInTheDocument()
  })

  it('hides relative time text in compact mode', () => {
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching={false}
        isStale={false}
        isError={false}
        compact
      />,
    )
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
    expect(container.querySelector('.min-w-freshness-age')).toBeNull()
  })

  it('calls onRefresh when clicked and not fetching', () => {
    const onRefresh = vi.fn()
    render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching={false}
        isStale={false}
        isError={false}
        onRefresh={onRefresh}
      />,
    )
    const refresh = screen.getByRole('button', { name: /Refresh data/ })
    expect(refresh).toHaveClass('border-0', 'bg-transparent', '!px-0')
    expect(refresh).not.toHaveClass('rounded-pill')
    fireEvent.click(refresh)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not call onRefresh while fetching', () => {
    const onRefresh = vi.fn()
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching
        isStale={false}
        isError={false}
        onRefresh={onRefresh}
      />,
    )
    const root = container.firstElementChild!
    expect(root).toBeDisabled()
    expect(root).toHaveClass('disabled:!bg-transparent')
    fireEvent.click(root)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps mobile refresh targets with compact=%s', (compact) => {
    const { rerender } = render(
      <FreshnessDot
        updatedAt={Date.now() - 60_000}
        isFetching={false}
        isStale
        isError={false}
        compact={compact}
        onRefresh={vi.fn()}
        source="Battery analytics"
      />,
    )
    const refresh = screen.getByRole('button')
    expect(refresh).toHaveClass('!min-h-11', '!min-w-11', 'md:!min-h-0', 'md:!min-w-0')
    expect(refresh).not.toHaveClass('!min-h-0')
    expect(refresh).toHaveAccessibleName(
      'Refresh data · Stale · 1m ago · Source: Battery analytics',
    )
    expect(refresh).toHaveAttribute('title', expect.stringContaining('Source: Battery analytics'))
    expect(refresh).toHaveClass(...(compact ? ['!p-0'] : ['!px-0', '!py-1.5']))

    rerender(
      <FreshnessDot
        updatedAt={Date.now() - 60_000}
        isFetching
        isStale
        isError={false}
        compact={compact}
        onRefresh={vi.fn()}
      />,
    )
    expect(refresh).toBeDisabled()
    expect(refresh).toHaveClass('!min-h-11', '!min-w-11', 'md:!min-h-0', 'md:!min-w-0')
  })

  it.each([false, true])('does not enlarge read-only status with compact=%s', (compact) => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching={false}
        isStale={false}
        isError={false}
        compact={compact}
      />,
    )
    expect(screen.getByRole('status')).not.toHaveClass('!min-h-11', '!min-w-11')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([false, true])('refreshes via Enter and Space with compact=%s', async (compact) => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching={false}
        isStale={false}
        isError={false}
        compact={compact}
        onRefresh={onRefresh}
      />,
    )
    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await user.keyboard('{Enter} ')
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('spells out stale status instead of relying on the amber dot alone', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 5 * 60_000}
        isFetching={false}
        isStale
        isError={false}
      />,
    )
    expect(screen.getByText('Stale · 5m ago')).toBeInTheDocument()
  })

  it('includes source provenance in the hover and accessible detail', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching={false}
        isStale={false}
        isError={false}
        source="Battery analytics"
      />,
    )
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('title', expect.stringContaining('Source: Battery analytics'))
    expect(status).toHaveAccessibleName(
      'Data freshness: Up to date · just now · Source: Battery analytics',
    )
  })

  it('retains the last successful age and source when a refresh fails', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 5 * 60_000}
        isFetching={false}
        isStale
        isError
        source="Battery analytics"
      />,
    )
    expect(screen.getByText('5m ago')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAccessibleName(
      'Data freshness: Error · 5m ago · Source: Battery analytics',
    )
    expect(screen.getByRole('status')).toHaveAttribute(
      'title', expect.stringContaining('Last updated:'),
    )
  })

  it('keeps error precedence while fetching and the native refresh disabled', () => {
    const onRefresh = vi.fn()
    render(
      <FreshnessDot
        updatedAt={Date.now() - 60_000}
        isFetching
        isStale
        isError
        onRefresh={onRefresh}
        compact
      />,
    )
    const refresh = screen.getByRole('button', { name: 'Refresh data · Error · 1m ago' })
    expect(refresh).toHaveAttribute('type', 'button')
    expect(refresh).toBeDisabled()
    fireEvent.click(refresh)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  // ── Background-refetch presentation ────────────────────────────────

  it('identifies background refetch without decorative dot loops', () => {
    reducedMotionMock.mockReturnValue(false)
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 30_000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.fetching.dot)[0]).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse, .animate-ping')).toBeNull()
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    // Sanity-check the data-attribute used by tooling/tests to spot the state.
    expect(container.querySelector('[data-bg-refetch="true"]')).not.toBeNull()
  })

  it('does not pulse during the initial fetch (no prior data)', () => {
    reducedMotionMock.mockReturnValue(false)
    const { container } = render(
      <FreshnessDot
        updatedAt={null}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    expect(container.querySelector('.animate-pulse, .animate-ping')).toBeNull()
    expect(container.querySelector('[data-bg-refetch="true"]')).toBeNull()
  })

  it('suppresses the pulse when prefers-reduced-motion is set', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 30_000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    expect(container.querySelector('.animate-pulse')).toBeNull()
    // The outer ping ring + spinning icon are also suppressed under reduce.
    expect(container.querySelector('.animate-ping')).toBeNull()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('falls back to an "Updating…" tooltip when reduced-motion + fetching', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 30_000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('title')).toBe('Updating…')
  })

  it('keeps the standard "Last updated" tooltip when reduced-motion but not fetching', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now() - 30_000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute('title')).toMatch(/^Last updated:/)
  })
})

function makeQuery(overrides: Partial<FreshnessQuery> = {}): FreshnessQuery {
  return {
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now() - 1000,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as FreshnessQuery
}

describe('FreshnessDotAuto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-02T00:00:00Z'))
    reducedMotionMock.mockReturnValue(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders fresh state from a healthy query', () => {
    const { container } = render(<FreshnessDotAuto query={makeQuery()} />)
    expect(container.getElementsByClassName(FRESHNESS_COLORS.fresh.dot)[0]).toBeInTheDocument()
  })

  it('passes refetch through as the click handler by default', () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(
      <FreshnessDotAuto query={makeQuery({ refetch: refetch as unknown as FreshnessQuery['refetch'] })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('omits the click handler when refetchable is false', () => {
    const { container } = render(
      <FreshnessDotAuto query={makeQuery()} refetchable={false} />,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('forces stale visual when forceStaleAfterMs threshold is exceeded', () => {
    const query = makeQuery({
      dataUpdatedAt: Date.now() - 10 * 60_000, // 10 minutes
      isStale: false,
    })
    const { container } = render(
      <FreshnessDotAuto query={query} forceStaleAfterMs={5 * 60_000} />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.stale.dot)[0]).toBeInTheDocument()
  })

  it('does not force stale when forceStaleAfterMs is below the data age', () => {
    const query = makeQuery({ dataUpdatedAt: Date.now() - 1000 })
    const { container } = render(
      <FreshnessDotAuto query={query} forceStaleAfterMs={5 * 60_000} />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.fresh.dot)[0]).toBeInTheDocument()
  })

  it('transitions to forced stale as the successful update ages', () => {
    const query = makeQuery({ dataUpdatedAt: Date.now() })
    const { container } = render(
      <FreshnessDotAuto query={query} forceStaleAfterMs={60_000} />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.fresh.dot)[0]).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_001)
    })

    expect(container.getElementsByClassName(FRESHNESS_COLORS.stale.dot)[0]).toBeInTheDocument()
    expect(screen.getByText('Stale · 1m ago')).toBeInTheDocument()
  })

  it('treats dataUpdatedAt=0 (never fetched) as null updatedAt', () => {
    const query = makeQuery({ dataUpdatedAt: 0 })
    render(<FreshnessDotAuto query={query} />)
    // No relative-time text should appear, but the dot still renders
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
  })

  it('shows error state when query.isError is true', () => {
    const { container } = render(
      <FreshnessDotAuto query={makeQuery({ isError: true })} />,
    )
    expect(container.getElementsByClassName(FRESHNESS_COLORS.error.dot)[0]).toBeInTheDocument()
  })
})
