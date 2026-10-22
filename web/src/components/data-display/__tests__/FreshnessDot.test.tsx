import { act, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  FreshnessDot,
  FreshnessDotAuto,
  FRESHNESS_COLORS,
  type FreshnessQuery,
} from '../FreshnessDot'
import {formatDate, formatDateTime, formatTime, formatDateShort, formatDateWithDay, formatRelative, formatRelativeTime} from '@/lib/dateFormat'
import {formatRelativeDays} from '@/lib/dateConvert'

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
  it('keeps exactly one painted widget dot while fetching and announces the busy state', () => {
    const { container } = render(<FreshnessDot updatedAt={Date.now()} isFetching isStale={false} isError={false} edgeAligned />);
    expect(container.querySelectorAll('[data-role="freshness-dot"]')).toHaveLength(1);
    expect(container.querySelector('[data-role="freshness-dot"]')).toHaveClass('bg-[var(--semantic-info)]');
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button')).toBeDisabled();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
  it('uses a neutral, untimestamped indicator for static content instead of claiming freshness', () => {
    const { container } = render(<FreshnessDot updatedAt={null} isFetching={false} isStale={false} isError={false} untracked edgeAligned />);
    const control = screen.getByRole('button', { name: 'Data freshness: Never updated' });
    expect(control).toBeDisabled();
    expect(control).toHaveClass('!w-2.5');
    expect(container.querySelectorAll('[data-role="freshness-dot"]')).toHaveLength(1);
    expect(container.querySelector('[data-role="freshness-dot"]')).toHaveClass('bg-[var(--text-muted)]');
    expect(control).not.toHaveAccessibleName(/Up to date/);
  });
  it('uses the freshness dot itself as the icon-only refresh action', () => {
    const onRefresh = vi.fn()
    const { container } = render(
      <FreshnessDot
        updatedAt={Date.now()}
        isFetching={false}
        isStale={false}
        isError={false}
        onRefresh={onRefresh}
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
    render(
      <FreshnessDot
        updatedAt={now - 2 * 60_000}
        isFetching={false}
        isStale={false}
        isError={false}
        refreshIntervalMs={60_000}
      />,
    )
    // Stale renders as an outlined ring, not a filled amber dot.
    expect(screen.getByRole('button').querySelector('span.rounded-full')).toHaveClass(
      'border-[var(--semantic-warning)]',
      'bg-transparent',
    )
  })

  it('uses the 15-minute manual freshness window when no polling cadence is supplied', () => {
    const now = Date.now()
    render(
      <FreshnessDot
        updatedAt={now - 15 * 60_000}
        isFetching={false}
        isStale={false}
        isError={false}
        manual
      />,
    )
    // Stale renders as an outlined ring, not a filled amber dot.
    expect(screen.getByRole('button').querySelector('span.rounded-full')).toHaveClass(
      'border-[var(--semantic-warning)]',
      'bg-transparent',
    )
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
    // Dot-only: age and status live in the accessible name, never as text.
    const button = screen.getByRole('button', { name: 'Data freshness: Up to date · just now' })
    expect(container.getElementsByClassName(FRESHNESS_COLORS.fresh.dot)[0]).toBeInTheDocument()
    expect(button).toHaveClass('!h-7', '!w-7', '!min-h-0', '!min-w-0', '!p-0')
    expect(button).toBeDisabled()
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
    expect(screen.getByRole('button', { name: 'Data freshness: Up to date · 5m ago' })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Data freshness: Up to date · 3h ago' })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Data freshness: Up to date · 2d ago' })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Data freshness: Up to date · 3w ago' })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Data freshness: updating… · just now' })).toBeInTheDocument()
    // Busy swaps the dot for the shared spinner until data lands.
    expect(container.querySelector('span.rounded-full')).toBeNull()
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Data freshness: error' })).toBeInTheDocument()
    expect(container.getElementsByClassName(FRESHNESS_COLORS.error.dot)[0]).toBeInTheDocument()
  })

  it('flags stale state with amber dot', () => {
    render(
      <FreshnessDot
        updatedAt={Date.now() - 60_000}
        isFetching={false}
        isStale
        isError={false}
      />,
    )
    // Stale renders as an outlined ring, not a filled amber dot.
    const button = screen.getByRole('button', { name: 'Data freshness: Stale · 1m ago' })
    expect(button.querySelector('span.rounded-full')).toHaveClass(
      'border-[var(--semantic-warning)]',
      'bg-transparent',
    )
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
    expect(refresh).toHaveClass('!h-7', '!w-7', '!min-h-0', '!min-w-0', '!p-0')
    fireEvent.click(refresh)
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not call onRefresh while fetching', () => {
    const onRefresh = vi.fn()
    render(
      <FreshnessDot
        updatedAt={Date.now() - 1000}
        isFetching
        isStale={false}
        isError={false}
        onRefresh={onRefresh}
      />,
    )
    const refresh = screen.getByRole('button', { name: /Refresh data/ })
    expect(refresh).toBeDisabled()
    expect(refresh).toHaveClass('disabled:bg-transparent')
    fireEvent.click(refresh)
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
    // Fixed icon-button footprint (compact shrinks to !h-5 !w-5).
    expect(refresh).toHaveClass(...(compact
      ? ['!h-5', '!w-5', '!min-h-0', '!min-w-0', '!p-0']
      : ['!h-7', '!w-7', '!min-h-0', '!min-w-0', '!p-0']))
    expect(refresh).toHaveAccessibleName(
      'Refresh data · Stale · 1m ago · Source: Battery analytics',
    )
    expect(refresh).toHaveAccessibleDescription(expect.stringContaining('Source: Battery analytics'))

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
    expect(refresh).toHaveClass(...(compact ? ['!h-5', '!w-5'] : ['!h-7', '!w-7']))
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
    // Read-only renders a disabled button (never a status region) with the
    // same fixed footprint.
    const button = screen.getByRole('button', { name: 'Data freshness: Up to date · just now' })
    expect(button).toBeDisabled()
    expect(button).toHaveClass(...(compact ? ['!h-5', '!w-5'] : ['!h-7', '!w-7']))
    expect(button).not.toHaveClass('!min-h-11', '!min-w-11')
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
    expect(screen.getByRole('button', { name: 'Data freshness: Stale · 5m ago' })).toBeInTheDocument()
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
    const status = screen.getByRole('button')
    expect(status).toHaveAccessibleDescription(expect.stringContaining('Source: Battery analytics'))
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
    const failed = screen.getByRole('button', { name: 'Data freshness: error · 5m ago · Source: Battery analytics' })
    expect(failed).toHaveAccessibleDescription(expect.stringContaining('Last updated:'))
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
    const refresh = screen.getByRole('button', { name: 'Refresh data · error · 1m ago' })
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
    // In-flight state swaps the dot for the shared busy spinner (no ping
    // ring, no data-bg-refetch marker in the icon-only design).
    expect(container.querySelector('span.rounded-full')).toBeNull()
    expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse, .animate-ping')).toBeNull()
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
    render(
      <FreshnessDot
        updatedAt={Date.now() - 30_000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    // No title attribute in the icon-only design: the tooltip text is the
    // accessible description (accessible name + update line).
    expect(screen.getByRole('button')).toHaveAccessibleDescription(
      'Data freshness: updating… · just now · Updating…',
    )
  })

  it('keeps the standard "Last updated" tooltip when reduced-motion but not fetching', () => {
    reducedMotionMock.mockReturnValue(true)
    render(
      <FreshnessDot
        updatedAt={Date.now() - 30_000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByRole('button')).toHaveAccessibleDescription(
      expect.stringContaining('Last updated:'),
    )
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
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(
      <FreshnessDotAuto
        query={makeQuery({ refetch: refetch as unknown as FreshnessQuery['refetch'] })}
        refetchable={false}
      />,
    )
    // Read-only renders a disabled button (never a status region); clicks
    // never reach refetch.
    const button = screen.getByRole('button', { name: 'Data freshness: Up to date · just now' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(refetch).not.toHaveBeenCalled()
  })

  it('forces stale visual when forceStaleAfterMs threshold is exceeded', () => {
    const query = makeQuery({
      dataUpdatedAt: Date.now() - 10 * 60_000, // 10 minutes
      isStale: false,
    })
    render(
      <FreshnessDotAuto query={query} forceStaleAfterMs={5 * 60_000} />,
    )
    // Stale renders as an outlined ring, not a filled amber dot.
    expect(screen.getByRole('button').querySelector('span.rounded-full')).toHaveClass(
      'border-[var(--semantic-warning)]',
      'bg-transparent',
    )
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

    // Stale renders as an outlined ring; status + age move to the name.
    expect(screen.getByRole('button').querySelector('span.rounded-full')).toHaveClass(
      'border-[var(--semantic-warning)]',
      'bg-transparent',
    )
    expect(screen.getByRole('button', { name: 'Refresh data · Stale · 1m ago' })).toBeInTheDocument()
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
