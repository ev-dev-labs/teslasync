import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { TeslaApiUsageHistory, toUtcUsageRange } from '../TeslaApiUsageHistory'
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' }, settingsUnavailable: false }),
}));

const useHistory = vi.hoisted(() => vi.fn())
vi.mock('@/api/hooks/useTeslaUsage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/hooks/useTeslaUsage')>()),
  useTeslaUsageHistory: useHistory,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}))
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (amount: number) => `$${amount.toFixed(4)}` }),
}))
vi.mock('@/components/forms', () => ({
  RangePicker: ({ onChange }: { onChange: (range: { start: string; end: string }) => void }) =>
    <button onClick={() => onChange({ start: '2024-01-01', end: '2024-01-07' })}>Older range</button>,
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
  ChartContainer: ({ title, loading, empty, error, data }: { title: string; loading?: boolean; empty?: boolean; error?: unknown; data?: { bucket_start?: string; category?: string; usd?: number }[]; children?: ReactNode }) =>
    <section data-testid={title.includes('distribution') ? 'distribution' : 'trend'}>{title}: {loading ? 'loading' : error ? 'error' : empty ? 'empty' : data?.map(row => row.bucket_start ?? `${row.category}:${row.usd}`).join(',')}</section>,
  BarChart: () => null, Bar: () => null, ChartLegend: () => null,
  PieChart: () => null, Pie: () => null, Cell: () => null,
  ChartTooltip: () => null, ResponsiveContainer: () => null,
  XAxis: () => null, YAxis: () => null, Tooltip: () => null,
  CHART_COLORS: ['red', 'blue', 'green', 'yellow'],
  chartGrid: null, axisTick: {}, chartAnimationProps: () => ({}),
}))

const point = {
  bucket_start: '2024-01-01T00:00:00Z',
  signals: 150000, commands: 1000, data_requests: 500, wakes: 50, estimated_usd: 4,
}

beforeEach(() => useHistory.mockReset())

describe('Tesla usage selected history', () => {
  it('retains raw selected totals and category evidence with the real review drawer on refresh failure', () => {
    useHistory.mockReturnValue({ data: { points: [point], total: { ...point } }, isLoading: false, error: new Error('background refresh'), refetch: vi.fn() })
    const { container } = render(<MemoryRouter><TeslaApiUsageHistory /></MemoryRouter>)
    expect(screen.getByText('Retained source')).toBeInTheDocument()
    expect(container.querySelector('[data-operational-metric="api-requests"] [data-operational-value]')).toHaveTextContent('1,550')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 1,000 · $1.0000')
    expect(screen.getByRole('combobox', { name: 'Group by' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }))
    expect(within(screen.getByRole('dialog')).getByText('1,550')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getAllByText(/Local observations only, not a Tesla invoice/).length).toBeGreaterThan(0)
  })

  it('uses exact UTC inclusive-date to exclusive-end conversion and rejects oversized or reversed windows', () => {
    expect(toUtcUsageRange({ start: '2024-01-01', end: '2024-01-07' })).toEqual({
      start: '2024-01-01T00:00:00.000Z', end: '2024-01-08T00:00:00.000Z',
    })
    expect(toUtcUsageRange({ start: '2024-01-08', end: '2024-01-07' })).toBeNull()
    expect(toUtcUsageRange({ start: '2023-01-01', end: '2024-01-03' })).toBeNull()
  })

  it('shows old observed history, four priced categories, and switches bucket selection', () => {
    useHistory.mockReturnValue({ data: { points: [point], total: { ...point } }, isLoading: false, error: null, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    expect(screen.getByText(/Local observations only, not a Tesla invoice/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Older range' }))
    expect(useHistory).toHaveBeenLastCalledWith('2024-01-01T00:00:00.000Z', '2024-01-08T00:00:00.000Z', 'day', true)
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Streaming signals: 150,000 · $1.0000')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Commands: 1,000 · $1.0000')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Data requests: 500 · $1.0000')
    expect(screen.getByTestId('breakdown')).toHaveTextContent('Wakes: 50 · $1.0000')
    expect(screen.getByTestId('trend')).toHaveTextContent('2024-01-01T00:00:00Z')
    expect(screen.getByTestId('distribution')).toHaveTextContent('Streaming signals:1,Commands:1,Data requests:1,Wakes:1')
    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'week' } })
    expect(useHistory).toHaveBeenLastCalledWith('2024-01-01T00:00:00.000Z', '2024-01-08T00:00:00.000Z', 'week', true)
  })

  it.each([
    [{ isLoading: true, error: null }, 'Loading selected usage…', 'loading'],
    [{ isLoading: false, error: new Error('unavailable') }, 'Usage history could not be loaded. Try again.', 'error'],
    [{ isLoading: false, error: null }, 'No observed Tesla billable traffic in this range.', 'empty'],
  ])('shows independent breakdown and trend states: %s', (state, message, chartState) => {
    useHistory.mockReturnValue({ ...state, data: undefined, refetch: vi.fn() })
    render(<TeslaApiUsageHistory />)
    expect(screen.getByTestId('breakdown')).toHaveTextContent(message)
    expect(screen.getByTestId('trend')).toHaveTextContent(chartState)
    expect(screen.getByTestId('distribution')).toHaveTextContent(chartState)
  })
})
