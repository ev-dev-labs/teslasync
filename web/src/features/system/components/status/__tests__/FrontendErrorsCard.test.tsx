/**
 * FrontendErrorsCard tests.
 *
 * Covers every branch of the card:
 *   - loading (skeleton + aria-busy status region)
 *   - unable-to-load (hook returned no data)
 *   - healthy empty state (total === 0)
 *   - the total>0-but-no-offenders branch (the honest-state bug fix — must NOT
 *     claim "no errors" while a non-zero count is on screen)
 *   - populated list (names, routes, per-source counts, locale-grouped total)
 *   - defensive guards (non-array `top`, nullish entry fields)
 *   - accessibility (named region + decorative icon hidden from AT)
 *
 * The hook is mocked directly (module boundary) so each state is driven
 * deterministically without a QueryClient — mirrors TeslaApiUsageCard /
 * TelemetryPipelineCard. react-i18next is stubbed to echo keys so the
 * natural-language `t('…')` strings are asserted verbatim.
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { WebErrorsSummary, WebErrorsSummaryEntry } from '@/types/admin'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}))

interface HookState {
  data: WebErrorsSummary | undefined
  isLoading: boolean
}

const hookState: HookState = { data: undefined, isLoading: false }

vi.mock('@/api/hooks/useAdmin', () => ({
  useWebErrorsSummary: () => hookState,
}))

import { FrontendErrorsCard } from '../FrontendErrorsCard'

function makeSummary(overrides: Partial<WebErrorsSummary> = {}): WebErrorsSummary {
  return {
    window_seconds: 3600,
    windowSeconds: 3600,
    total: 0,
    top: [],
    as_of: '2025-01-15T12:00:00Z',
    asOf: '2025-01-15T12:00:00Z',
    ...overrides,
  }
}

function entry(over: Partial<WebErrorsSummaryEntry> = {}): WebErrorsSummaryEntry {
  return { name: 'TypeError', route: '/drives', count: 1, ...over }
}

beforeEach(() => {
  hookState.data = undefined
  hookState.isLoading = false
})

describe('FrontendErrorsCard — loading & unavailable', () => {
  it('renders a busy status region with skeletons while the summary is loading', () => {
    hookState.isLoading = true
    render(<FrontendErrorsCard />)

    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveAttribute('aria-busy', 'true')
    // No content region and no error copy while still loading.
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Unable to load frontend error summary.'),
    ).not.toBeInTheDocument()
  })

  it('shows an unable-to-load message when the hook yields no data', () => {
    hookState.data = undefined
    hookState.isLoading = false
    render(<FrontendErrorsCard />)

    expect(
      screen.getByText('Unable to load frontend error summary.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})

describe('FrontendErrorsCard — empty & healthy states', () => {
  it('renders the healthy empty state with a zero total when no errors reported', () => {
    hookState.data = makeSummary({ total: 0, top: [] })
    render(<FrontendErrorsCard />)

    expect(
      screen.getByText('No frontend errors reported in the last hour.'),
    ).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('reported by browser sessions')).toBeInTheDocument()
  })

  it('does NOT claim "no errors" when the total is positive but offenders are missing', () => {
    // Regression guard: a non-zero total with an empty `top` must surface the
    // honest breakdown-unavailable copy, not the contradictory healthy message.
    hookState.data = makeSummary({ total: 3, top: [] })
    render(<FrontendErrorsCard />)

    expect(
      screen.getByText('No per-source breakdown available for the reported errors.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No frontend errors reported in the last hour.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('treats a non-array `top` payload as empty instead of crashing', () => {
    hookState.data = makeSummary({
      total: 0,
      top: null as unknown as WebErrorsSummaryEntry[],
    })
    render(<FrontendErrorsCard />)

    expect(
      screen.getByText('No frontend errors reported in the last hour.'),
    ).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

describe('FrontendErrorsCard — populated list', () => {
  it('lists each offender with its name, route, and count', () => {
    hookState.data = makeSummary({
      total: 5,
      top: [
        entry({ name: 'TypeError', route: '/drives', count: 4 }),
        entry({ name: 'RangeError', route: '/charging', count: 1 }),
      ],
    })
    render(<FrontendErrorsCard />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(screen.getByText('TypeError')).toBeInTheDocument()
    expect(screen.getByText('/drives')).toBeInTheDocument()
    expect(screen.getByText('RangeError')).toBeInTheDocument()
    expect(screen.getByText('/charging')).toBeInTheDocument()
    // Per-source counts (4 and 1) plus the headline total (5).
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('formats large totals with locale grouping separators', () => {
    hookState.data = makeSummary({
      total: 12345,
      top: [entry({ name: 'TypeError', route: '/', count: 12345 })],
    })
    render(<FrontendErrorsCard />)

    expect(screen.getAllByText('12,345').length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to em-dashes and zero for nullish entry fields', () => {
    hookState.data = makeSummary({
      total: 2,
      top: [
        {
          name: undefined,
          route: undefined,
          count: undefined,
        } as unknown as WebErrorsSummaryEntry,
      ],
    })
    render(<FrontendErrorsCard />)

    // Missing name AND route both collapse to the em-dash placeholder.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // Missing count renders as 0 (per-source) alongside the total (2).
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})

describe('FrontendErrorsCard — accessibility', () => {
  it('exposes a named region and hides the decorative icon from assistive tech', () => {
    hookState.data = makeSummary({ total: 0, top: [] })
    const { container } = render(<FrontendErrorsCard />)

    expect(
      screen.getByRole('region', { name: 'Frontend errors (last hour)' }),
    ).toBeInTheDocument()
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})
