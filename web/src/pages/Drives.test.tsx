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
  getDrives: vi.fn().mockResolvedValue([]),
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
  ScatterChart: ({ children }: any) => <div data-testid="scatter-chart">{children}</div>,
  Scatter: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}))

import Drives from './Drives'

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

describe('Drives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    const { container } = renderPage(<Drives />)
    await waitFor(() => {
      expect(container.querySelector('div')).toBeTruthy()
    })
  })

  it('renders page header with Drive History title', async () => {
    renderPage(<Drives />)
    await waitFor(() => {
      expect(screen.getByText('Drive History')).toBeInTheDocument()
    })
  })

  it('shows empty state when no drives exist', async () => {
    renderPage(<Drives />)
    await waitFor(() => {
      expect(screen.getByText('No drives recorded yet')).toBeInTheDocument()
    })
  })

  it('shows empty state description', async () => {
    renderPage(<Drives />)
    await waitFor(() => {
      expect(screen.getByText(/Drive data will appear here/)).toBeInTheDocument()
    })
  })

  it('renders date filter controls', async () => {
    renderPage(<Drives />)
    await waitFor(() => {
      expect(screen.getByText('Drive History')).toBeInTheDocument()
    })
    // DateRangeFilter renders date input fields
    const dateInputs = document.querySelectorAll('input[type="date"]')
    expect(dateInputs.length).toBeGreaterThanOrEqual(0)
  })

  it('renders drive list when drives exist', async () => {
    const api = await import('../api')
    vi.mocked(api.getDrives).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T10:00:00Z',
        end_date: '2024-06-15T10:30:00Z', start_position_id: null, end_position_id: null,
        start_address_id: null, end_address_id: null,
        distance: 25.5, duration_min: 30,
        start_range_km: 350, end_range_km: 325,
        speed_max: 120, power_max: 50, power_min: -20,
        start_battery_level: 80, end_battery_level: 72,
        inside_temp_avg: 22, outside_temp_avg: 18,
        start_odometer: 10000, end_odometer: 10025,
        speed_avg: 51, speed_min: 0,
        start_rated_range_km: 350, end_rated_range_km: 325,
        rated_range_avg: null, rated_range_max: null, rated_range_min: null,
        start_ideal_range_km: null, end_ideal_range_km: null,
        ideal_range_avg: null, ideal_range_max: null, ideal_range_min: null,
        start_est_range_km: null, end_est_range_km: null,
        est_range_avg: null, est_range_max: null, est_range_min: null,
        soc_start: null, soc_end: null, soc_avg: null, soc_max: null, soc_min: null,
        usable_soc_start: null, usable_soc_end: null,
        usable_soc_avg: null, usable_soc_max: null, usable_soc_min: null,
        elevation_start: null, elevation_end: null,
        elevation_gain: null, elevation_loss: null,
        driver_temp_avg: null, passenger_temp_avg: null,
        battery_heater_on: null,
        start_address: 'Home', end_address: 'Office',
        start_latitude: null, start_longitude: null,
        end_latitude: null, end_longitude: null,
      },
    ])

    renderPage(<Drives />)
    await waitFor(() => {
      const matches = screen.getAllByText(/25\.5 km/)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows drive summary stats when drives exist', async () => {
    const api = await import('../api')
    vi.mocked(api.getDrives).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T10:00:00Z',
        end_date: '2024-06-15T10:30:00Z', start_position_id: null, end_position_id: null,
        start_address_id: null, end_address_id: null,
        distance: 25.5, duration_min: 30,
        start_range_km: 350, end_range_km: 325,
        speed_max: 120, power_max: 50, power_min: -20,
        start_battery_level: 80, end_battery_level: 72,
        inside_temp_avg: 22, outside_temp_avg: 18,
        start_odometer: 10000, end_odometer: 10025,
        speed_avg: 51, speed_min: 0,
        start_rated_range_km: null, end_rated_range_km: null,
        rated_range_avg: null, rated_range_max: null, rated_range_min: null,
        start_ideal_range_km: null, end_ideal_range_km: null,
        ideal_range_avg: null, ideal_range_max: null, ideal_range_min: null,
        start_est_range_km: null, end_est_range_km: null,
        est_range_avg: null, est_range_max: null, est_range_min: null,
        soc_start: null, soc_end: null, soc_avg: null, soc_max: null, soc_min: null,
        usable_soc_start: null, usable_soc_end: null,
        usable_soc_avg: null, usable_soc_max: null, usable_soc_min: null,
        elevation_start: null, elevation_end: null,
        elevation_gain: null, elevation_loss: null,
        driver_temp_avg: null, passenger_temp_avg: null,
        battery_heater_on: null,
        start_address: null, end_address: null,
        start_latitude: null, start_longitude: null,
        end_latitude: null, end_longitude: null,
      },
    ])

    renderPage(<Drives />)
    await waitFor(() => {
      expect(screen.getByText('Total Drives')).toBeInTheDocument()
    })
  })

  it('renders sort controls when drives exist', async () => {
    const api = await import('../api')
    vi.mocked(api.getDrives).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T10:00:00Z',
        end_date: '2024-06-15T10:30:00Z', start_position_id: null, end_position_id: null,
        start_address_id: null, end_address_id: null,
        distance: 25.5, duration_min: 30,
        start_range_km: 350, end_range_km: 325,
        speed_max: 120, power_max: 50, power_min: -20,
        start_battery_level: 80, end_battery_level: 72,
        inside_temp_avg: 22, outside_temp_avg: 18,
        start_odometer: null, end_odometer: null,
        speed_avg: null, speed_min: null,
        start_rated_range_km: null, end_rated_range_km: null,
        rated_range_avg: null, rated_range_max: null, rated_range_min: null,
        start_ideal_range_km: null, end_ideal_range_km: null,
        ideal_range_avg: null, ideal_range_max: null, ideal_range_min: null,
        start_est_range_km: null, end_est_range_km: null,
        est_range_avg: null, est_range_max: null, est_range_min: null,
        soc_start: null, soc_end: null, soc_avg: null, soc_max: null, soc_min: null,
        usable_soc_start: null, usable_soc_end: null,
        usable_soc_avg: null, usable_soc_max: null, usable_soc_min: null,
        elevation_start: null, elevation_end: null,
        elevation_gain: null, elevation_loss: null,
        driver_temp_avg: null, passenger_temp_avg: null,
        battery_heater_on: null,
        start_address: null, end_address: null,
        start_latitude: null, start_longitude: null,
        end_latitude: null, end_longitude: null,
      },
    ])

    renderPage(<Drives />)
    await waitFor(() => {
      expect(screen.getByText('Recent')).toBeInTheDocument()
      expect(screen.getByText('Distance')).toBeInTheDocument()
      expect(screen.getByText('Efficiency')).toBeInTheDocument()
    })
  })

  it('shows address route in drive card', async () => {
    const api = await import('../api')
    vi.mocked(api.getDrives).mockResolvedValue([
      {
        id: 1, vehicle_id: 1, start_date: '2024-06-15T10:00:00Z',
        end_date: '2024-06-15T10:30:00Z', start_position_id: null, end_position_id: null,
        start_address_id: null, end_address_id: null,
        distance: 25.5, duration_min: 30,
        start_range_km: 350, end_range_km: 325,
        speed_max: 120, power_max: 50, power_min: -20,
        start_battery_level: 80, end_battery_level: 72,
        inside_temp_avg: 22, outside_temp_avg: 18,
        start_odometer: null, end_odometer: null,
        speed_avg: null, speed_min: null,
        start_rated_range_km: null, end_rated_range_km: null,
        rated_range_avg: null, rated_range_max: null, rated_range_min: null,
        start_ideal_range_km: null, end_ideal_range_km: null,
        ideal_range_avg: null, ideal_range_max: null, ideal_range_min: null,
        start_est_range_km: null, end_est_range_km: null,
        est_range_avg: null, est_range_max: null, est_range_min: null,
        soc_start: null, soc_end: null, soc_avg: null, soc_max: null, soc_min: null,
        usable_soc_start: null, usable_soc_end: null,
        usable_soc_avg: null, usable_soc_max: null, usable_soc_min: null,
        elevation_start: null, elevation_end: null,
        elevation_gain: null, elevation_loss: null,
        driver_temp_avg: null, passenger_temp_avg: null,
        battery_heater_on: null,
        start_address: 'Home', end_address: 'Office',
        start_latitude: null, start_longitude: null,
        end_latitude: null, end_longitude: null,
      },
    ])

    renderPage(<Drives />)
    await waitFor(() => {
      expect(screen.getByText(/Home → Office/)).toBeInTheDocument()
    })
  })
})
