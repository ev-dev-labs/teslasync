/**
 * BatteryRangeCharts — behaviour + regression coverage.
 *
 * The component owns two GlassPanels: a battery overview (radial gauge +
 * headline battery / range values + a Current/Remaining bar chart) and a
 * recent-drives distance-trend area chart that degrades to an <EmptyState>.
 *
 * Recharts' <ResponsiveContainer> measures 0×0 under jsdom, so the real chart
 * bodies never paint. This suite therefore replaces the shared `@/components/
 * charts` barrel with light stand-ins that (a) render their children and
 * (b) surface the `data` prop as JSON — making the two memoised chart-data
 * derivations (battery split, SI→display drive trend) directly assertable and
 * deterministic. `AnimatedNumber` is likewise stubbed to skip its
 * requestAnimationFrame tween and render the final value synchronously.
 *
 * It also locks in the hardening applied while elevating the file:
 *   - REGRESSION (real bug): the headline "Range" value called
 *     `convertDistanceFromSI(state.rated_range, …)` with NO `?? 0`, unlike the
 *     drive-trend series which already guarded `distance_m ?? 0`. A `null`
 *     battery/range (the Go API can serialise one) leaked `NaN` into the gauge,
 *     bar chart, and headline. `battery_level`/`rated_range` are now coerced to
 *     0 once so every consumer shares a non-NaN value.
 *   - the "Remaining" battery slice is clamped to ≥ 0 so bad (>100) data can't
 *     paint a negative bar.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` returns the English
 * default, and `useUnits` is stubbed with a mutable distance preference so a
 * single test can flip km→mi. No network is touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { VehicleState, Drive } from '@/api/types'

// Mutable distance preference shared with the `useUnits` mock below.
const unitState = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi' }))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { distance: unitState.distance } }),
}))

// Echo the English fallback so assertions read naturally.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// Render the resolved value synchronously (skip the rAF tween from 0).
vi.mock('@/components/data-display', () => ({
  AnimatedNumber: ({
    value,
    prefix,
    suffix,
  }: {
    value: number
    prefix?: string
    suffix?: string
  }) => (
    <span data-testid="animated-number">
      {prefix}
      {value}
      {suffix}
    </span>
  ),
}))

// Light chart stand-ins: containers render children; data-bearing charts and
// the radial gauge surface their props for assertion.
vi.mock('@/components/charts', () => ({
  RadialGauge: ({
    value,
    color,
    label,
  }: {
    value: number
    color?: string
    label: string
  }) => (
    <div
      data-testid="radial-gauge"
      data-value={String(value)}
      data-color={color}
      aria-label={label}
    />
  ),
  ChartTooltip: () => null,
  CHART_COLORS: ['#06b6d4', '#a855f7'],
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ data, children }: { data?: unknown; children?: ReactNode }) => (
    <div data-testid="bar-chart" data-series={JSON.stringify(data)}>
      {children}
    </div>
  ),
  AreaChart: ({ data, children }: { data?: unknown; children?: ReactNode }) => (
    <div data-testid="area-chart" data-series={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Area: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  AREA_DEFAULTS: {},
  areaGradient: () => null,
}))

import { BatteryRangeCharts } from './BatteryRangeCharts'

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 50,
    rated_range: 400_000,
    ideal_range: 420_000,
    odometer: 1_000_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.0',
    ...overrides,
  }
}

function makeDrive(overrides: Partial<Drive> = {}): Drive {
  return {
    id: 1,
    vehicle_id: 1,
    start_ts: '2026-01-01T10:00:00Z',
    end_ts: '2026-01-01T11:00:00Z',
    duration_s: 3600,
    distance_m: 40_000,
    start_address: null,
    end_address: null,
    start_lat: null,
    start_lon: null,
    end_lat: null,
    end_lon: null,
    start_soc_pct: 80,
    end_soc_pct: 70,
    energy_used_wh: null,
    regen_energy_wh: null,
    avg_speed_mps: null,
    max_speed_mps: null,
    avg_power_w: null,
    outside_temp_avg_c: null,
    inside_temp_avg_c: null,
    score: null,
    ended_status: null,
    created_at: '2026-01-01T11:00:00Z',
    updated_at: '2026-01-01T11:00:00Z',
    ...overrides,
  }
}

/** Parse the JSON `data` prop captured by a mocked chart stand-in. */
function seriesOf(testId: 'bar-chart' | 'area-chart'): Array<Record<string, unknown>> {
  return JSON.parse(screen.getByTestId(testId).dataset.series ?? '[]')
}

beforeEach(() => {
  unitState.distance = 'km'
})

describe('BatteryRangeCharts — structure & a11y', () => {
  it('always renders both panel headings with decorative, aria-hidden icons', () => {
    render(<BatteryRangeCharts state={makeState()} drives={[]} />)

    const batteryHeading = screen.getByRole('heading', { level: 3, name: 'Battery Overview' })
    const trendHeading = screen.getByRole('heading', { level: 3, name: 'Drive Distance Trend' })
    expect(batteryHeading).toBeInTheDocument()
    expect(trendHeading).toBeInTheDocument()

    // The lucide glyphs are decorative — hidden from assistive tech so they do
    // not pollute the headings' accessible names.
    expect(batteryHeading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(trendHeading.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('BatteryRangeCharts — battery overview panel', () => {
  it('renders the headline battery % and gauge value from state', () => {
    render(<BatteryRangeCharts state={makeState({ battery_level: 42 })} drives={[]} />)

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByTestId('radial-gauge').dataset.value).toBe('42')
  })

  it('renders the rated range converted to the user distance unit (km)', () => {
    render(<BatteryRangeCharts state={makeState({ rated_range: 400_000 })} drives={[]} />)
    // 400 000 m ÷ 1000 = 400 km.
    expect(screen.getByText('400 km')).toBeInTheDocument()
  })

  it('re-converts the rated range when the distance preference is miles', () => {
    unitState.distance = 'mi'
    render(<BatteryRangeCharts state={makeState({ rated_range: 1_609_344 })} drives={[]} />)
    // 1 609 344 m ÷ 1609.344 = 1000 mi — proves the unit boundary is live.
    expect(screen.getByText('1000 mi')).toBeInTheDocument()
    expect(screen.queryByText(/ km$/)).toBeNull()
  })

  it('colours the gauge by battery threshold (green > 60 ≥ amber > 25 ≥ red)', () => {
    const { rerender } = render(
      <BatteryRangeCharts state={makeState({ battery_level: 70 })} drives={[]} />,
    )
    expect(screen.getByTestId('radial-gauge').dataset.color).toBe('#10b981')

    rerender(<BatteryRangeCharts state={makeState({ battery_level: 40 })} drives={[]} />)
    expect(screen.getByTestId('radial-gauge').dataset.color).toBe('#f59e0b')

    rerender(<BatteryRangeCharts state={makeState({ battery_level: 10 })} drives={[]} />)
    expect(screen.getByTestId('radial-gauge').dataset.color).toBe('#ef4444')
  })

  it('splits the bar chart into Current / Remaining that sum to 100', () => {
    render(<BatteryRangeCharts state={makeState({ battery_level: 30 })} drives={[]} />)

    expect(seriesOf('bar-chart')).toEqual([
      { name: 'Current', value: 30 },
      { name: 'Remaining', value: 70 },
    ])
  })
})

describe('BatteryRangeCharts — drive distance trend', () => {
  it('maps drives oldest→newest, converting metres→km and seconds→minutes', () => {
    // Input is newest-first (as the API returns); the component reverses it.
    const drives = [
      makeDrive({ id: 2, start_ts: '2026-01-02T10:00:00Z', distance_m: 20_000, duration_s: 1800 }),
      makeDrive({ id: 1, start_ts: '2026-01-01T10:00:00Z', distance_m: 40_000, duration_s: 3600 }),
    ]
    render(<BatteryRangeCharts state={makeState()} drives={drives} />)

    // No empty-state placeholder when data is present.
    expect(screen.queryByRole('status')).toBeNull()

    const series = seriesOf('area-chart')
    expect(series).toHaveLength(2)
    // Reversed: the older 40 km / 60 min drive comes first.
    expect(series[0].distance).toBe(40)
    expect(series[0].duration).toBe(60)
    expect(series[1].distance).toBe(20)
    expect(series[1].duration).toBe(30)
  })

  it('coerces a drive with null distance / duration to 0 (no NaN)', () => {
    const drives = [
      makeDrive({
        distance_m: null as unknown as number,
        duration_s: null as unknown as number,
      }),
    ]
    render(<BatteryRangeCharts state={makeState()} drives={drives} />)

    const series = seriesOf('area-chart')
    expect(series[0].distance).toBe(0)
    expect(series[0].duration).toBe(0)
  })

  it('shows the empty state (never a blank panel) when there are no drives', () => {
    render(<BatteryRangeCharts state={makeState()} drives={[]} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No drive data for chart')).toBeInTheDocument()
    expect(screen.queryByTestId('area-chart')).toBeNull()
  })

  it('does not crash and shows the empty state when drives is undefined', () => {
    expect(() =>
      render(<BatteryRangeCharts state={makeState()} drives={undefined} />),
    ).not.toThrow()
    expect(screen.getByText('No drive data for chart')).toBeInTheDocument()
  })
})

describe('BatteryRangeCharts — null-safety (the hardening this test guards)', () => {
  it('coerces a null battery_level / rated_range to 0 without leaking NaN', () => {
    const { container } = render(
      <BatteryRangeCharts
        state={makeState({
          battery_level: null as unknown as number,
          rated_range: null as unknown as number,
        })}
        drives={[]}
      />,
    )

    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('0 km')).toBeInTheDocument()
    expect(screen.getByTestId('radial-gauge').dataset.value).toBe('0')
    // Remaining stays a full 100 % rather than collapsing to NaN.
    expect(seriesOf('bar-chart')).toEqual([
      { name: 'Current', value: 0 },
      { name: 'Remaining', value: 100 },
    ])
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it('coerces an undefined battery_level / rated_range to 0 (regression: was NaN)', () => {
    const { container } = render(
      <BatteryRangeCharts
        state={makeState({
          battery_level: undefined as unknown as number,
          rated_range: undefined as unknown as number,
        })}
        drives={[]}
      />,
    )

    // Pre-hardening `100 - undefined` / `convertDistanceFromSI(undefined, …)`
    // both produced NaN here.
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('0 km')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/NaN/)
  })

  it('clamps the Remaining slice to ≥ 0 for out-of-range (>100) battery data', () => {
    render(<BatteryRangeCharts state={makeState({ battery_level: 120 })} drives={[]} />)

    expect(seriesOf('bar-chart')).toEqual([
      { name: 'Current', value: 120 },
      { name: 'Remaining', value: 0 },
    ])
  })
})
