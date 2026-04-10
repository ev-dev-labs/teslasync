import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('../api', () => ({
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
    gas_price_per_unit: 3.5,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
  }),
  updateSettings: vi.fn().mockResolvedValue({}),
  toggleAPISuspend: vi.fn().mockResolvedValue({}),
  getAuthURL: vi.fn().mockResolvedValue({ auth_url: 'https://auth.tesla.com', state: 'abc' }),
  getAuthStatus: vi.fn().mockResolvedValue({ authenticated: false }),
  refreshAuth: vi.fn().mockResolvedValue({ status: 'ok' }),
  disconnectAuth: vi.fn().mockResolvedValue({ status: 'ok' }),
  syncVehicles: vi.fn().mockResolvedValue({ synced: 0, vehicles: [] }),
  getVehicles: vi.fn().mockResolvedValue([]),
  getVersionInfo: vi.fn().mockResolvedValue({ version: '1.0.0', commit: 'abc123', build_time: '2024-01-01' }),
  getGasPriceStatus: vi.fn().mockResolvedValue({ enabled: false, current_price: null, last_polled: null, poll_interval: '7d' }),
  pollGasPrice: vi.fn().mockResolvedValue({}),
  toggleGasPrice: vi.fn().mockResolvedValue({}),
  updateGasPriceConfig: vi.fn().mockResolvedValue({}),
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

vi.mock('../components/ThemeProvider', () => ({
  useTheme: vi.fn().mockReturnValue({
    themeId: 'neon-cyan',
    modeId: 'dark',
    setTheme: vi.fn(),
    setMode: vi.fn(),
    setCustomColors: vi.fn(),
    themes: [
      { id: 'neon-cyan', name: 'Neon Cyan', primary: '#00f0ff', primaryRGB: '0,240,255', accent: '#a855f7', accentRGB: '168,85,247' },
    ],
    modes: [
      { id: 'dark', name: 'Dark' },
    ],
  }),
}))

import Settings from './Settings'

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

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', async () => {
    const { container } = renderPage(<Settings />)
    await waitFor(() => {
      expect(container.querySelector('div')).toBeTruthy()
    })
  })

  it('renders page header with Settings title', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Settings')).toBeInTheDocument()
    })
  })

  it('shows Tesla Account section', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Tesla Account')).toBeInTheDocument()
    })
  })

  it('shows connect button when not authenticated', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Connect Tesla Account')).toBeInTheDocument()
    })
  })

  it('shows Application settings section', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Application')).toBeInTheDocument()
    })
  })

  it('renders Distance Unit setting field', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Distance Unit')).toBeInTheDocument()
    })
  })

  it('renders Temperature Unit setting field', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Temperature Unit')).toBeInTheDocument()
    })
  })

  it('renders save button', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Save Settings')).toBeInTheDocument()
    })
  })

  it('shows Fleet API Settings section', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Fleet API Settings')).toBeInTheDocument()
    })
  })

  it('shows language selector', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Language')).toBeInTheDocument()
    })
  })

  it('shows preferred range selector', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Preferred Range')).toBeInTheDocument()
    })
  })

  it('shows electricity cost field', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Electricity Cost (per kWh)')).toBeInTheDocument()
    })
  })

  it('shows Gas Price Auto-Poll section', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Gas Price Auto-Poll')).toBeInTheDocument()
    })
  })

  it('shows connected status when authenticated', async () => {
    const api = await import('../api')
    vi.mocked(api.getAuthStatus).mockResolvedValue({ authenticated: true, expires_at: '2025-01-01T00:00:00Z' })

    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Connected')).toBeInTheDocument()
    })
  })

  it('shows not connected status when not authenticated', async () => {
    renderPage(<Settings />)
    await waitFor(() => {
      expect(screen.getByText('Not connected')).toBeInTheDocument()
    })
  })
})
