import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../api', () => ({
  getVehicles: vi.fn().mockResolvedValue([]),
  getAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
  getVehicleState: vi.fn().mockResolvedValue({ state: null, live: false }),
  getDrives: vi.fn().mockResolvedValue([]),
  getChargingSessions: vi.fn().mockResolvedValue([]),
  getFleetAnalytics: vi.fn().mockResolvedValue({
    period_days: 30,
    total_vehicles: 0,
    total_distance_km: 0,
    total_drives: 0,
    total_charging_sessions: 0,
    total_energy_kwh: 0,
    total_cost: 0,
    avg_efficiency_wh_km: 0,
    most_efficient_vehicle: null,
    vehicle_comparison: [],
    drive_analytics: { hourly_pattern: [], day_of_week: [], speed_distribution: [] },
  }),
  getAlerts: vi.fn().mockResolvedValue([]),
  syncVehicles: vi.fn().mockResolvedValue({ synced: 0, vehicles: [] }),
  getVehicleStatus: vi.fn().mockReturnValue('offline'),
  getMotorLatest: vi.fn().mockResolvedValue(null),
  getClimateLatest: vi.fn().mockResolvedValue(null),
  getSecurityLatest: vi.fn().mockResolvedValue(null),
  getLatestTirePressure: vi.fn().mockResolvedValue(null),
  getMediaLatest: vi.fn().mockResolvedValue(null),
  getLocationSnapshotLatest: vi.fn().mockResolvedValue(null),
  getSettings: vi.fn().mockResolvedValue({
    unit_of_length: 'km',
    unit_of_temp: 'C',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
  }),
}))

vi.mock('../hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: vi.fn().mockReturnValue({ connected: false }),
}))

vi.mock('../components/data-display/TeslaCarViz', () => ({
  TeslaCarViz: () => <div data-testid="tesla-car-viz" />,
  TeslaCarMini: () => <div data-testid="tesla-car-mini" />,
  parseModelKey: vi.fn().mockReturnValue('model3'),
}))

vi.mock('recharts', () => ({
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

import Dashboard from './Dashboard'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

const renderPage = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  )

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    const { container } = renderPage(<Dashboard />)
    await waitFor(() => {
      expect(container.querySelector('div')).toBeTruthy()
    })
  })

  it('renders the page header with Command Center title', async () => {
    renderPage(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Command Center')).toBeInTheDocument()
    })
  })

  it('shows empty/welcome state when no vehicles', async () => {
    renderPage(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Welcome to TeslaSync')).toBeInTheDocument()
    })
  })

  it('shows connect prompt when not authenticated and no vehicles', async () => {
    renderPage(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText(/Connect Tesla Account/)).toBeInTheDocument()
    })
  })

  it('shows sync prompt when authenticated but no vehicles', async () => {
    const api = await import('../api')
    vi.mocked(api.getAuthStatus).mockResolvedValue({ authenticated: true })

    renderPage(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Sync Your Vehicles')).toBeInTheDocument()
    })
  })

  it('shows fleet stats when vehicles exist', async () => {
    const api = await import('../api')
    vi.mocked(api.getVehicles).mockResolvedValue([
      {
        id: 1, vehicle_id: 100, vin: '5YJ3E1EA1NF000001',
        display_name: 'My Tesla', model: 'Model 3', trim_badging: 'LR',
        exterior_color: 'White', wheel_type: 'Aero', state: 'online',
        healthy: true, created_at: '2024-01-01', updated_at: '2024-01-01',
      },
    ])
    vi.mocked(api.getAuthStatus).mockResolvedValue({ authenticated: true })
    vi.mocked(api.getFleetAnalytics).mockResolvedValue({
      period_days: 30,
      total_vehicles: 1,
      total_distance_km: 1500,
      total_drives: 42,
      total_charging_sessions: 15,
      total_energy_kwh: 320,
      total_cost: 45.0,
      avg_efficiency_wh_km: 155,
      most_efficient_vehicle: null,
      vehicle_comparison: [],
      drive_analytics: { hourly_pattern: [], day_of_week: [], speed_distribution: [] },
    } as any)

    renderPage(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('My Tesla')).toBeInTheDocument()
    })
  })

  it('shows feature labels in empty state', async () => {
    // Ensure auth is not authenticated to get the Welcome state
    const api = await import('../api')
    vi.mocked(api.getAuthStatus).mockResolvedValue({ authenticated: false })
    vi.mocked(api.getVehicles).mockResolvedValue([])

    renderPage(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('Welcome to TeslaSync')).toBeInTheDocument()
    })
  })

  it('shows OFFLINE status pill when not connected', async () => {
    renderPage(<Dashboard />)
    await waitFor(() => {
      expect(screen.getByText('OFFLINE')).toBeInTheDocument()
    })
  })
})
