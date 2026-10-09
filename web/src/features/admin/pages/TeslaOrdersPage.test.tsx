/**
 * TeslaOrdersPage contract tests.
 *
 * The page is a thin orchestrator that fans a single `GET /tesla/user/orders`
 * query out to five self-sufficient sections (KPI band, status breakdown,
 * delivery outlook, visual board, detail table) plus a
 * `POST /tesla/user/orders/refresh` mutation. These tests exercise the page
 * end-to-end — the real `useUser` hooks run against a mocked `request()` — so
 * every branch a user can hit is covered:
 *
 *   1. Ready — header, KPI band, breakdown badges, board cards + detail table.
 *   2. Ready — the derived aggregates (total, VIN progress, distinct models,
 *      next-delivery date) reflect the raw orders exactly.
 *   3. Loading — every data section shows a Skeleton (never blank) while the
 *      always-on KPI band still renders its zeroed shell.
 *   4. Error — each section surfaces a QueryError alert with a working Retry
 *      that re-fires the orders query; the KPI band stays mounted.
 *   5. Empty (synced) — the "no active orders" copy shows and the empty-state
 *      CTA fires POST /tesla/user/orders/refresh.
 *   6. Empty (never synced) — the copy switches to the "no data yet" variant.
 *   7. Refresh — the header action fires the refresh mutation and reflects the
 *      pending state via `disabled` + `aria-busy`.
 *   8. Detail table — the client-side text filter narrows the rendered rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    request: vi.fn(),
  }
})

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
        const interpolate = (s: string) =>
          opts
            ? Object.keys(opts).reduce(
                (acc, k) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(opts[k])),
                s,
              )
            : s
        if (opts && typeof opts.defaultValue === 'string') return interpolate(opts.defaultValue)
        if (fallback != null) return interpolate(fallback)
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { request } from '@/api/client'
import { ToastProvider } from '@/components/feedback/Toast'
import TeslaOrdersPage from './TeslaOrdersPage'
import type { TeslaOrder } from '@/api/hooks/useUser'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const ORDERS_PATH = '/tesla/user/orders'
const REFRESH_PATH = '/tesla/user/orders/refresh'

// Far-future ISO dates so the "next upcoming delivery" derivation is
// deterministic regardless of the wall clock the suite runs on.
const FUTURE_SOON = '2099-03-01T00:00:00Z'
const FUTURE_LATE = '2099-06-01T00:00:00Z'
const PAST = '2020-01-01T00:00:00Z'
const SYNCED_AT = '2026-01-15T12:00:00Z'

function makeOrder(overrides: Partial<TeslaOrder> = {}): TeslaOrder {
  return {
    id: 1,
    order_id: 'RN000001',
    model: 'Model Y',
    status: 'BOOKED',
    delivery_date: null,
    vin: null,
    referral_code: null,
    is_upgradable: false,
    fetched_at: SYNCED_AT,
    created_at: SYNCED_AT,
    updated_at: SYNCED_AT,
    ...overrides,
  }
}

// One order per lifecycle bucket, with a deterministic mix of VIN/upgradable
// flags and delivery dates so every aggregate has a distinct expected value.
function makeOrders(): TeslaOrder[] {
  return [
    makeOrder({
      id: 1,
      order_id: 'RN101',
      model: 'Model Y',
      status: 'BOOKED', // → inProgress
      delivery_date: FUTURE_LATE,
      vin: null,
      is_upgradable: true,
    }),
    makeOrder({
      id: 2,
      order_id: 'RN202',
      model: 'Model 3',
      status: 'READY_FOR_DELIVERY', // → ready
      delivery_date: FUTURE_SOON,
      vin: '5YJ3E1EA1KF000002',
      is_upgradable: false,
    }),
    makeOrder({
      id: 3,
      order_id: 'RN303',
      model: 'Model S',
      status: 'DELIVERED', // → delivered
      delivery_date: PAST,
      vin: '5YJSA1E2XKF000003',
      is_upgradable: false,
    }),
    makeOrder({
      id: 4,
      order_id: 'RN404',
      model: 'Cybertruck',
      status: 'CANCELLED', // → cancelled
      delivery_date: null,
      vin: null,
      is_upgradable: false,
    }),
  ]
}

interface InstallOptions {
  orders?: TeslaOrder[] | null
  fetchedAt?: string | null
  /** When true, the orders query never resolves (loading state). */
  pending?: boolean
  /** When true, the orders query rejects (error state). */
  ordersError?: boolean
  /** When true, POST /tesla/user/orders/refresh never resolves. */
  refreshPending?: boolean
}

const never = () => new Promise<never>(() => {})

function install(opts: InstallOptions = {}) {
  const {
    orders = makeOrders(),
    fetchedAt = SYNCED_AT,
    pending = false,
    ordersError = false,
    refreshPending = false,
  } = opts

  mockedRequest.mockImplementation((path: string) => {
    if (path === ORDERS_PATH) {
      if (pending) return never()
      if (ordersError) return Promise.reject(new Error('orders boom'))
      return Promise.resolve({ orders, fetched_at: fetchedAt })
    }
    if (path === REFRESH_PATH) {
      return refreshPending ? never() : Promise.resolve({ orders, fetched_at: fetchedAt })
    }
    return Promise.resolve({})
  })
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <TeslaOrdersPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return { ...view, client: qc }
}

const ordersCallCount = () =>
  mockedRequest.mock.calls.filter((c) => c[0] === ORDERS_PATH).length

const kpiRegion = () => screen.getByRole('region', { name: 'Order summary' })
const insightsRegion = () => screen.getByRole('region', { name: 'Order insights' })

/** The real <button> refresh action in the page header (not the freshness chip). */
const headerRefresh = () =>
  screen
    .getAllByRole('button', { name: 'Refresh' })
    .find((el): el is HTMLButtonElement => el instanceof HTMLButtonElement)!

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('TeslaOrdersPage — ready state', () => {
  it('mounts the real six-metric OperationalBrief with source counts, delivery date and original controls', async () => {
    install()
    const { container } = renderPage()
    await screen.findByRole('table')
    const strip = container.querySelector('[data-operational-brief][data-testid="tesla-orders-summary"]')!
    const tiles = strip.querySelectorAll('[data-operational-metric]')
    expect(tiles).toHaveLength(6)
    expect(within(strip as HTMLElement).getByText(/Last synced:/)).toBeInTheDocument()
    expect(Array.from(tiles).map((tile) => tile.querySelector('[data-operational-value]')?.textContent))
      .toEqual(['4', '1', '1', '1', '1', expect.stringContaining('2099')])
    expect(tiles[2]).toHaveTextContent('Booked or building')
    expect(tiles[3]).toHaveTextContent('Awaiting handover')
    expect(tiles[5]).toHaveTextContent('Soonest upcoming')
    expect(headerRefresh()).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Filter orders' })).toBeInTheDocument()
    expect(insightsRegion()).toBeInTheDocument()
    fireEvent.click(within(strip as HTMLElement).getByRole('button', { name: 'Review details' }))
    const drawer = await screen.findByRole('dialog')
    expect(drawer).toHaveTextContent('Booked or building')
    expect(drawer).toHaveTextContent('Awaiting handover')
    expect(drawer).toHaveTextContent('Soonest upcoming')
  })
  it('renders the header, KPI band, status breakdown, board and detail table', async () => {
    install()
    renderPage()

    // Header + subtitle + primary action.
    expect(screen.getByRole('heading', { name: 'Tesla orders' })).toBeInTheDocument()
    expect(
      screen.getByText('Vehicle orders and delivery tracking pulled from your Tesla account.'),
    ).toBeInTheDocument()
    expect(headerRefresh()).toBeEnabled()

    // The detail table only mounts once the orders query resolves — use it as
    // the "ready" signal (the KPI band label is present even while loading).
    const table = await screen.findByRole('table')

    // KPI band shows the derived total once data lands.
    expect(within(kpiRegion()).getByText('Total orders')).toBeInTheDocument()
    expect(within(kpiRegion()).getByText('4')).toBeInTheDocument()

    // Status breakdown badges — one per non-empty lifecycle bucket + "Other".
    const insights = insightsRegion()
    expect(within(insights).getByText('In progress')).toBeInTheDocument()
    expect(within(insights).getByText('Ready · in transit')).toBeInTheDocument()
    expect(within(insights).getByText('Delivered')).toBeInTheDocument()
    expect(within(insights).getByText('Cancelled')).toBeInTheDocument()
    expect(within(insights).getByText('Other')).toBeInTheDocument()

    // Detail table lists every order; the board renders a card per order too,
    // so each model surfaces at least twice (board card + table cell).
    expect(within(table).getByText('Cybertruck')).toBeInTheDocument()
    expect(screen.getAllByText('Cybertruck').length).toBeGreaterThanOrEqual(2)
  })

  it('derives the KPI + outlook aggregates from the raw orders', async () => {
    install()
    renderPage()

    // Next-delivery KPI = the soonest *future* delivery (2099-03, not 2099-06
    // and not the past-dated delivered order).
    await waitFor(() =>
      expect(within(kpiRegion()).getByText(/2099/)).toBeInTheDocument(),
    )

    // Delivery outlook aggregates: distinct models (4) + VIN progress (2 / 4).
    const insights = insightsRegion()
    expect(within(insights).getByText('Distinct models')).toBeInTheDocument()
    expect(within(insights).getByText('VIN assigned')).toBeInTheDocument()
    expect(within(insights).getByText('2 / 4')).toBeInTheDocument()

    // Only the request for the orders envelope should have fired (no double
    // /api/v1 prefix, no accidental refresh on mount).
    expect(mockedRequest).toHaveBeenCalledWith(ORDERS_PATH, expect.anything())
    expect(mockedRequest).not.toHaveBeenCalledWith(REFRESH_PATH, expect.anything())
  })
})

describe('TeslaOrdersPage — loading, error, empty', () => {
  it('does not turn a missing order list into five measured zeros', async () => {
    install({ orders: null, fetchedAt: null })
    const { container } = renderPage()
    await screen.findAllByText('No order data yet. Refresh to fetch the latest orders from Tesla.')
    const strip = container.querySelector('[data-operational-brief][data-testid="tesla-orders-summary"]')!
    expect(strip.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(6)
    expect(within(strip as HTMLElement).getByText('Not synced yet')).toBeInTheDocument()
  })
  it('keeps unknown counts missing on failure but renders a successful empty snapshot as real zero', async () => {
    install({ ordersError: true })
    const first = renderPage()
    await screen.findAllByRole('alert')
    const failed = first.container.querySelector('[data-operational-brief][data-testid="tesla-orders-summary"]')!
    expect(failed.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(6)
    expect(failed.querySelector('[data-operational-value]')).toHaveTextContent('—')
    first.unmount()

    install({ orders: [] })
    const second = renderPage()
    await screen.findAllByText('No active orders found on this Tesla account.')
    const empty = second.container.querySelector('[data-operational-brief][data-testid="tesla-orders-summary"]')!
    expect(empty.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(5)
    expect(Array.from(empty.querySelectorAll('[data-operational-metric][data-value-state="value"] [data-operational-value]'))
      .map((value) => value.textContent)).toEqual(['0', '0', '0', '0', '0'])
    expect(empty.querySelector('[data-operational-metric="orders-next-delivery"]')).toHaveAttribute('data-value-state', 'missing')
  })
  it('shows skeleton placeholders while the orders query is pending (never blank)', () => {
    install({ pending: true })
    const { container } = renderPage()

    // Header shell + KPI band stay mounted; each data section shows a skeleton.
    expect(headerRefresh()).toBeInTheDocument()
    expect(within(kpiRegion()).getByText('Total orders')).toBeInTheDocument()
    expect(container.querySelectorAll('[aria-hidden="true"][class~="bg-[var(--skeleton-bg)]"]').length).toBeGreaterThanOrEqual(4)

    // No resolved data or error surfaced yet.
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a QueryError with a working Retry when the orders query fails', async () => {
    install({ ordersError: true })
    renderPage()

    // Each self-sufficient section renders its own error banner.
    await waitFor(() =>
      expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(1),
    )
    // KPI band still renders its (zeroed) shell rather than disappearing.
    expect(within(kpiRegion()).getByText('Total orders')).toBeInTheDocument()

    const before = ordersCallCount()
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0])

    await waitFor(() => expect(ordersCallCount()).toBeGreaterThan(before))
  })

  it('shows the synced empty copy and refreshes from the empty-state CTA', async () => {
    install({ orders: [], fetchedAt: SYNCED_AT })
    renderPage()

    await waitFor(() =>
      expect(
        screen.getAllByText('No active orders found on this Tesla account.').length,
      ).toBeGreaterThanOrEqual(1),
    )
    // The board + table render a titled empty state, not a bare blank panel.
    expect(screen.getAllByText('No orders').length).toBeGreaterThanOrEqual(1)

    // Find an EmptyState (role=status) that offers the recovery CTA and click it.
    const ctaHost = screen
      .getAllByRole('status')
      .find((s) => within(s).queryByRole('button', { name: 'Refresh' }))
    expect(ctaHost).toBeTruthy()
    fireEvent.click(within(ctaHost!).getByRole('button', { name: 'Refresh' }))

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        REFRESH_PATH,
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('shows the never-synced empty copy when no data has been fetched', async () => {
    install({ orders: [], fetchedAt: null })
    renderPage()

    await waitFor(() =>
      expect(
        screen.getAllByText(
          'No order data yet. Refresh to fetch the latest orders from Tesla.',
        ).length,
      ).toBeGreaterThanOrEqual(1),
    )
    // The synced variant must NOT appear in the un-synced case.
    expect(
      screen.queryByText('No active orders found on this Tesla account.'),
    ).toBeNull()
  })
})

describe('TeslaOrdersPage — interactions', () => {
  it('retains all orders, aggregate counts, board and table after a failed background read without automatically refreshing Tesla', async () => {
    install()
    const { client } = renderPage()
    await screen.findByRole('table')
    install({ ordersError: true })
    await act(async () => { await client.refetchQueries({ type: 'active' }) })
    const table = screen.getByRole('table')
    for (const model of ['Model Y', 'Model 3', 'Model S', 'Cybertruck']) {
      expect(within(table).getByText(model)).toBeInTheDocument()
    }
    expect(within(kpiRegion()).getByText('4')).toBeInTheDocument()
    expect(screen.getAllByText('Cybertruck').length).toBeGreaterThanOrEqual(2)
    expect(within(kpiRegion()).getByText('Retained account snapshot')).toBeInTheDocument()
    expect(screen.queryByText("Can't reach server")).toBeNull()
    expect(screen.getByText('Data may be stale')).toBeInTheDocument()
    expect(mockedRequest).not.toHaveBeenCalledWith(REFRESH_PATH, expect.anything())
  })
  it('fires POST /tesla/user/orders/refresh and reflects the pending state from the header action', async () => {
    install({ refreshPending: true })
    renderPage()

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())

    const btn = headerRefresh()
    expect(btn).toBeEnabled()
    fireEvent.click(btn)

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        REFRESH_PATH,
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    // The header action disables + advertises its busy state while in flight.
    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('filters the detail table rows by the free-text query', async () => {
    install()
    renderPage()

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(within(screen.getByRole('table')).getByText('Model Y')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter orders' }), {
      target: { value: 'cyber' },
    })

    await waitFor(() =>
      expect(within(screen.getByRole('table')).queryByText('Model Y')).toBeNull(),
    )
    expect(within(screen.getByRole('table')).getByText('Cybertruck')).toBeInTheDocument()
  })
})
