/**
 * DrivingCoachSection — presentational contract + null-safety regression.
 *
 * DrivingCoachSection renders the "Driving Coach" block of the Driving
 * Dynamics page from a single `coachData` prop (produced upstream by
 * `useDrivingCoach`). It is pure/presentational — no data fetching — so
 * these tests drive it entirely through props and only stub i18n.
 *
 * Two real bugs this suite pins (both were latent NPEs):
 *   1. The driving-pattern rows read `coachData?.patterns.hard_accel_pct`.
 *      The optional chain stops at `coachData`, so once `coachData` is
 *      defined but the API omitted the (nominally-required) `patterns`
 *      object, `.hard_accel_pct` threw "Cannot read properties of
 *      undefined". Post-fix the chain is `coachData?.patterns?.…`.
 *   2. The style-breakdown bar + legend indexed
 *      `coachData.style_breakdown[style]` unconditionally. When
 *      `total_drives_analyzed > 0` gated the panel open but the API
 *      omitted `style_breakdown`, the index throw crashed the whole
 *      section. Post-fix it is `coachData.style_breakdown?.[style]`.
 *
 * The remaining cases lock the branch matrix: undefined data → four empty
 * states; full data → gauge value, style legend, recommendations, and the
 * per-drive table; the weekly-trend "need ≥2 weeks" threshold; and the
 * recommendation impact → badge mapping.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { DataStateSource } from '@/api/dataState'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

const paletteState = vi.hoisted(() => ({ colors: ['var(--semantic-info)', 'var(--semantic-purple)'] }))
vi.mock('@/hooks/useChartPalette', () => ({
  useChartPalette: () => paletteState.colors,
}))

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>()
  const { chartTestDoubles } = await import('@/test/chartTestDoubles')
  return {
    ...actual, ...chartTestDoubles,
    ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
    LineChart: ({ children, data }: { children: ReactNode; data: unknown[] }) =>
      <div data-testid="coach-trend-points" data-points={JSON.stringify(data)}>{children}</div>,
    Line: ({ stroke, dataKey, dot, connectNulls }: {
      stroke: string; dataKey: string; dot: { fill: string; r: number }; connectNulls: boolean;
    }) => <div data-testid="coach-trend-series" data-stroke={stroke} data-key={dataKey}
      data-dot={JSON.stringify(dot)} data-connect-nulls={String(connectNulls)} />,
    XAxis: () => null,
    YAxis: ({ domain }: { domain: number[] }) =>
      <div data-testid="coach-trend-domain" data-domain={JSON.stringify(domain)} />,
    Tooltip: () => null,
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  // Mirror i18next's t(key, defaultValue, options) shape closely enough
  // that `{{count}}`-style interpolation resolves — DrivingCoachSection
  // relies on it for the "{{count}} drives analyzed" caption.
  const interpolate = (template: string, opts?: Record<string, unknown>) =>
    opts
      ? template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts[k] ?? ''))
      : template
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, defOrOpts?: unknown, maybeOpts?: unknown) => {
        if (typeof defOrOpts === 'string') {
          const opts = maybeOpts && typeof maybeOpts === 'object'
            ? (maybeOpts as Record<string, unknown>)
            : undefined
          return interpolate(defOrOpts, opts)
        }
        if (defOrOpts && typeof defOrOpts === 'object') {
          const o = defOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return interpolate(o.defaultValue, o)
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import DrivingCoachSection from '../DrivingCoachSection'
import type {
  DrivingCoachData,
  CoachDriveScore,
  CoachRecommendation,
  CoachWeeklyTrend,
} from '@/types/driving'

function renderSection(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

// The section now owns its own useDrivingCoach subscription (slow analytics
// cadence) instead of receiving a prop from the page, so the coach model
// refreshes as drives complete. The hook is stubbed and driven by
// `renderCoach`.
let mockCoachData: DrivingCoachData | undefined
let mockCoachState: DataStateSource<DrivingCoachData> = {}
const retryCoach = vi.fn()

vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingCoach: () => ({
    data: mockCoachData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: retryCoach,
    ...mockCoachState,
  }),
}))

function renderCoach(coachData: DrivingCoachData | undefined) {
  mockCoachState = {}
  mockCoachData = coachData
  return renderSection(<DrivingCoachSection vehicleId="1" />)
}

const RECOMMENDATIONS: CoachRecommendation[] = [
  { category: 'acceleration', impact: 'high', tip: 'Ease off the accelerator below 40 km/h.' },
  { category: 'braking', impact: 'medium', tip: 'Coast earlier to capture more regen.' },
  { category: 'trips', impact: 'low', tip: 'Batch short errands into one trip.' },
]

const WEEKLY_TREND: CoachWeeklyTrend[] = [
  { week: 'W1', score: 71, efficiency: 168, drives: 6 },
  { week: 'W2', score: 79, efficiency: 160, drives: 8 },
  { week: 'W3', score: 82, efficiency: 158, drives: 7 },
]

const PER_DRIVE: CoachDriveScore[] = [
  { drive_id: 101, date: '2026-06-15T10:00:00Z', score: 88, style: 'efficient', efficiency: 152, distance: 42 },
  { drive_id: 102, date: '2026-06-16T10:00:00Z', score: 63, style: 'moderate', efficiency: 178, distance: 15 },
  { drive_id: 103, date: '2026-06-17T10:00:00Z', score: 34, style: 'aggressive', efficiency: 244, distance: 8 },
]

function makeCoachData(overrides: Partial<DrivingCoachData> = {}): DrivingCoachData {
  return {
    overall_score: 82,
    efficiency_wh_km: 165,
    best_efficiency_wh_km: 148,
    total_drives_analyzed: 20,
    style_breakdown: { efficient: 12, moderate: 5, aggressive: 3 },
    patterns: {
      hard_accel_pct: 18,
      hard_brake_pct: 11,
      highway_pct: 62,
      short_trip_pct: 24,
      cold_start_pct: 9,
    },
    weekly_trend: WEEKLY_TREND,
    recommendations: RECOMMENDATIONS,
    per_drive_scores: PER_DRIVE,
    ...overrides,
  }
}

describe('DrivingCoachSection — empty / undefined data', () => {
  it('shows all four empty states and a zeroed gauge when coachData is undefined', () => {
    renderCoach(undefined)

    // Section + panel scaffolding always renders (never a blank panel).
    expect(screen.getByRole('heading', { name: 'Vehicle coaching · last 30 days', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Style Breakdown')).toBeInTheDocument()

    // Every data-backed panel falls back to its own empty state.
    expect(screen.getByText('Drive more to see your style breakdown.')).toBeInTheDocument()
    expect(screen.getByText('Need at least 2 weeks of data for trend analysis.')).toBeInTheDocument()
    expect(screen.getByText('Recommendations will appear after more drives.')).toBeInTheDocument()
    expect(screen.getByText('Drive data will appear after your first trip.')).toBeInTheDocument()

    // Empty states expose role="status" for assistive tech — four panels.
    expect(screen.getAllByRole('status')).toHaveLength(6)

    // Gauge + caption render zeros rather than NaN/undefined.
    expect(screen.getByText('No vehicle-wide score available.')).toBeInTheDocument()
    expect(screen.queryByText('0 drives analyzed')).toBeNull()
  })

  it('still renders the driving-pattern rows (at 0%) when there is no data', () => {
    renderCoach(undefined)
    // Patterns are always visible — they degrade to 0%, never disappear.
    expect(screen.getByText('Driving Patterns')).toBeInTheDocument()
    expect(screen.getByText('No driving-pattern evidence available.')).toBeInTheDocument()
    // fmtNumber at the default precision renders "0.00%".
    expect(screen.queryByText('0.00%')).toBeNull()
  })
})

describe('DrivingCoachSection — full data', () => {
  it('keeps every score field available on mobile without changing desktop density', () => {
    const { container } = renderCoach(makeCoachData())
    expect(container.querySelector('.space-y-4')).toHaveClass(
      'max-md:[&_button]:min-h-11', 'max-md:[&_button]:min-w-11',
      'max-md:[&_input]:min-h-11', 'max-md:[&_select]:min-h-11',
    )
    for (const label of ['Date', 'Score', 'Style', 'Wh/km', 'Distance']) {
      const header = screen.getByRole('columnheader', { name: new RegExp(label) })
      expect(header).not.toHaveClass('hidden')
    }
  })

  it('recolors the populated score gauge without changing its reading or scale', () => {
    const view = renderCoach(makeCoachData())
    const gauge = screen.getByRole('meter', { name: /Efficiency comparison/ })
    expect(gauge).toHaveAttribute('aria-valuenow', '82')
    expect(gauge).toHaveAttribute('aria-valuemax', '100')
    expect(gauge.querySelector('[style]')).toHaveStyle({ backgroundColor: paletteState.colors[0] })
    expect(screen.getByTestId('coach-trend-points')).toHaveAttribute('data-points', JSON.stringify(WEEKLY_TREND))
    expect(screen.getByTestId('coach-trend-series')).toHaveAttribute('data-stroke', paletteState.colors[0])
    paletteState.colors = ['var(--semantic-purple)', 'var(--semantic-info)']
    view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
      <DrivingCoachSection vehicleId="1" />
    </QueryClientProvider></MemoryRouter>)
    const recolored = screen.getByRole('meter', { name: /Efficiency comparison/ })
    expect(recolored).toHaveAttribute('aria-valuenow', '82')
    expect(recolored).toHaveAttribute('aria-valuemax', '100')
    expect(recolored.querySelector('[style]')).toHaveStyle({ backgroundColor: paletteState.colors[0] })
    expect(screen.getByTestId('coach-trend-points')).toHaveAttribute('data-points', JSON.stringify(WEEKLY_TREND))
    expect(screen.getByTestId('coach-trend-series')).toHaveAttribute('data-stroke', paletteState.colors[0])
    expect(screen.getByTestId('coach-trend-series')).toHaveAttribute('data-key', 'score')
    expect(screen.getByTestId('coach-trend-series')).toHaveAttribute('data-dot', JSON.stringify({ fill: paletteState.colors[0], r: 3 }))
    expect(screen.getByTestId('coach-trend-series')).toHaveAttribute('data-connect-nulls', 'false')
    expect(screen.getByTestId('coach-trend-domain')).toHaveAttribute('data-domain', '[0,100]')
  })

  it.each([undefined, null, NaN, Infinity, -1, 1.5, '0'])(
    'keeps an invalid analyzed count unknown (%s)', value => {
      renderCoach(Object.assign(makeCoachData(), { total_drives_analyzed: value }))
      expect(screen.queryByText(/drives analyzed/)).toBeNull()
      expect(screen.queryByText('82')).toBeNull()
      expect(screen.getByText('No vehicle-wide score available.')).toBeInTheDocument()
    },
  )

  it('keeps missing style counts unknown and uses the original analyzed denominator', () => {
    renderCoach(makeCoachData({ total_drives_analyzed: 20, style_breakdown: { efficient: 5, moderate: 0 } }))
    const panel = screen.getByText('Style Breakdown').closest('div') as HTMLElement
    expect(within(panel).getByText('5')).toBeInTheDocument()
    expect(within(panel).getByText('0')).toBeInTheDocument()
    expect(within(panel).getByText('—')).toBeInTheDocument()
    expect(within(panel).getByTitle('efficient: 5 drives')).toHaveStyle({ width: '25%' })
    expect(within(panel).queryByTitle(/aggressive:/)).toBeNull()
  })

  it.each([null, NaN, Infinity, -1, 0.5, '0'])(
    'does not substitute zero for an invalid style count (%s)', value => {
      renderCoach(makeCoachData({
        style_breakdown: Object.assign({ efficient: 5, moderate: 2 }, { aggressive: value }),
      }))
      const panel = screen.getByText('Style Breakdown').closest('div') as HTMLElement
      expect(within(panel).getByText('—')).toBeInTheDocument()
      expect(within(panel).queryByText('0')).toBeNull()
      expect(within(panel).queryByTitle(/aggressive:/)).toBeNull()
    },
  )

  it('preserves valid signed and fractional measurements, including measured zero', () => {
    renderCoach(makeCoachData({
      overall_score: 0,
      efficiency_wh_km: -12.5,
      best_efficiency_wh_km: 0,
      patterns: { hard_accel_pct: 0, hard_brake_pct: 1.25, highway_pct: NaN, short_trip_pct: Infinity, cold_start_pct: 9 },
    }))
    expect(screen.getByText('-12.50 Wh/km')).toBeInTheDocument()
    expect(screen.getByText('0.00 Wh/km')).toBeInTheDocument()
    expect(screen.getByText('0.00%')).toBeInTheDocument()
    expect(screen.getByText('1.25%')).toBeInTheDocument()
    expect(screen.queryByText('NaN%')).toBeNull()
    expect(screen.queryByText('Infinity%')).toBeNull()
  })

  it('renders the overall score gauge, drives-analyzed caption, and efficiency stats', () => {
    renderCoach(makeCoachData())

    expect(screen.getByText('82')).toBeInTheDocument()
    expect(screen.getByText('20 drives analyzed')).toBeInTheDocument()

    // StatCards project SI Wh/km straight through fmtNumber.
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument()
    expect(screen.getByText('165.00 Wh/km')).toBeInTheDocument()
    expect(screen.getByText('Best Efficiency')).toBeInTheDocument()
    expect(screen.getByText('148.00 Wh/km')).toBeInTheDocument()
  })

  it('renders the style breakdown legend with per-style drive counts', () => {
    renderCoach(makeCoachData())

    // The style-breakdown empty state must be gone once drives exist.
    expect(screen.queryByText('Drive more to see your style breakdown.')).toBeNull()

    // Legend labels appear (they also appear as per-drive styles, so scope
    // to the Style Breakdown panel to assert the count next to each label).
    const stylePanel = screen.getByText('Style Breakdown').closest('div') as HTMLElement
    expect(within(stylePanel).getByText('12')).toBeInTheDocument() // efficient
    expect(within(stylePanel).getByText('5')).toBeInTheDocument()  // moderate
    expect(within(stylePanel).getByText('3')).toBeInTheDocument()  // aggressive
  })

  it('renders each recommendation tip with an impact badge', () => {
    renderCoach(makeCoachData())

    expect(screen.queryByText('Recommendations will appear after more drives.')).toBeNull()
    expect(screen.getByText('Ease off the accelerator below 40 km/h.')).toBeInTheDocument()
    expect(screen.getByText('Coast earlier to capture more regen.')).toBeInTheDocument()
    expect(screen.getByText('Batch short errands into one trip.')).toBeInTheDocument()
    // Impact severities render verbatim inside their badges.
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('medium')).toBeInTheDocument()
    expect(screen.getByText('low')).toBeInTheDocument()
  })

  it('renders the per-drive score table with a row per drive', () => {
    renderCoach(makeCoachData())

    expect(screen.queryByText('Drive data will appear after your first trip.')).toBeNull()
    const table = screen.getByRole('table')
    // Column headers.
    expect(within(table).getByText('Score')).toBeInTheDocument()
    expect(within(table).getByText('Style')).toBeInTheDocument()
    // Per-drive score badges (raw numbers) render for each row.
    expect(within(table).getByText('88')).toBeInTheDocument()
    expect(within(table).getByText('63')).toBeInTheDocument()
    expect(within(table).getByText('34')).toBeInTheDocument()
    // Style cells project the raw enum string.
    expect(within(table).getByText('aggressive')).toBeInTheDocument()
  })
})

describe('DrivingCoachSection — weekly-trend threshold', () => {
  it('omits only the redundant scores table for a ride-first caller', () => {
    mockCoachData = makeCoachData()
    renderSection(<DrivingCoachSection vehicleId="1" showPerDriveScores={false} />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('Per-Drive Scores')).toBeNull()
    expect(screen.getByText('Style Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Weekly Score Trend')).toBeInTheDocument()
    expect(screen.getByText('Driving Patterns')).toBeInTheDocument()
    expect(screen.getByText('Recommendations')).toBeInTheDocument()
    expect(screen.getByText('Avg Efficiency')).toBeInTheDocument()
  })
  it('shows the "need ≥2 weeks" empty state with a single week of data', () => {
    const data = makeCoachData({ weekly_trend: [WEEKLY_TREND[0]] })
    renderCoach(data)
    expect(
      screen.getByText('Need at least 2 weeks of data for trend analysis.'),
    ).toBeInTheDocument()
  })

  it('renders the trend chart (no empty state) once two weeks exist', () => {
    const data = makeCoachData({ weekly_trend: WEEKLY_TREND.slice(0, 2) })
    renderCoach(data)
    expect(screen.getByText('Weekly Score Trend')).toBeInTheDocument()
    expect(
      screen.queryByText('Need at least 2 weeks of data for trend analysis.'),
    ).toBeNull()
  })
})

describe('DrivingCoachSection — null-safety regressions', () => {
  it('does not crash when coachData is present but `patterns` is missing', () => {
    // Real API responses can omit the nominally-required patterns object.
    // Pre-fix `coachData?.patterns.hard_accel_pct` threw here.
    const data = makeCoachData({ patterns: undefined as unknown as DrivingCoachData['patterns'] })
    expect(() =>
      renderCoach(data),
    ).not.toThrow()
    // Pattern rows still render, degraded to 0%.
    expect(screen.getByText('No driving-pattern evidence available.')).toBeInTheDocument()
    expect(screen.queryByText('0.00%')).toBeNull()
  })

  describe('DrivingCoachSection — source lifecycle', () => {
    it.each([
      { isLoading: true, isFetching: true, fetchStatus: 'fetching' as const },
      { isError: true, error: new Error('initial coach failure') },
    ])('does not infer empty coaching results before resolved evidence', state => {
      mockCoachData = undefined
      mockCoachState = state
      renderSection(<DrivingCoachSection vehicleId="1" />)
      expect(screen.queryByText('0 drives analyzed')).toBeNull()
      expect(screen.queryByText('No vehicle-wide score available.')).toBeNull()
      expect(screen.queryByText('Drive more to see your style breakdown.')).toBeNull()
      expect(screen.queryByText('Recommendations will appear after more drives.')).toBeNull()
    })

    it('distinguishes active loading, initial pause and a successful zero-drive response', () => {
      mockCoachData = undefined
      mockCoachState = { isLoading: true, isFetching: true, fetchStatus: 'fetching' }
      const view = renderSection(<DrivingCoachSection vehicleId="1" />)
      expect(screen.queryByText(/initial evidence query is paused/)).toBeNull()
      mockCoachState = { isPending: true, fetchStatus: 'paused' }
      view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
        <DrivingCoachSection vehicleId="1" />
      </QueryClientProvider></MemoryRouter>)
      expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument()
      expect(screen.queryByText(/device is offline/i)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(retryCoach).toHaveBeenCalled()
      mockCoachState = {}
      mockCoachData = makeCoachData({ total_drives_analyzed: 0, recommendations: [], weekly_trend: [], per_drive_scores: [] })
      view.rerender(<MemoryRouter><QueryClientProvider client={new QueryClient()}>
        <DrivingCoachSection vehicleId="1" />
      </QueryClientProvider></MemoryRouter>)
      expect(screen.queryByText(/initial evidence query is paused/)).toBeNull()
      expect(screen.getByText('0 drives analyzed')).toBeInTheDocument()
    })

    it('retains readings after a refresh failure and removes the warning on recovery', () => {
      mockCoachData = makeCoachData()
      mockCoachState = { isError: true, error: new Error('coach refresh failed') }
      const client = new QueryClient()
      const content = <MemoryRouter><QueryClientProvider client={client}><DrivingCoachSection vehicleId="1" /></QueryClientProvider></MemoryRouter>
      const view = renderSection(<DrivingCoachSection vehicleId="1" />)
      expect(screen.getByText('82')).toBeInTheDocument()
      fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }))
      expect(retryCoach).toHaveBeenCalled()
      mockCoachState = {}
      view.rerender(content)
      expect(screen.queryByTestId('stale-refresh-warning')).toBeNull()
      expect(screen.getByText('82')).toBeInTheDocument()
    })
  })

  it('does not crash when style_breakdown is missing but drives were analyzed', () => {
    // total_drives_analyzed > 0 opens the style panel; pre-fix indexing an
    // undefined style_breakdown threw and blanked the whole section.
    const data = makeCoachData({
      total_drives_analyzed: 5,
      style_breakdown: undefined as unknown as DrivingCoachData['style_breakdown'],
    })
    expect(() =>
      renderCoach(data),
    ).not.toThrow()
    // The panel opened (not the empty state) and counts fell back to 0.
    expect(screen.getByText('Style Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Drive more to see your style breakdown.')).toBeInTheDocument()
    const stylePanel = screen.getByText('Style Breakdown').closest('div') as HTMLElement
    expect(within(stylePanel).queryByText('0')).toBeNull()
  })
})
