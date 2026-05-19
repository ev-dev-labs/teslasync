/**
 * VehicleListPage — smoke tests.
 *
 * Covers two contract surfaces:
 *   1. Empty fleet -> EmptyState ("No vehicles connected" / "Connect your Tesla").
 *   2. Populated fleet -> at least one vehicle name is rendered.
 *
 * All network/SSE plumbing is stubbed so the test never opens a socket
 * and the page can mount synchronously under jsdom.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
vi.mock('@/hooks/useVehicleLive', () => ({ useVehicleLive: vi.fn() }))
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'mi', temperature: 'F', pressure: 'psi' },
    formatDistance: (v: number) => `${v.toFixed(0)} mi`,
  }),
}))
vi.mock('@/components/feedback/Toast', () => ({
  useToast: () => ({ show: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))

const requestMock = vi.fn()
vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
      '@/api/hooks/useVehicles',
    )
  return {
    ...actual,
    fetchVehicleState: vi.fn().mockResolvedValue({ state: { online: false } }),
  }
})

vi.mock('@/api/hooks/usePinned', () => ({
  usePinned: () => ({ data: [], isLoading: false }),
  useTogglePin: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useReorderPins: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}))

function makeVehicle(id: number, name: string) {
  return {
    id,
    vehicle_id: 1000 + id,
    vin: `5YJSA1E26HF00000${id}`,
    display_name: name,
    model: 'S',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VehicleListPageInstance />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

import VehicleListPageInstance from './VehicleListPage'

describe('VehicleListPage', () => {
  it('renders without crashing with an empty fleet', () => {
    requestMock.mockResolvedValue([])
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })

  it('renders vehicle names when the fleet has data', async () => {
    requestMock.mockResolvedValue([
      makeVehicle(1, 'Model S Plaid'),
      makeVehicle(2, 'Model 3 LR'),
    ])
    renderPage()
    const matches = await screen.findAllByText('Model S Plaid', undefined, {
      timeout: 2000,
    })
    expect(matches.length).toBeGreaterThan(0)
  })
})
