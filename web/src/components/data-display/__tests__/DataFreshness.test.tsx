import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  DataFreshness,
  DataFreshnessAuto,
  FRESHNESS_COLORS,
  type FreshnessQuery,
} from '../DataFreshness'
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

// `<DataFreshness>` consults useReducedMotion via
// `useMotionPreference()`. We mock framer-motion's hook so individual tests
// can drive both motion-allowed and reduced-motion code paths without
// touching window.matchMedia (framer-motion v12 caches that at module load).
const reducedMotionMock = vi.fn<() => boolean | null>(() => false)
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotionMock(),
}))

// `<DataFreshness>` reads locale + tz via `useDateFormat()` for its
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
    expect(FRESHNESS_COLORS.fresh.dot).toBe('bg-emerald-400')
    expect(FRESHNESS_COLORS.fetching.dot).toBe('bg-sky-400')
    expect(FRESHNESS_COLORS.stale.dot).toBe('bg-amber-400')
    expect(FRESHNESS_COLORS.error.dot).toBe('bg-red-400')
  })
})

describe('DataFreshness', () => {
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
      <DataFreshness
        updatedAt={Date.now() - 2_000}
        isFetching={false}
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('just now')).toBeInTheDocument()
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()
  })

  it('formats a 5-minute-old timestamp as "5m ago"', () => {
    render(
      <DataFreshness
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
      <DataFreshness
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
      <DataFreshness
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
      <DataFreshness
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
      <DataFreshness
        updatedAt={Date.now() - 1000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    expect(screen.getByText('updating…')).toBeInTheDocument()
    expect(container.querySelector('.bg-sky-400')).toBeInTheDocument()
  })

  it('shows "error" with red dot when isError', () => {
    const { container } = render(
      <DataFreshness
        updatedAt={null}
        isFetching={false}
        isStale={false}
        isError
      />,
    )
    expect(screen.getByText('error')).toBeInTheDocument()
    expect(container.querySelector('.bg-red-400')).toBeInTheDocument()
  })

  it('flags stale state with amber dot', () => {
    const { container } = render(
      <DataFreshness
        updatedAt={Date.now() - 60_000}
        isFetching={false}
        isStale
        isError={false}
      />,
    )
    expect(container.querySelector('.bg-amber-400')).toBeInTheDocument()
  })

  it('hides relative time text in compact mode', () => {
    render(
      <DataFreshness
        updatedAt={Date.now() - 1000}
        isFetching={false}
        isStale={false}
        isError={false}
        compact
      />,
    )
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
  })

  it('calls onRefresh when clicked and not fetching', () => {
    const onRefresh = vi.fn()
    render(
      <DataFreshness
        updatedAt={Date.now() - 1000}
        isFetching={false}
        isStale={false}
        isError={false}
        onRefresh={onRefresh}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not call onRefresh while fetching', () => {
    const onRefresh = vi.fn()
    const { container } = render(
      <DataFreshness
        updatedAt={Date.now() - 1000}
        isFetching
        isStale={false}
        isError={false}
        onRefresh={onRefresh}
      />,
    )
    const root = container.firstElementChild!
    expect(root).toBeDisabled()
    fireEvent.click(root)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('spells out stale status instead of relying on the amber dot alone', () => {
    render(
      <DataFreshness
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
      <DataFreshness
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

  // ── Background-refetch pulse ───────────────────────────────────────

  it('pulses the dot while a background refetch is in flight (isFetching with prior data)', () => {
    reducedMotionMock.mockReturnValue(false)
    const { container } = render(
      <DataFreshness
        updatedAt={Date.now() - 30_000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    // The inner colored dot (sky-400 because status === 'fetching') gets
    // animate-pulse on top of the existing animate-ping ring.
    const dot = container.querySelector('span.bg-sky-400.animate-pulse')
    expect(dot).not.toBeNull()
    // Sanity-check the data-attribute used by tooling/tests to spot the state.
    expect(container.querySelector('[data-bg-refetch="true"]')).not.toBeNull()
  })

  it('does not pulse during the initial fetch (no prior data)', () => {
    reducedMotionMock.mockReturnValue(false)
    const { container } = render(
      <DataFreshness
        updatedAt={null}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    // Initial load: ping ring stays, but no pulse on the inner dot.
    expect(container.querySelector('span.bg-sky-400.animate-pulse')).toBeNull()
    expect(container.querySelector('[data-bg-refetch="true"]')).toBeNull()
  })

  it('suppresses the pulse when prefers-reduced-motion is set', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = render(
      <DataFreshness
        updatedAt={Date.now() - 30_000}
        isFetching
        isStale={false}
        isError={false}
      />,
    )
    expect(container.querySelector('span.bg-sky-400.animate-pulse')).toBeNull()
    // The outer ping ring + spinning icon are also suppressed under reduce.
    expect(container.querySelector('.animate-ping')).toBeNull()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('falls back to an "Updating…" tooltip when reduced-motion + fetching', () => {
    reducedMotionMock.mockReturnValue(true)
    const { container } = render(
      <DataFreshness
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
      <DataFreshness
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

describe('DataFreshnessAuto', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-02T00:00:00Z'))
    reducedMotionMock.mockReturnValue(false)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders fresh state from a healthy query', () => {
    const { container } = render(<DataFreshnessAuto query={makeQuery()} />)
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()
  })

  it('passes refetch through as the click handler by default', () => {
    const refetch = vi.fn().mockResolvedValue(undefined)
    render(
      <DataFreshnessAuto query={makeQuery({ refetch: refetch as unknown as FreshnessQuery['refetch'] })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Refresh data/ }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('omits the click handler when refetchable is false', () => {
    const { container } = render(
      <DataFreshnessAuto query={makeQuery()} refetchable={false} />,
    )
    expect(container.querySelector('button')).toBeNull()
  })

  it('forces stale visual when forceStaleAfterMs threshold is exceeded', () => {
    const query = makeQuery({
      dataUpdatedAt: Date.now() - 10 * 60_000, // 10 minutes
      isStale: false,
    })
    const { container } = render(
      <DataFreshnessAuto query={query} forceStaleAfterMs={5 * 60_000} />,
    )
    expect(container.querySelector('.bg-amber-400')).toBeInTheDocument()
  })

  it('does not force stale when forceStaleAfterMs is below the data age', () => {
    const query = makeQuery({ dataUpdatedAt: Date.now() - 1000 })
    const { container } = render(
      <DataFreshnessAuto query={query} forceStaleAfterMs={5 * 60_000} />,
    )
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()
  })

  it('transitions to forced stale as the successful update ages', () => {
    const query = makeQuery({ dataUpdatedAt: Date.now() })
    const { container } = render(
      <DataFreshnessAuto query={query} forceStaleAfterMs={60_000} />,
    )
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_001)
    })

    expect(container.querySelector('.bg-amber-400')).toBeInTheDocument()
    expect(screen.getByText('Stale · 1m ago')).toBeInTheDocument()
  })

  it('treats dataUpdatedAt=0 (never fetched) as null updatedAt', () => {
    const query = makeQuery({ dataUpdatedAt: 0 })
    render(<DataFreshnessAuto query={query} />)
    // No relative-time text should appear, but the dot still renders
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
    expect(screen.queryByText('just now')).not.toBeInTheDocument()
  })

  it('shows error state when query.isError is true', () => {
    const { container } = render(
      <DataFreshnessAuto query={makeQuery({ isError: true })} />,
    )
    expect(container.querySelector('.bg-red-400')).toBeInTheDocument()
  })
})
