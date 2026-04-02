import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Energy from './Energy'

vi.mock('../api', () => ({
  getVehicles: vi.fn().mockResolvedValue([
    { id: 1, vin: 'TEST123', display_name: 'My Tesla' },
  ]),
  getEnergyStats: vi.fn().mockResolvedValue({
    avg_efficiency_wh_km: 155,
    total_distance_km: 1200,
    co2_saved_kg: 42,
    daily_breakdown: [
      { date: '2024-01-09', energy_kwh: 20, cost: 5.0 },
      { date: '2024-01-10', energy_kwh: 25, cost: 6.5 },
    ],
  }),
  getChargingSessions: vi.fn().mockResolvedValue([
    {
      id: 1,
      vehicle_id: 1,
      charge_energy_added: 45,
      cost: 12.5,
      start_date: '2024-01-10T08:00:00Z',
      end_date: '2024-01-10T10:00:00Z',
      fast_charger_type: null,
    },
  ]),
}))

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({
    convertDistance: (v: number) => v,
    convertEfficiency: (v: number) => v,
    distanceUnit: 'km',
    efficiencyUnit: 'Wh/km',
  }),
}))

vi.mock('../components/Widgets', () => ({
  RadialGauge: ({ label }: { label: string }) => <div data-testid={`gauge-${label}`}>{label}</div>,
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}))

vi.mock('../components/Charts', () => ({
  ChartTooltip: () => null,
  axisTickSm: {},
  chartGrid: null,
}))

// Mock Recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ComposedChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
  Brush: () => null,
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
        <Energy />
      </BrowserRouter>
    </QueryClientProvider>,
  )

describe('Energy', () => {
  it('renders energy page header', () => {
    renderPage()
    expect(screen.getByText('Energy Intelligence')).toBeInTheDocument()
    expect(screen.getByText(/Deep cost analytics/)).toBeInTheDocument()
  })

  it('shows energy gauges', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByTestId('gauge-Energy Used')).toBeInTheDocument()
    })
    expect(screen.getByTestId('gauge-Efficiency')).toBeInTheDocument()
    expect(screen.getByTestId('gauge-Total Cost')).toBeInTheDocument()
  })

  it('shows quick metrics strip', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Cost per kWh')).toBeInTheDocument()
    })
    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Monthly Est.')).toBeInTheDocument()
    expect(screen.getByText('Yearly Est.')).toBeInTheDocument()
  })

  it('shows cost comparison cards', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Projected Annual')).toBeInTheDocument()
    })
  })

  it('shows energy consumption data', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Total Distance')).toBeInTheDocument()
    })
  })

  it('renders loading skeletons while loading', async () => {
    const api = await import('../api')
    vi.mocked(api.getEnergyStats).mockReturnValueOnce(new Promise(() => {}))

    renderPage()
    // Header should be visible immediately
    expect(screen.getByText('Energy Intelligence')).toBeInTheDocument()
  })
})
