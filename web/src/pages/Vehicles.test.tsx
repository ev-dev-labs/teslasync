import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../api', () => ({
  getVehicles: vi.fn().mockResolvedValue([]),
  syncVehicles: vi.fn().mockResolvedValue({ synced: 0, vehicles: [] }),
  deleteVehicle: vi.fn().mockResolvedValue(undefined),
  getVehicleState: vi.fn().mockResolvedValue({ state: null, live: false }),
  getVehicleStatus: vi.fn().mockReturnValue('offline'),
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

vi.mock('../components/data-display/TeslaCarViz', () => ({
  TeslaCarViz: () => <div data-testid="tesla-car-viz" />,
  TeslaCarMini: () => <div data-testid="tesla-car-mini" />,
  parseModelKey: vi.fn().mockReturnValue('model3'),
}))

import Vehicles from './Vehicles'

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

describe('Vehicles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    const { container } = renderPage(<Vehicles />)
    await waitFor(() => {
      expect(container.querySelector('div')).toBeTruthy()
    })
  })

  it('renders page header with Fleet Management title', async () => {
    renderPage(<Vehicles />)
    await waitFor(() => {
      expect(screen.getByText('Fleet Management')).toBeInTheDocument()
    })
  })

  it('shows sync button', async () => {
    renderPage(<Vehicles />)
    await waitFor(() => {
      expect(screen.getByText('Sync from Tesla')).toBeInTheDocument()
    })
  })

  it('shows empty state when no vehicles', async () => {
    renderPage(<Vehicles />)
    await waitFor(() => {
      expect(screen.getByText('No vehicles yet')).toBeInTheDocument()
    })
  })

  it('shows empty state description', async () => {
    renderPage(<Vehicles />)
    await waitFor(() => {
      expect(screen.getByText(/Connect your Tesla account and sync/)).toBeInTheDocument()
    })
  })

  it('renders vehicle cards when vehicles exist', async () => {
    const api = await import('../api')
    vi.mocked(api.getVehicles).mockResolvedValue([
      {
        id: 1, vehicle_id: 100, vin: '5YJ3E1EA1NF000001',
        display_name: 'My Model 3', model: 'Model 3', trim_badging: 'LR',
        exterior_color: 'White', wheel_type: 'Aero', state: 'online',
        healthy: true, created_at: '2024-01-01', updated_at: '2024-01-01',
      },
      {
        id: 2, vehicle_id: 200, vin: '5YJ3E1EA1NF000002',
        display_name: 'My Model Y', model: 'Model Y', trim_badging: 'P',
        exterior_color: 'Red', wheel_type: 'Sport', state: 'asleep',
        healthy: true, created_at: '2024-01-01', updated_at: '2024-01-01',
      },
    ])

    renderPage(<Vehicles />)
    await waitFor(() => {
      expect(screen.getByText('My Model 3')).toBeInTheDocument()
      expect(screen.getByText('My Model Y')).toBeInTheDocument()
    })
  })

  it('shows VIN in vehicle card', async () => {
    const api = await import('../api')
    vi.mocked(api.getVehicles).mockResolvedValue([
      {
        id: 1, vehicle_id: 100, vin: '5YJ3E1EA1NF000001',
        display_name: 'Test Car', model: 'Model 3', trim_badging: 'SR+',
        exterior_color: 'Black', wheel_type: 'Aero', state: 'online',
        healthy: true, created_at: '2024-01-01', updated_at: '2024-01-01',
      },
    ])

    renderPage(<Vehicles />)
    await waitFor(() => {
      expect(screen.getByText('5YJ3E1EA1NF000001')).toBeInTheDocument()
    })
  })

  it('shows fleet summary section with vehicles', async () => {
    const api = await import('../api')
    vi.mocked(api.getVehicles).mockResolvedValue([
      {
        id: 1, vehicle_id: 100, vin: '5YJ3E1EA1NF000001',
        display_name: 'Car 1', model: 'Model 3', trim_badging: 'LR',
        exterior_color: 'White', wheel_type: 'Aero', state: 'online',
        healthy: true, created_at: '2024-01-01', updated_at: '2024-01-01',
      },
    ])

    renderPage(<Vehicles />)
    await waitFor(() => {
      expect(screen.getByText('Vehicles')).toBeInTheDocument()
      expect(screen.getByText('All Vehicles')).toBeInTheDocument()
    })
  })
})
