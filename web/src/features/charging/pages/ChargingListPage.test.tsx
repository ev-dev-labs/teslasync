/**
 * ChargingListPage — smoke test.
 *
 * Renders the page with a vehicle selected and an empty session list.
 * The page is heavy (filters, pagination, charts, optimizer); this test
 * just verifies it mounts without crashing under jsdom with empty data.
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

vi.mock('@/components/feedback/Toast', () => ({
  useToast: () => ({ show: vi.fn(), success: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }))
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 1, vehicles: [], setVehicleId: vi.fn() }),
}))
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'mi', temperature: 'F' },
    formatDistance: (v: number) => `${v.toFixed(0)} mi`,
  }),
}))
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (n: number) => `$${n.toFixed(2)}`,
    currencySymbol: '$',
  }),
}))
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>(
    '@/lib/timezone',
  )
  return {
    ...actual,
    useTimezone: () => 'UTC',
  }
})

const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn().mockResolvedValue(undefined),
  isPending: false,
  isLoading: false,
  isError: false,
  error: null,
  reset: vi.fn(),
})

vi.mock('@/api/hooks/useCharging', () => ({
  useChargingSessionsPaginated: () => ({
    data: [],
    isLoading: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useChargingOptimizer: () => ({ data: undefined, isLoading: false }),
  useBulkDeleteCharging: () => mutationStub(),
}))

import ChargingListPage from './ChargingListPage'

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ChargingListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ChargingListPage', () => {
  it('renders without crashing with no charging sessions', () => {
    const { container } = renderPage()
    expect(container.firstChild).not.toBeNull()
  })
})
