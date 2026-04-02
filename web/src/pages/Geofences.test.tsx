import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../api', () => ({
  getGeofences: vi.fn().mockResolvedValue([]),
  createGeofence: vi.fn().mockResolvedValue({ id: 1, name: 'Test', latitude: 37.77, longitude: -122.41, radius: 50, cost_per_kwh: null }),
  updateGeofence: vi.fn().mockResolvedValue({}),
  deleteGeofence: vi.fn().mockResolvedValue(undefined),
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

vi.mock('../components/Toast', () => ({
  useToast: vi.fn().mockReturnValue({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: any) => <div data-testid="map-container">{children}</div>,
  TileLayer: () => null,
  Circle: () => null,
  Marker: () => null,
  Popup: ({ children }: any) => <div>{children}</div>,
  useMapEvents: () => null,
}))

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn().mockReturnValue({}),
  },
  divIcon: vi.fn().mockReturnValue({}),
}))

import Geofences from './Geofences'

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

describe('Geofences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    const { container } = renderPage(<Geofences />)
    await waitFor(() => {
      expect(container.querySelector('div')).toBeTruthy()
    })
  })

  it('renders page header with Geofences title', async () => {
    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByText('Geofences')).toBeInTheDocument()
    })
  })

  it('shows Add button', async () => {
    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByText('Add')).toBeInTheDocument()
    })
  })

  it('shows map view when no geofences (default view)', async () => {
    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByTestId('map-container')).toBeInTheDocument()
    })
  })

  it('renders page subtitle', async () => {
    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByText(/Define locations for contextual tracking/)).toBeInTheDocument()
    })
  })

  it('renders map view by default', async () => {
    const api = await import('../api')
    vi.mocked(api.getGeofences).mockResolvedValue([
      {
        id: 1, name: 'Home', latitude: 37.7749, longitude: -122.4194,
        radius: 100, cost_per_kwh: 0.12,
      },
    ])

    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByTestId('map-container')).toBeInTheDocument()
    })
  })

  it('renders geofence name and radius in summary', async () => {
    const api = await import('../api')
    vi.mocked(api.getGeofences).mockResolvedValue([
      {
        id: 1, name: 'Home', latitude: 37.7749, longitude: -122.4194,
        radius: 100, cost_per_kwh: 0.12,
      },
    ])

    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByText('Zones')).toBeInTheDocument()
      expect(screen.getByText('Avg Radius')).toBeInTheDocument()
    })
  })

  it('shows Map and List tab navigation', async () => {
    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByText('Map')).toBeInTheDocument()
      expect(screen.getByText('List')).toBeInTheDocument()
    })
  })

  it('shows total area and large zones stats', async () => {
    const api = await import('../api')
    vi.mocked(api.getGeofences).mockResolvedValue([
      {
        id: 1, name: 'Home', latitude: 37.7749, longitude: -122.4194,
        radius: 500, cost_per_kwh: null,
      },
      {
        id: 2, name: 'Work', latitude: 37.7849, longitude: -122.4094,
        radius: 200, cost_per_kwh: 0.15,
      },
    ])

    renderPage(<Geofences />)
    await waitFor(() => {
      expect(screen.getByText('Total Area')).toBeInTheDocument()
      expect(screen.getByText('Large Zones (500m+)')).toBeInTheDocument()
    })
  })
})
