/**
 * TimelinePage — smoke tests.
 *
 * The page issues 2 useQuery calls (timeline + summary) and uses
 * URL state + range picker + vehicle selection. We mock the API
 * client to return empty payloads and verify the page renders
 * the EmptyState branches without crashing.
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

vi.mock('@/api/client', () => ({
  request: vi.fn().mockResolvedValue({
    vehicle_id: 1,
    days: 30,
    transitions: [],
    by_state: [],
    total_seconds: 0,
  }),
}))

const vehicles = [
  {
    id: 1,
    vehicle_id: 1001,
    vin: '5YJSA1E26HF000001',
    display_name: 'Model S',
    model: 'S',
    trim_badging: 'P100D',
    exterior_color: 'red',
    wheel_type: '21',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
]

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: vehicles, isLoading: false, error: null }),
}))

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 1,
    vehicles,
    setVehicleId: vi.fn(),
  }),
}))

import TimelinePage from './TimelinePage'

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TimelinePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TimelinePage', () => {
  it('renders without crashing with empty API responses', () => {
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })
})
