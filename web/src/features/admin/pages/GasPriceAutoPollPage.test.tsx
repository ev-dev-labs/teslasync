/**
 * GasPriceAutoPollPage contract tests.
 *
 * The page is a thin orchestrator that fans three queries out to four
 * self-sufficient sub-components (KPI band, trend chart, control panel,
 * history table). These tests exercise the page end-to-end — the real hooks
 * run against a mocked `request()` — so every branch the user can hit is
 * covered:
 *
 *   1. Full render: header, Poll-Now action, and all four sections with data.
 *   2. KPI band — enabled/"Running" state with formatted prices.
 *   3. KPI band — disabled/"Stopped" + never-polled ("—" prices, "Never").
 *   4. Loading — skeleton placeholders render (never a blank panel).
 *   5. Error — QueryError banner + working Retry (re-fires the status query).
 *   6. Empty — chart EmptyState + table empty message; no chart is drawn.
 *   7. Poll Now → POST /gas-price/poll.
 *   8. Poll Now is disabled + aria-busy while the mutation is pending.
 *   9. Auto-Poll toggle → POST /gas-price/toggle with the inverted value.
 *  10. Interval select → PUT /gas-price/config with the chosen value.
 *  11. History table lists one row per record with its price + unit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
import GasPriceAutoPollPage from './GasPriceAutoPollPage'
import type { GasPriceStatus, GasPriceHistory } from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

const ZERO_TIME = '0001-01-01T00:00:00Z'

function makeStatus(overrides: Partial<GasPriceStatus> = {}): GasPriceStatus {
  return {
    enabled: true,
    poll_interval: '7d',
    last_poll_time: '2026-01-15T12:00:00Z',
    current_price: 3.45,
    current_price_kwh_eq: 0.12,
    ...overrides,
  }
}

function makeHistory(): GasPriceHistory[] {
  // Endpoint returns newest-first; the "current" record has a null effective_to.
  return [
    {
      id: 2,
      price_per_unit: 3.29,
      unit: 'gal',
      efficiency_mpg: 25,
      effective_from: '2026-01-15T00:00:00Z',
      effective_to: null,
      created_at: '2026-01-15T00:00:00Z',
    },
    {
      id: 1,
      price_per_unit: 3.1,
      unit: 'gal',
      efficiency_mpg: 25,
      effective_from: '2026-01-08T00:00:00Z',
      effective_to: '2026-01-15T00:00:00Z',
      created_at: '2026-01-08T00:00:00Z',
    },
  ]
}

interface InstallOptions {
  status?: GasPriceStatus
  history?: GasPriceHistory[]
  /** When true, the status + history queries never resolve (loading state). */
  pending?: boolean
  statusError?: boolean
  historyError?: boolean
  /** When true, POST /gas-price/poll never resolves (pending mutation). */
  pollPending?: boolean
}

const never = () => new Promise<never>(() => {})

function install(opts: InstallOptions = {}) {
  const {
    status = makeStatus(),
    history = makeHistory(),
    pending = false,
    statusError = false,
    historyError = false,
    pollPending = false,
  } = opts

  mockedRequest.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/gas-price/status') {
      if (pending) return never()
      if (statusError) return Promise.reject(new Error('status boom'))
      return Promise.resolve(status)
    }
    if (path === '/gas-price/history') {
      if (pending) return never()
      if (historyError) return Promise.reject(new Error('history boom'))
      return Promise.resolve(history)
    }
    if (path === '/gas-price/poll') {
      return pollPending ? never() : Promise.resolve({ status: 'ok' })
    }
    if (path === '/gas-price/toggle') {
      const body = init?.body ? (JSON.parse(String(init.body)) as { enabled: boolean }) : { enabled: false }
      return Promise.resolve({ enabled: body.enabled })
    }
    if (path === '/gas-price/config') {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as { poll_interval: string })
        : { poll_interval: '7d' }
      return Promise.resolve(body)
    }
    if (path.startsWith('/settings')) return Promise.resolve({ chart_palette: 'cb_safe' })
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
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <GasPriceAutoPollPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

const statusCallCount = () =>
  mockedRequest.mock.calls.filter((c) => c[0] === '/gas-price/status').length

const kpiRegion = () => screen.getByRole('region', { name: /gas price summary/i })

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('GasPriceAutoPollPage — full render', () => {
  it('renders the header, poll action, and all four sections from live data', async () => {
    install()
    renderPage()

    // Header + primary action.
    expect(
      screen.getByRole('heading', { name: 'Gas Price Auto-Poll' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Automatically fetch US average gas prices from EIA'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Poll Now' })).toBeInTheDocument()

    // KPI band resolves.
    await waitFor(() => expect(within(kpiRegion()).getByText('Running')).toBeInTheDocument())
    expect(within(kpiRegion()).getByText('$3.45')).toBeInTheDocument()
    expect(within(kpiRegion()).getByText('$0.12')).toBeInTheDocument()

    // Every section panel is present.
    expect(screen.getByText('Configuration')).toBeInTheDocument()
    expect(screen.getByText('Price Trend')).toBeInTheDocument()
    expect(screen.getByText('Price History')).toBeInTheDocument()

    // Trend chart draws (role=img wrapper) and the table lists rows.
    expect(
      screen.getByRole('img', { name: /line chart of historical gas prices/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('GasPriceAutoPollPage — KPI band states', () => {
  it('reflects the enabled/running state', async () => {
    install({ status: makeStatus({ enabled: true }) })
    renderPage()

    await waitFor(() => expect(within(kpiRegion()).getByText('Running')).toBeInTheDocument())
    // The control panel also mirrors the running state (aria-checked switch).
    expect(screen.getByRole('switch', { name: 'Auto-Poll' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('reflects the disabled/stopped + never-polled state with placeholders', async () => {
    install({
      status: makeStatus({
        enabled: false,
        last_poll_time: ZERO_TIME,
        current_price: 0,
        current_price_kwh_eq: 0,
      }),
    })
    renderPage()

    await waitFor(() => expect(within(kpiRegion()).getByText('Stopped')).toBeInTheDocument())
    // Zero prices collapse to an em-dash placeholder (current price + kWh eq).
    expect(within(kpiRegion()).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // Never-polled sentinel is rendered, not a broken date.
    expect(within(kpiRegion()).getByText('Never')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Auto-Poll' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })
})

describe('GasPriceAutoPollPage — loading, error, empty', () => {
  it('shows skeleton placeholders while the queries are pending (never blank)', () => {
    install({ pending: true })
    const { container } = renderPage()

    // The page shell + action stay mounted; sections show skeletons.
    expect(screen.getByRole('button', { name: 'Poll Now' })).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(4)
    // No resolved data + no error surfaced yet.
    expect(screen.queryByText('Running')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a QueryError banner with a working Retry when the status query fails', async () => {
    install({ statusError: true })
    renderPage()

    // Both status-driven panels (KPI band + control panel) surface the error;
    // scope to the KPI band's region to assert its banner + Retry precisely.
    await waitFor(() =>
      expect(within(kpiRegion()).getByRole('alert')).toBeInTheDocument(),
    )
    const retry = within(kpiRegion()).getByRole('button', { name: 'Retry' })

    const before = statusCallCount()
    fireEvent.click(retry)

    await waitFor(() => expect(statusCallCount()).toBeGreaterThan(before))
  })

  it('shows empty states in the chart and table when there is no history', async () => {
    install({ history: [] })
    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('No price history recorded yet. Trigger a poll to get started.'),
      ).toBeInTheDocument(),
    )
    // Table renders its own (distinct) empty message.
    expect(screen.getByText('No price history recorded yet.')).toBeInTheDocument()
    // With no rows the chart is NOT drawn.
    expect(
      screen.queryByRole('img', { name: /line chart of historical gas prices/i }),
    ).toBeNull()
  })
})

describe('GasPriceAutoPollPage — interactions', () => {
  it('fires POST /gas-price/poll when Poll Now is clicked', async () => {
    install()
    renderPage()

    await waitFor(() => expect(within(kpiRegion()).getByText('Running')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Poll Now' }))

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/gas-price/poll',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('disables the Poll Now button while the poll mutation is pending', async () => {
    install({ pollPending: true })
    renderPage()

    await waitFor(() => expect(within(kpiRegion()).getByText('Running')).toBeInTheDocument())
    const btn = screen.getByRole('button', { name: 'Poll Now' })
    fireEvent.click(btn)

    await waitFor(() => expect(btn).toBeDisabled())
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('fires POST /gas-price/toggle with the inverted value from the Auto-Poll switch', async () => {
    install({ status: makeStatus({ enabled: true }) })
    renderPage()

    const toggle = await screen.findByRole('switch', { name: 'Auto-Poll' })
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/gas-price/toggle',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ enabled: false }) }),
      ),
    )
  })

  it('fires PUT /gas-price/config when the poll interval is changed', async () => {
    install()
    renderPage()

    // The history table's pagination adds its own <select>, so target the
    // interval control by its accessible ("Poll Interval") name.
    const select = await screen.findByRole('combobox', { name: /poll interval/i })
    fireEvent.change(select, { target: { value: 'daily' } })

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/gas-price/config',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ poll_interval: 'daily' }),
        }),
      ),
    )
  })
})

describe('GasPriceAutoPollPage — history table', () => {
  it('lists one row per record with its formatted price and unit', async () => {
    install()
    renderPage()

    const table = await screen.findByRole('table')
    // Both distinct historical prices surface in the table body.
    expect(within(table).getByText('$3.29')).toBeInTheDocument()
    expect(within(table).getByText('$3.10')).toBeInTheDocument()
    // The unit badge is rendered for each row.
    expect(within(table).getAllByText('gal').length).toBeGreaterThanOrEqual(2)
  })
})
