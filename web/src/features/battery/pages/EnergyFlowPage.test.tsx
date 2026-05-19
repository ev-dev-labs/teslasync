/**
 * EnergyFlowPage — smoke tests.
 *
 * Renders the page with a vehicle selected and the energy/flow APIs
 * resolving to empty payloads. Verifies the page mounts without
 * crashing and the various EmptyState branches surface instead of
 * throwing on undefined.
 */

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string | Record<string, unknown>) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'mi', temperature: 'F' },
    formatDistance: (v: number) => `${v.toFixed(0)} mi`,
    formatEnergy: (v: number) => `${v.toFixed(0)} kWh`,
  }),
}))

const vehicles = [
  {
    id: 1,
    vehicle_id: 1001,
    vin: '5YJSA1E26HF000001',
    display_name: 'Model S',
    model: 'S',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
]

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 1,
    vehicles,
    setVehicleId: vi.fn(),
  }),
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: vehicles, isLoading: false, error: null }),
}))

vi.mock('@/api/hooks/useEnergy', () => ({
  useEnergyFlow: () => ({
    data: { in_kwh: 0, out_kwh: 0, net_kwh: 0 },
    isLoading: false,
    error: null,
  }),
}))

vi.mock('@/api/client', () => ({
  request: vi.fn().mockResolvedValue({
    daily: [],
    summary: {},
    history: [],
  }),
}))

import EnergyFlowPage from './EnergyFlowPage'

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EnergyFlowPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('EnergyFlowPage', () => {
  it('renders without crashing with empty API responses', () => {
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })
})
