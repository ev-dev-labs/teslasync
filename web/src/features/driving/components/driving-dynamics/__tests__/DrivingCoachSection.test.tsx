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
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>()
  const { chartTestDoubles } = await import('@/test/chartTestDoubles')
  return { ...actual, ...chartTestDoubles }
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

vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingCoach: () => ({
    data: mockCoachData,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }),
}))

function renderCoach(coachData: DrivingCoachData | undefined) {
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
    expect(screen.getByText('Driving Coach')).toBeInTheDocument()
    expect(screen.getByText('Style Breakdown')).toBeInTheDocument()

    // Every data-backed panel falls back to its own empty state.
    expect(screen.getByText('Drive more to see your style breakdown.')).toBeInTheDocument()
    expect(screen.getByText('Need at least 2 weeks of data for trend analysis.')).toBeInTheDocument()
    expect(screen.getByText('Recommendations will appear after more drives.')).toBeInTheDocument()
    expect(screen.getByText('Drive data will appear after your first trip.')).toBeInTheDocument()

    // Empty states expose role="status" for assistive tech — four panels.
    expect(screen.getAllByRole('status')).toHaveLength(4)

    // Gauge + caption render zeros rather than NaN/undefined.
    expect(screen.getByText('Driving Score')).toBeInTheDocument()
    expect(screen.getByText('0 drives analyzed')).toBeInTheDocument()
  })

  it('still renders the driving-pattern rows (at 0%) when there is no data', () => {
    renderCoach(undefined)
    // Patterns are always visible — they degrade to 0%, never disappear.
    expect(screen.getByText('Hard Acceleration')).toBeInTheDocument()
    expect(screen.getByText('Highway Driving')).toBeInTheDocument()
    expect(screen.getByText('Cold Starts')).toBeInTheDocument()
    // fmtNumber at the default precision renders "0.00%".
    expect(screen.getAllByText('0.00%').length).toBeGreaterThanOrEqual(5)
  })
})

describe('DrivingCoachSection — full data', () => {
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
    expect(screen.getByText('Hard Acceleration')).toBeInTheDocument()
    expect(screen.getAllByText('0.00%').length).toBeGreaterThanOrEqual(5)
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
    expect(screen.queryByText('Drive more to see your style breakdown.')).toBeNull()
    const stylePanel = screen.getByText('Style Breakdown').closest('div') as HTMLElement
    expect(within(stylePanel).getAllByText('0').length).toBeGreaterThanOrEqual(3)
  })
})
