import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../api', () => ({
  getVehicles: vi.fn().mockResolvedValue([
    {
      id: 1, vehicle_id: 100, vin: '5YJ3E1EA1NF000001',
      display_name: 'My Tesla', model: 'Model 3', trim_badging: 'LR',
      exterior_color: 'White', wheel_type: 'Aero', state: 'online',
      healthy: true, created_at: '2024-01-01', updated_at: '2024-01-01',
    },
  ]),
  getChargingSessions: vi.fn().mockResolvedValue([]),
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

vi.mock('recharts', () => ({
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => null,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}))

import Charging from './Charging'

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

describe('Charging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    const { container } = renderPage(<Charging />)
    await waitFor(() => {
      expect(container.querySelector('div')).toBeTruthy()
    })
  })

  it('renders page header with Charging Sessions title', async () => {
    renderPage(<Charging />)
    await waitFor(() => {
      expect(screen.getByText('Charging Sessions')).toBeInTheDocument()
    })
  })

  it('shows empty state when no charging sessions', async () => {
    renderPage(<Charging />)
    await waitFor(() => {
      expect(screen.getByText('No charging sessions yet')).toBeInTheDocument()
    })
  })

  it('shows empty state description', async () => {
    renderPage(<Charging />)
    await waitFor(() => {
      expect(screen.getByText(/Charging data will appear here/)).toBeInTheDocument()
    })
  })

  it('renders charging sessions when data exists', async () => {
    const api = await import('../api')
    vi.mocked(api.getChargingSessions).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T22:00:00Z',
        end_date: '2024-06-16T06:00:00Z', address_id: null,
        charge_energy_added: 45.2, charge_energy_used: null,
        start_battery_level: 20, end_battery_level: 90,
        start_range_km: 80, end_range_km: 360,
        charger_phases: 1, charger_voltage: 240, charger_actual_current: 32,
        charger_power: 7.7, fast_charger_type: null, fast_charger_brand: null,
        conn_charge_cable: 'SAE', cost: 5.42, duration_min: 480,
        latitude: null, longitude: null, location_name: 'Home Garage',
        inside_temp_avg: null, outside_temp_avg: null,
      },
    ])

    renderPage(<Charging />)
    await waitFor(() => {
      const matches = screen.getAllByText(/45\.2 kWh/)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows cost information in session card', async () => {
    const api = await import('../api')
    vi.mocked(api.getChargingSessions).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T22:00:00Z',
        end_date: '2024-06-16T06:00:00Z', address_id: null,
        charge_energy_added: 45.2, charge_energy_used: null,
        start_battery_level: 20, end_battery_level: 90,
        start_range_km: 80, end_range_km: 360,
        charger_phases: null, charger_voltage: null, charger_actual_current: null,
        charger_power: null, fast_charger_type: null, fast_charger_brand: null,
        conn_charge_cable: null, cost: 5.42, duration_min: 480,
        latitude: null, longitude: null, location_name: null,
        inside_temp_avg: null, outside_temp_avg: null,
      },
    ])

    renderPage(<Charging />)
    await waitFor(() => {
      const matches = screen.getAllByText('$5.42')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows location name when available', async () => {
    const api = await import('../api')
    vi.mocked(api.getChargingSessions).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T22:00:00Z',
        end_date: '2024-06-16T06:00:00Z', address_id: null,
        charge_energy_added: 45.2, charge_energy_used: null,
        start_battery_level: 20, end_battery_level: 90,
        start_range_km: null, end_range_km: null,
        charger_phases: null, charger_voltage: null, charger_actual_current: null,
        charger_power: null, fast_charger_type: null, fast_charger_brand: null,
        conn_charge_cable: null, cost: null, duration_min: 480,
        latitude: null, longitude: null, location_name: 'Home Garage',
        inside_temp_avg: null, outside_temp_avg: null,
      },
    ])

    renderPage(<Charging />)
    await waitFor(() => {
      expect(screen.getByText('Home Garage')).toBeInTheDocument()
    })
  })

  it('shows charger type badge (Home / AC for non-fast)', async () => {
    const api = await import('../api')
    vi.mocked(api.getChargingSessions).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T22:00:00Z',
        end_date: '2024-06-16T06:00:00Z', address_id: null,
        charge_energy_added: 30, charge_energy_used: null,
        start_battery_level: 30, end_battery_level: 80,
        start_range_km: null, end_range_km: null,
        charger_phases: null, charger_voltage: null, charger_actual_current: null,
        charger_power: null, fast_charger_type: null, fast_charger_brand: null,
        conn_charge_cable: null, cost: null, duration_min: 300,
        latitude: null, longitude: null, location_name: null,
        inside_temp_avg: null, outside_temp_avg: null,
      },
    ])

    renderPage(<Charging />)
    await waitFor(() => {
      expect(screen.getByText('Home / AC')).toBeInTheDocument()
    })
  })

  it('shows summary stats when sessions exist', async () => {
    const api = await import('../api')
    vi.mocked(api.getChargingSessions).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T22:00:00Z',
        end_date: '2024-06-16T06:00:00Z', address_id: null,
        charge_energy_added: 45.2, charge_energy_used: null,
        start_battery_level: 20, end_battery_level: 90,
        start_range_km: null, end_range_km: null,
        charger_phases: null, charger_voltage: null, charger_actual_current: null,
        charger_power: 7, fast_charger_type: null, fast_charger_brand: null,
        conn_charge_cable: null, cost: 5.42, duration_min: 480,
        latitude: null, longitude: null, location_name: null,
        inside_temp_avg: null, outside_temp_avg: null,
      },
    ])

    renderPage(<Charging />)
    await waitFor(() => {
      const matches = screen.getAllByText('Sessions')
      expect(matches.length).toBeGreaterThanOrEqual(1)
      const energyMatches = screen.getAllByText('Energy')
      expect(energyMatches.length).toBeGreaterThanOrEqual(1)
      const costMatches = screen.getAllByText('Total Cost')
      expect(costMatches.length).toBeGreaterThanOrEqual(1)
    })
  })
})
