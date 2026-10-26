import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { CHART_COLORS_CB_SAFE, CHART_COLORS_DARK, CHART_COLORS_NEON, CHART_COLORS_NEON_DARK } from '@/lib/colors'
import { themePresets } from '@/components/ui/themePresets'
import { resolveChartPalette } from '@/hooks/useChartPalette'
import { TeslaApiUsageHistory } from '../TeslaApiUsageHistory'
import { calendarRangeToInstants } from '@/lib/dateRange'
const appearance = vi.hoisted(() => ({
  palette: 'cb_safe',
  modeId: 'dark',
  timezone: 'UTC',
}))
const selectedRange = vi.hoisted(() => ({ start: '2024-01-01', end: '2024-01-07' }))
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    ...selectedRange, timezone: appearance.timezone,
    ...calendarRangeToInstants({
      startDate: selectedRange.start, endDate: selectedRange.end, timezone: appearance.timezone,
    }),
  }),
}))
vi.mock('@/lib/timezone', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>()
  return {
    ...actual,
    useTimezone: (mode: Parameters<typeof actual.useTimezone>[0] = 'vehicle') =>
      actual.resolveTimezone(mode, 'Asia/Tokyo', appearance.timezone),
  }
})
const theme = {
  id: 'neon-cyan' as const, name: 'Signal Blue',
  primary: '#91b4d2', primaryRGB: '145, 180, 210',
  accent: '#b5a8c9', accentRGB: '181, 168, 201',
}
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => ({ data: { chart_palette: appearance.palette } }),
}))
vi.mock('@/components/ui/ThemeProvider', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui/ThemeProvider')>(),
  useTheme: () => ({
    theme,
    mode: themePresets.find(mode => mode.id === appearance.modeId)!,
  }),
}))
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: {
    locale: 'en-US', decimal_precision: 2, currency_symbol: '$',
    tz_display_default: 'user', timezone_user: appearance.timezone,
  }, settingsUnavailable: false }),
}));

const useHistory = vi.hoisted(() => vi.fn())
const chartContainer = vi.hoisted(() => vi.fn())
const chartBar = vi.hoisted(() => vi.fn())
const chartCell = vi.hoisted(() => vi.fn())
vi.mock('@/api/hooks/useTeslaUsage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/hooks/useTeslaUsage')>()),
  useTeslaUsageHistory: useHistory,
}))
vi.mock('react-i18next', () => ({
  // Mirrors i18next's missing-key plural resolution for the observed-buckets
  // call (defaultValue_one/other + provided-vars interpolation); every other
  // call renders its fallback exactly as before.
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) => {
      let out = fallback
      if (vars?.count === 1 && typeof vars.defaultValue_one === 'string') out = vars.defaultValue_one
      else if (vars?.count !== undefined && typeof vars.defaultValue_other === 'string') out = vars.defaultValue_other
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          if (k === 'count') out = out.replace(/\{\{\s*count\s*\}\}/g, String(v))
        }
      }
      return out
    },
  }),
}))
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (amount: number) => `$${amount.toFixed(4)}` }),
}))
vi.mock('@/components/ui', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/ui')>(),
  GlassPanel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Text: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Select: ({ onChange, options }: { onChange: (event: { target: { value: string } }) => void; options: { value: string; label: string }[] }) =>
    <select aria-label="Group by" onChange={e => onChange({ target: { value: e.target.value } })}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>,
}))
vi.mock('@/components/data-display', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/data-display')>(),
  UsageCard: ({ emptyMessage, bands, details }: { emptyMessage?: string; bands?: { label: string; value: string }[]; details?: { label: string; value: string }[] }) =>
    <section data-testid="breakdown">
      {emptyMessage}
      {bands?.map(band => <p key={band.label}>{band.label}: {band.value}</p>)}
      {details?.map(detail => <p key={detail.label}>{detail.label}: {detail.value}</p>)}
    </section>,
}))
vi.mock('@/components/charts', () => ({
  ChartContainer: (props: { title: string; loading?: boolean; empty?: boolean; emptyTitle?: string; emptyMessage?: string; emptyAction?: { label: string; onClick: () => void }; onRetry?: () => void; error?: unknown; data?: { bucket_start?: string; category?: string; usd?: number }[]; children?: ReactNode | ((state: { hiddenSeries?: undefined }) => ReactNode) }) => {
    chartContainer(props)
    const { title, loading, empty, error, data } = props
    return <section data-testid={title.includes('distribution') ? 'distribution' : 'trend'}>
      {title}: {loading ? 'loading' : error ? 'error' : empty ? 'empty' : data?.map(row => row.bucket_start ?? `${row.category}:${row.usd}`).join(',')}
      {empty && <>{props.emptyTitle}{props.emptyMessage}
        {props.emptyAction && <button onClick={props.emptyAction.onClick}>{props.emptyAction.label}</button>}
      </>}
      {!!error && props.onRetry && <button onClick={props.onRetry}>Retry</button>}
      {!loading && !error && !empty && (typeof props.children === 'function' ? props.children({}) : props.children)}
    </section>
  },
  BarChart: ({ children }: { children: ReactNode }) => <>{children}</>,
  Bar: (props: { dataKey: string; fill: string }) => { chartBar(props); return null }, ChartLegend: () => null,
  PieChart: ({ children }: { children: ReactNode }) => <>{children}</>,
  Pie: ({ children }: { children: ReactNode }) => <>{children}</>,
  Cell: (props: { fill: string }) => { chartCell(props); return null },
  ChartTooltip: () => null, ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  XAxis: () => null, YAxis: () => null, Tooltip: () => null,
  chartGrid: null, axisTick: {}, chartAnimationProps: () => ({}),
}))

const point = {
  bucket_start: '2024-01-01T00:00:00Z',
  signals: 150000, commands: 1000, data_requests: 500, wakes: 50, estimated_usd: 4,
}

beforeEach(() => {
  appearance.palette = 'cb_safe'
  appearance.modeId = 'dark'
  appearance.timezone = 'UTC'
  selectedRange.start = '2024-01-01'
  selectedRange.end = '2024-01-07'
  useHistory.mockReset()
  chartContainer.mockClear()
  chartBar.mockClear()
  chartCell.mockClear()
})

describe('Tesla usage selected history', () => {
  it('reacts to saved palette and mode changes across both charts without changing accessible costs or exports', () => {
    useHistory.mockReturnValue({ data: { points: [point], total: { ...point } }, isLoading: false, error: null, refetch: vi.fn() })
    const { rerender } = render(<TeslaApiUsageHistory />)
    const categories = ['Streaming signals', 'Commands', 'Data requests', 'Wakes']
    const keys = ['signals', 'commands', 'data_requests', 'wakes']
    const verify = (palette: readonly string[]) => {
      expect(chartCell.mock.calls.slice(-4).map(([props]) => props.fill)).toEqual(palette.slice(0, 4))
      expect(chartBar.mock.calls.slice(-4).map(([props]) => ({ key: props.dataKey, color: props.fill })))
        .toEqual(keys.map((key, index) => ({ key, color: palette[index] })))
      const [distribution, trend] = chartContainer.mock.calls.slice(-2).map(([props]) => props)
      expect(distribution.data).toEqual(categories.map((category, index) => ({ category, usd: 1, color: palette[index] })))
      expect(trend.data).toEqual([{ bucket_start: point.bucket_start, signals: 1, commands: 1, data_requests: 1, wakes: 1 }])
      for (const chart of [distribution, trend]) expect(chart.exportData).toEqual(chart.data)
    }
    verify(CHART_COLORS_DARK)
    appearance.palette = 'neon'
    rerender(<TeslaApiUsageHistory />)
    verify(CHART_COLORS_NEON_DARK)
    appearance.modeId = 'github-light'
    rerender(<TeslaApiUsageHistory />)
    const lightPalette = resolveChartPalette('neon', {
      theme, mode: themePresets.find(mode => mode.id === 'github-light')!,
    })
    expect(lightPalette).toEqual(CHART_COLORS_NEON)
    expect(lightPalette).not.toEqual(CHART_COLORS_NEON_DARK)
    verify(lightPalette)
    appearance.modeId = 'dark'
    rerender(<TeslaApiUsageHistory />)
    verify(CHART_COLORS_NEON_DARK)
    appearance.palette = 'cb_safe'
    appearance.modeId = 'github-light'
    rerender(<TeslaApiUsageHistory />)
    verify(CHART_COLORS_CB_SAFE)
  })
  it.each([
    { points: [point], expected: '1 observed bucket' },
    { points: [point, { ...point, bucket_start: '2024-01-02T00:00:00Z' }], expected: '2 observed buckets' },
  ])('selects the singular/plural observed-bucket message: $expected', ({ points, expected }) => {
    useHistory.mockReturnValue({ data: { points, total: { ...point } }, isLoading: false, error: null, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    expect(within(screen.getByRole('dialog')).getByText(expected)).toBeInTheDocument()
  })
  it.each([undefined, null])('does not fabricate accessible or exported costs without totals: %s', total => {
    useHistory.mockReturnValue({ data: { points: [], total }, isLoading: false, error: null, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    expect(chartContainer.mock.calls[0][0]).toMatchObject({ data: [], exportData: [] })
    expect(screen.getByTestId('distribution')).toHaveTextContent('empty')
  })

  it.each([0, -0.5, 0.125])('preserves measured category costs in accessible data and exports: %s', cost => {
    const total = {
      signals: cost * 150000, commands: cost * 1000,
      data_requests: cost * 500, wakes: cost * 50, estimated_usd: cost * 4,
    }
    useHistory.mockReturnValue({ data: { points: [], total }, isLoading: false, error: null, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    const distribution = chartContainer.mock.calls[0][0]
    expect(distribution.data).toEqual([
      { category: 'Streaming signals', usd: cost, color: CHART_COLORS_DARK[0] },
      { category: 'Commands', usd: cost, color: CHART_COLORS_DARK[1] },
      { category: 'Data requests', usd: cost, color: CHART_COLORS_DARK[2] },
      { category: 'Wakes', usd: cost, color: CHART_COLORS_DARK[3] },
    ])
    expect(distribution.exportData).toEqual(distribution.data)
  })

  it('formats unsupported costs as unknown while preserving finite zero, signed and fractional values', () => {
    useHistory.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    const formatters = chartContainer.mock.calls.flatMap(([props]) =>
      props.dataColumns.filter((column: { key: string }) => column.key !== 'category' && column.key !== 'bucket_start')
        .map((column: { format: (value: unknown) => string }) => column.format),
    )
    expect(formatters).toHaveLength(5)
    for (const format of formatters) {
      for (const value of [undefined, null, '', '0', false, {}, [], NaN, Infinity, -Infinity]) {
        expect(format(value)).toBe('—')
      }
      expect(format(0)).toBe('$0.0000')
      expect(format(-2)).toBe('$-2.0000')
      expect(format(0.125)).toBe('$0.1250')
      expect(format(-0.125)).toBe('$-0.1250')
    }
  })

  it('keeps populated chart data, accessible alternatives and exports when refresh fails, with a working retry', () => {
    const refetch = vi.fn()
    const data = { points: [point], total: { ...point } }
    useHistory.mockReturnValue({ data, isLoading: false, error: null, refetch })
    const { rerender } = render(<TeslaApiUsageHistory />)
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()

    useHistory.mockReturnValue({ data, isLoading: false, error: new Error('background refresh'), refetch })
    rerender(<TeslaApiUsageHistory />)
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Usage history could not be loaded. Try again.')
    expect(screen.getByTestId('trend')).toHaveTextContent(point.bucket_start)
    expect(screen.getByTestId('distribution')).toHaveTextContent('Streaming signals:1,Commands:1,Data requests:1,Wakes:1')
    const retainedCharts = chartContainer.mock.calls.slice(-2).map(([props]) => props)
    expect(retainedCharts[0]).toMatchObject({
      error: null, loading: false, empty: false, exportable: true,
      exportFilename: 'tesla-usage-distribution',
      ariaLabel: expect.any(String),
      data: expect.arrayContaining([{ category: 'Commands', usd: 1, color: CHART_COLORS_DARK[1] }]),
      dataColumns: [{ key: 'category', label: 'Billable category' }, { key: 'usd', label: 'Estimated USD', format: expect.any(Function) }],
    })
    expect(retainedCharts[1]).toMatchObject({
      error: null, loading: false, empty: false, exportable: true,
      exportFilename: 'tesla-usage-history',
      ariaLabel: expect.any(String),
      data: [{ bucket_start: point.bucket_start, signals: 1, commands: 1, data_requests: 1, wakes: 1 }],
      dataColumns: [
        { key: 'bucket_start', label: 'Bucket start', format: expect.any(Function) },
        ...['signals', 'commands', 'data_requests', 'wakes'].map(key => ({ key, label: expect.any(String), format: expect.any(Function) })),
      ],
    })
    for (const chart of retainedCharts) expect(chart.exportData).toEqual(chart.data)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refetch).toHaveBeenCalledTimes(1)

    useHistory.mockReturnValue({ data, isLoading: false, error: null, refetch })
    rerender(<TeslaApiUsageHistory />)
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('trend')).toHaveTextContent(point.bucket_start)
  })

  it('retains raw selected totals and category evidence with the real review drawer on refresh failure', () => {
    useHistory.mockReturnValue({ data: { points: [point], total: { ...point } }, isLoading: false, error: new Error('background refresh'), refetch: vi.fn() })
    const { container } = render(<MemoryRouter><TeslaApiUsageHistory /></MemoryRouter>)
    assertOperationalBriefDisclosure(document.body, 'Retained source')
    expect(container.querySelector('[data-operational-metric="api-requests"] [data-operational-value]')).toHaveTextContent('1,550')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 1,000 · $1.0000')
    expect(screen.getByRole('combobox', { name: 'Group by' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    expect(within(screen.getByRole('dialog')).getByText('1,550')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getAllByText(/Local observations only, not a Tesla invoice/).length).toBeGreaterThan(0)
  })

  it.each([
    ['2024-01-01', '2024-01-07', 'UTC', '2024-01-01T00:00:00.000Z', '2024-01-08T00:00:00.000Z', true],
    ['2024-03-10', '2024-03-10', 'America/Los_Angeles', '2024-03-10T08:00:00.000Z', '2024-03-11T07:00:00.000Z', true],
    ['2024-11-03', '2024-11-03', 'America/Los_Angeles', '2024-11-03T07:00:00.000Z', '2024-11-04T08:00:00.000Z', true],
    ['2024-03-10', '2024-03-10', 'Asia/Tokyo', '2024-03-09T15:00:00.000Z', '2024-03-10T15:00:00.000Z', true],
    ['2023-11-05', '2024-11-04', 'America/Los_Angeles', '2023-11-05T07:00:00.000Z', '2024-11-05T08:00:00.000Z', true],
    ['2024-01-08', '2024-01-07', 'UTC', '2024-01-08T00:00:00.000Z', '2024-01-08T00:00:00.000Z', false],
    ['2023-01-01', '2024-01-03', 'UTC', '2023-01-01T00:00:00.000Z', '2024-01-04T00:00:00.000Z', false],
  ] as const)('forwards shared %s through %s in %s with its exact bounds and limit', (start, end, timezone, from, to, enabled) => {
    Object.assign(selectedRange, { start, end })
    appearance.timezone = timezone
    useHistory.mockReturnValue({ data: undefined, isLoading: false, error: null, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    expect(useHistory).toHaveBeenLastCalledWith(from, to, 'day', enabled, timezone)
    expect(chartContainer.mock.calls).toHaveLength(2)
    if (!enabled) {
      expect(screen.getByTestId('breakdown')).toHaveTextContent('Select 1 to 366 calendar days')
    }
  })

  it('updates mounted history and visible bucket dates with the selected clock while keeping raw exports and costs', () => {
    const data = { points: [point], total: { ...point } }
    const original = structuredClone(data)
    useHistory.mockReturnValue({ data, isLoading: false, error: null, refetch: vi.fn() })
    appearance.timezone = 'America/Los_Angeles'
    const { rerender } = render(<TeslaApiUsageHistory />)
    expect(useHistory).toHaveBeenLastCalledWith(
      '2024-01-01T08:00:00.000Z', '2024-01-08T08:00:00.000Z', 'day', true, 'America/Los_Angeles',
    )
    expect(chartContainer.mock.calls.at(-1)![0].dataColumns[0].format(point.bucket_start)).toBe('Dec 31, 2023')
    appearance.timezone = 'Asia/Tokyo'
    rerender(<TeslaApiUsageHistory />)
    expect(useHistory).toHaveBeenLastCalledWith(
      '2023-12-31T15:00:00.000Z', '2024-01-07T15:00:00.000Z', 'day', true, 'Asia/Tokyo',
    )
    const trend = chartContainer.mock.calls.at(-1)![0]
    expect(trend.dataColumns[0].format(point.bucket_start)).toBe('Jan 1, 2024')
    expect(trend.exportData).toEqual([{ bucket_start: point.bucket_start, signals: 1, commands: 1, data_requests: 1, wakes: 1 }])
    expect(data).toEqual(original)
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 1,000 · $1.0000')
  })

  it('shows old observed history, four priced categories, and switches bucket selection', () => {
    useHistory.mockReturnValue({ data: { points: [point], total: { ...point } }, isLoading: false, error: null, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    assertOperationalBriefDisclosure(document.body, 'Local observations only, not a Tesla invoice', { contains: true })
    expect(useHistory).toHaveBeenLastCalledWith('2024-01-01T00:00:00.000Z', '2024-01-08T00:00:00.000Z', 'day', true, 'UTC')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Streaming signals: 150,000 · $1.0000')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 1,000 · $1.0000')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Data requests: 500 · $1.0000')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Wakes: 50 · $1.0000')
    expect(screen.getByTestId('trend')).toHaveTextContent('2024-01-01T00:00:00Z')
    expect(screen.getByTestId('distribution')).toHaveTextContent('Streaming signals:1,Commands:1,Data requests:1,Wakes:1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'week' } })
    expect(useHistory).toHaveBeenLastCalledWith('2024-01-01T00:00:00.000Z', '2024-01-08T00:00:00.000Z', 'week', true, 'UTC')
  })

  it.each([
    [{ isLoading: true, isPending: true, fetchStatus: 'fetching', error: null }, 'Loading selected usage…', 'loading'],
    [{ isLoading: false, error: new Error('unavailable') }, 'Usage history could not be loaded. Try again.', 'error'],
    [{ isLoading: false, isPending: true, fetchStatus: 'idle', error: null }, 'Source unavailable', 'empty'],
    [{ isLoading: false, isPending: true, fetchStatus: 'paused', error: null }, 'Refresh paused', 'empty'],
    [{ isLoading: true, isPending: true, fetchStatus: 'paused', error: null }, 'Refresh paused', 'empty'],
  ])('shows independent breakdown and trend states: %s', (state, message, chartState) => {
    useHistory.mockReturnValue({ ...state, data: undefined, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    expect(screen.getByTestId('breakdown')).toHaveTextContent(message)
    expect(screen.getByTestId('trend')).toHaveTextContent(chartState)
    expect(screen.getByTestId('distribution')).toHaveTextContent(chartState)
    expect(chartContainer.mock.calls[0][0]).toMatchObject({ data: [], exportData: [] })
    expect(screen.queryByText(/No observed Tesla billable traffic/)).not.toBeInTheDocument()
  })

  it.each(['paused', 'idle'] as const)('keeps unresolved %s sections recoverable without claiming observed absence', fetchStatus => {
    const refetch = vi.fn()
    useHistory.mockReturnValue({
      data: undefined, isPending: true, isLoading: false, fetchStatus, error: null, refetch,
    })
    const { rerender } = render(<TeslaApiUsageHistory />)
    for (const id of ['distribution', 'trend']) {
      const section = within(screen.getByTestId(id))
      expect(section.queryByText(/No observed Tesla billable traffic/)).not.toBeInTheDocument()
      fireEvent.click(section.getByRole('button', { name: 'Refresh' }))
    }
    expect(refetch).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('Loading source')).not.toBeInTheDocument()

    useHistory.mockReturnValue({
      data: { points: [point], total: { ...point } }, isPending: false,
      isLoading: false, fetchStatus: 'idle', error: null, refetch,
    })
    rerender(<TeslaApiUsageHistory />)
    expect(screen.getByTestId('trend')).toHaveTextContent(point.bucket_start)
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 1,000')
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument()
  })

  it.each([
    { points: [] },
    { points: [{ ...point, signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0 }] },
  ])('shows confirmed zero totals separately from empty observed buckets: %s', ({ points }) => {
      const total = { ...point, signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0 }
      useHistory.mockReturnValue({
        data: { points, total }, isSuccess: true, isPending: false,
        isLoading: false, fetchStatus: 'idle', error: null, refetch: vi.fn(),
      })
      render(<TeslaApiUsageHistory />)
      expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 0 · $0.0000')
      expect(screen.getByTestId('distribution')).toHaveTextContent('No observed Tesla billable traffic')
      expect(chartContainer.mock.calls[1][0].empty).toBe(points.length === 0)
      assertOperationalBriefDisclosure(document.body, 'Source available')
    },
  )

  it('labels retained zero evidence as retained during a paused refresh and recovers', () => {
    const data = { points: [], total: { ...point, signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0 } }
    useHistory.mockReturnValue({ data, isLoading: false, fetchStatus: 'paused', error: null, refetch: vi.fn() })
    const { rerender } = render(<TeslaApiUsageHistory />)
    assertOperationalBriefDisclosure(document.body, 'Retained source')
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 0 · $0.0000')
    useHistory.mockReturnValue({ data, isLoading: false, fetchStatus: 'idle', error: null, refetch: vi.fn() })
    rerender(<TeslaApiUsageHistory />)
    assertOperationalBriefDisclosure(document.body, 'Source available')
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
  })

  it('retains successful empty evidence on refresh failure and clears the warning after recovery', () => {
    const data = { points: [], total: { ...point, signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0 } }
    const refetch = vi.fn()
    useHistory.mockReturnValue({ data, isLoading: false, error: null, refetch })
    const { rerender } = render(<TeslaApiUsageHistory />)
    assertOperationalBriefDisclosure(document.body, 'Source available')
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    useHistory.mockReturnValue({ data, isLoading: false, error: new Error('refresh failed'), refetch })
    rerender(<TeslaApiUsageHistory />)
    assertOperationalBriefDisclosure(document.body, 'Retained source')
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Usage history could not be loaded. Try again.')
    expect(screen.getByTestId('distribution')).toHaveTextContent('No observed Tesla billable traffic')
    expect(screen.getByTestId('trend')).toHaveTextContent('No observed Tesla billable traffic')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(refetch).toHaveBeenCalledTimes(1)
    useHistory.mockReturnValue({ data, isLoading: false, error: null, refetch })
    rerender(<TeslaApiUsageHistory />)
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument()
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 0 · $0.0000')
  })

  it('recovers an initial failure from either chart without removing neighboring sections', () => {
    const refetch = vi.fn()
    useHistory.mockReturnValue({ data: undefined, isLoading: false, error: new Error('unavailable'), refetch })
    const { rerender } = render(<TeslaApiUsageHistory />)
    for (const id of ['distribution', 'trend']) {
      fireEvent.click(within(screen.getByTestId(id)).getByRole('button', { name: 'Retry' }))
    }
    expect(refetch).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Usage history could not be loaded')
    useHistory.mockReturnValue({ data: { points: [point], total: { ...point } }, isLoading: false, error: null, refetch })
    rerender(<TeslaApiUsageHistory />)
    expect(screen.getByTestId('trend')).toHaveTextContent(point.bucket_start)
    expect(screen.getByTestId('distribution')).toHaveTextContent('Commands:1')
  })
})
