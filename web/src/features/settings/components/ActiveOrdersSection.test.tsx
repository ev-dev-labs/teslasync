// ActiveOrdersSection tests.
//
// Strategy (mirrors the DrivingDynamicsPage.test.tsx hook-boundary pattern):
//   • The two data hooks (`useTeslaUserOrders`, `useRefreshTeslaOrders`) are
//     mocked at the `@/api/hooks/useUser` boundary so every render branch
//     (loading / error / empty / populated) and both mutation outcomes are
//     deterministic and no network is touched.
//   • react-i18next is stubbed to echo the fallback string (with {{var}}
//     interpolation) so assertions target rendered English.
//   • The component is rendered inside QueryClientProvider + MemoryRouter +
//     ToastProvider so the transitive settings/date hooks, <QueryError>'s
//     router usage, and the shared toast helper all resolve.
//
// The status-badge tests exercise the private `orderStatusVariant` /
// `formatOrderStatus` helpers through their rendered output (Badge text +
// variant colour class) rather than importing them, keeping the module's
// public surface unchanged.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        let result = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
          }
        }
        return result
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/api/hooks/useUser', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useUser')>()
  return {
    ...actual,
    useTeslaUserOrders: vi.fn(),
    useRefreshTeslaOrders: vi.fn(),
  }
})

import {
  useTeslaUserOrders,
  useRefreshTeslaOrders,
  type TeslaOrder,
} from '@/api/hooks/useUser'
import { ApiError } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import { ActiveOrdersSection } from './ActiveOrdersSection'

const mockedUseOrders = useTeslaUserOrders as unknown as Mock
const mockedUseRefresh = useRefreshTeslaOrders as unknown as Mock

function makeOrder(overrides: Partial<TeslaOrder> = {}): TeslaOrder {
  return {
    id: 1,
    order_id: 'RN123456',
    model: 'Model Y',
    status: 'BOOKED',
    delivery_date: null,
    vin: null,
    referral_code: null,
    is_upgradable: false,
    fetched_at: '2025-03-01T00:00:00Z',
    created_at: '2025-03-01T00:00:00Z',
    updated_at: '2025-03-01T00:00:00Z',
    ...overrides,
  }
}

// A full react-query result is large; the component only reads a handful of
// fields. Build just those and let the loose Mock return type absorb the rest.
function ordersState(over: Record<string, unknown> = {}) {
  return {
    data: { orders: [] as TeslaOrder[], fetched_at: null as string | null },
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
    ...over,
  }
}

function renderSection() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ToastProvider>
          <ActiveOrdersSection />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedUseOrders.mockReturnValue(ordersState())
  mockedUseRefresh.mockReturnValue({ mutate: vi.fn(), isPending: false })
})

describe('ActiveOrdersSection — header', () => {
  it('always renders the panel title, subtitle, and refresh control', () => {
    renderSection()
    expect(screen.getByText('Active Orders')).toBeInTheDocument()
    expect(
      screen.getByText('Vehicle orders and delivery tracking from Tesla'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /refresh/i }),
    ).toBeInTheDocument()
  })

  it('shows the last-synced timestamp only when the orders were fetched', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({ data: { orders: [], fetched_at: '2025-03-15T12:00:00Z' } }),
    )
    renderSection()
    expect(screen.getByText('Synced', { exact: false })).toBeInTheDocument()
  })

  it('hides the last-synced timestamp before the first fetch', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({ data: { orders: [], fetched_at: null } }),
    )
    renderSection()
    expect(screen.queryByText('Synced', { exact: false })).not.toBeInTheDocument()
  })
})

describe('ActiveOrdersSection — loading / error / empty states', () => {
  it('renders a loading spinner while the query is pending', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({ data: undefined, isLoading: true }),
    )
    renderSection()
    expect(screen.getByText('Loading orders…')).toBeInTheDocument()
    // The header (and its refresh control) stay mounted during load.
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
    // No empty-state copy competes with the spinner.
    expect(screen.queryByText(/No order data yet/)).not.toBeInTheDocument()
  })

  it('surfaces a QueryError whose retry refetches when the initial load fails', () => {
    const refetch = vi.fn()
    mockedUseOrders.mockReturnValue(
      ordersState({
        data: undefined,
        isError: true,
        error: new ApiError('Tesla upstream failed', 503),
        refetch,
      }),
    )
    renderSection()

    // 503 → QueryError "Server error" branch with a Retry CTA.
    expect(screen.getByText('Server error')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('shows the "no active orders" empty state after a fetch returns zero orders', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({ data: { orders: [], fetched_at: '2025-03-01T00:00:00Z' } }),
    )
    renderSection()
    expect(screen.getByText('No active orders found.')).toBeInTheDocument()
  })

  it('shows the "no data yet" empty state before the first successful fetch', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({ data: { orders: [], fetched_at: null } }),
    )
    renderSection()
    expect(
      screen.getByText('No order data yet. Click Refresh to fetch from Tesla.'),
    ).toBeInTheDocument()
  })

  it('prefers rendering cached orders over a background refetch error', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({
        data: { orders: [makeOrder({ model: 'Model S' })], fetched_at: '2025-03-01T00:00:00Z' },
        isError: true,
        error: new ApiError('flaky refetch', 503),
      }),
    )
    renderSection()
    // Data wins — the error UI is suppressed while we still have rows to show.
    expect(screen.getByText('Model S')).toBeInTheDocument()
    expect(screen.queryByText('Server error')).not.toBeInTheDocument()
  })
})

describe('ActiveOrdersSection — order cards', () => {
  it('renders model, order id, VIN, delivery date, and the upgradable badge', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({
        data: {
          orders: [
            makeOrder({
              model: 'Model 3',
              order_id: 'RN987654',
              vin: '5YJ3E1EA7KF000000',
              delivery_date: '2025-03-15T00:00:00Z',
              is_upgradable: true,
              status: 'PREPARING_FOR_DELIVERY',
            }),
          ],
          fetched_at: '2025-03-01T00:00:00Z',
        },
      }),
    )
    renderSection()

    expect(screen.getByText('Model 3')).toBeInTheDocument()
    expect(screen.getByText('RN987654')).toBeInTheDocument()
    expect(screen.getByText('5YJ3E1EA7KF000000')).toBeInTheDocument()
    expect(screen.getByText('Order ID')).toBeInTheDocument()
    expect(screen.getByText('VIN')).toBeInTheDocument()
    expect(screen.getByText('Delivery Date')).toBeInTheDocument()
    expect(screen.getByText('Upgradable')).toBeInTheDocument()
    // Delivery date renders through the tz-aware formatter (UTC in tests).
    expect(screen.getByText('Mar 15, 2025')).toBeInTheDocument()
  })

  it('omits the VIN, delivery, and upgradable rows when those fields are absent', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({
        data: {
          orders: [
            makeOrder({ model: 'Model X', vin: null, delivery_date: null, is_upgradable: false }),
          ],
          fetched_at: '2025-03-01T00:00:00Z',
        },
      }),
    )
    renderSection()

    expect(screen.getByText('Model X')).toBeInTheDocument()
    expect(screen.getByText('Order ID')).toBeInTheDocument()
    expect(screen.queryByText('VIN')).not.toBeInTheDocument()
    expect(screen.queryByText('Delivery Date')).not.toBeInTheDocument()
    expect(screen.queryByText('Upgradable')).not.toBeInTheDocument()
  })

  it('falls back to an em dash when the order model is empty', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({
        data: {
          orders: [makeOrder({ model: '', status: 'BOOKED' })],
          fetched_at: '2025-03-01T00:00:00Z',
        },
      }),
    )
    renderSection()
    // Status "BOOKED" formats to "Booked", so the only em dash is the model.
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders one card per order', () => {
    mockedUseOrders.mockReturnValue(
      ordersState({
        data: {
          orders: [
            makeOrder({ id: 1, order_id: 'RN000001', model: 'Model Y' }),
            makeOrder({ id: 2, order_id: 'RN000002', model: 'Model 3' }),
          ],
          fetched_at: '2025-03-01T00:00:00Z',
        },
      }),
    )
    renderSection()
    expect(screen.getByText('RN000001')).toBeInTheDocument()
    expect(screen.getByText('RN000002')).toBeInTheDocument()
    expect(screen.getByText('Model Y')).toBeInTheDocument()
    expect(screen.getByText('Model 3')).toBeInTheDocument()
  })
})

describe('ActiveOrdersSection — status badge variants', () => {
  function renderWithStatus(status: string) {
    mockedUseOrders.mockReturnValue(
      ordersState({
        data: {
          orders: [makeOrder({ status, model: 'Model 3' })],
          fetched_at: '2025-03-01T00:00:00Z',
        },
      }),
    )
    renderSection()
  }

  it('maps a delivered status to the success (green) variant', () => {
    renderWithStatus('DELIVERED')
    const badge = screen.getByText('Delivered')
    expect(badge.className).toContain('bg-green-100')
  })

  it('maps ready/transport statuses to the info (blue) variant', () => {
    renderWithStatus('READY_FOR_TRANSPORT')
    const badge = screen.getByText('Ready For Transport')
    expect(badge.className).toContain('bg-blue-100')
  })

  it('maps cancelled/rejected statuses to the danger (red) variant', () => {
    renderWithStatus('CANCELED')
    const badge = screen.getByText('Canceled')
    expect(badge.className).toContain('bg-red-100')
  })

  it('maps pending/order statuses to the warning (yellow) variant', () => {
    renderWithStatus('PENDING')
    const badge = screen.getByText('Pending')
    expect(badge.className).toContain('bg-yellow-100')
  })

  it('maps an unrecognized status to the neutral (gray) variant', () => {
    renderWithStatus('BOOKED')
    const badge = screen.getByText('Booked')
    expect(badge.className).toContain('bg-gray-100')
  })

  it('renders an em dash and neutral variant for an empty status', () => {
    renderWithStatus('')
    const badge = screen.getByText('—')
    expect(badge.className).toContain('bg-gray-100')
    expect(badge.className).toContain('rounded-full')
  })
})

describe('ActiveOrdersSection — refresh action', () => {
  it('invokes the refresh mutation with success/error callbacks on click', () => {
    const mutate = vi.fn()
    mockedUseRefresh.mockReturnValue({ mutate, isPending: false })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    )
  })

  it('shows a success toast when the refresh resolves', async () => {
    const mutate = vi.fn((_input: undefined, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.()
    })
    mockedUseRefresh.mockReturnValue({ mutate, isPending: false })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(await screen.findByText('Orders refreshed')).toBeInTheDocument()
  })

  it('shows an error toast carrying the failure message when the refresh rejects', async () => {
    const mutate = vi.fn(
      (_input: undefined, opts?: { onError?: (e: Error) => void }) => {
        opts?.onError?.(new Error('Tesla timeout'))
      },
    )
    mockedUseRefresh.mockReturnValue({ mutate, isPending: false })
    renderSection()

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }))

    expect(await screen.findByText('Failed to refresh orders')).toBeInTheDocument()
    expect(screen.getByText('Tesla timeout')).toBeInTheDocument()
  })

  it('disables the refresh button and spins its icon while a refresh is pending', () => {
    mockedUseRefresh.mockReturnValue({ mutate: vi.fn(), isPending: true })
    renderSection()

    const button = screen.getByRole('button', { name: /refresh/i })
    expect(button).toBeDisabled()
    expect(button.querySelector('.animate-spin')).not.toBeNull()
  })
})
