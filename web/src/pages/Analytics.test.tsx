import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Analytics from './Analytics'

vi.mock('../api', () => ({
  getFleetAnalytics: vi.fn().mockResolvedValue({
    total_distance_km: 5000,
    total_energy_kwh: 800,
    avg_efficiency_wh_km: 160,
    total_drives: 120,
    total_cost: 250,
    vehicle_comparison: [
      { name: 'Model Y', distance: 3000, energy: 480, drives: 70, efficiency: 160 },
      { name: 'Model 3', distance: 2000, energy: 320, drives: 50, efficiency: 160 },
    ],
    drive_analytics: { avg_speed: 45, max_speed: 130 },
    charging_analytics: { avg_duration: 45 },
    battery_trend: [],
  }),
}))

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({
    convertDistance: (v: number) => v,
    convertSpeed: (v: number) => v,
    convertTemp: (v: number) => v,
    convertEfficiency: (v: number) => v,
    distanceUnit: 'km',
    speedUnit: 'km/h',
    tempUnit: '°C',
    efficiencyUnit: 'Wh/km',
  }),
}))

vi.mock('../components/Widgets', () => ({
  RadialGauge: ({ label }: { label: string }) => <div data-testid={`gauge-${label}`}>{label}</div>,
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}))

vi.mock('../components/Charts', () => ({
  ChartTooltip: () => null,
  axisTick: {},
  axisTickSm: {},
  chartGrid: null,
  safe: (v: number | null | undefined) => v ?? 0,
  fmt: (v: number) => String(Math.round(v)),
}))

vi.mock('../lib/colors', () => ({
  CHART_COLORS: ['#00f0ff', '#10b981', '#a855f7'],
}))

// Mock Recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  RadarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  Radar: () => null,
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  ScatterChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Scatter: () => null,
  ZAxis: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

const renderPage = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <Analytics />
      </BrowserRouter>
    </QueryClientProvider>,
  )

describe('Analytics', () => {
  it('renders analytics page header', () => {
    renderPage()
    expect(screen.getByText('Fleet Analytics')).toBeInTheDocument()
    expect(screen.getByText(/Deep-dive into driving patterns/)).toBeInTheDocument()
  })

  it('shows fleet analytics gauges', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('gauge-Distance')).toBeInTheDocument()
    })
    expect(screen.getByTestId('gauge-Drives')).toBeInTheDocument()
    expect(screen.getByTestId('gauge-Energy')).toBeInTheDocument()
    expect(screen.getByTestId('gauge-Efficiency')).toBeInTheDocument()
  })

  it('shows gas savings and CO2 data', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Gas Savings')).toBeInTheDocument()
    })
    expect(screen.getByText('CO2 Saved')).toBeInTheDocument()
  })

  it('shows tab navigation', () => {
    renderPage()
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Driving')).toBeInTheDocument()
    expect(screen.getByText('Charging')).toBeInTheDocument()
    expect(screen.getByText('Battery')).toBeInTheDocument()
  })

  it('shows vehicle comparison charts on overview tab', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Distance by Vehicle')).toBeInTheDocument()
    })
  })

  it('handles empty analytics data', async () => {
    const { getFleetAnalytics } = await import('../api')
    vi.mocked(getFleetAnalytics).mockResolvedValueOnce({
      total_distance_km: 0,
      total_energy_kwh: 0,
      avg_efficiency_wh_km: 0,
      total_drives: 0,
      total_cost: 0,
      vehicle_comparison: [],
      drive_analytics: null,
      charging_analytics: null,
      battery_trend: [],
    })

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BrowserRouter>
          <Analytics />
        </BrowserRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('No analytics data yet')).toBeInTheDocument()
    })
  })
})
