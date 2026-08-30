/**
 * FleetTelemetryHealth contract + regression tests.
 *
 * FleetTelemetryHealth is the admin dev-tools surface over the two
 * `/tesla/fleet-telemetry/*` error endpoints. Its single export is a view over
 * four hooks (two queries + two refresh mutations). These tests drive the real
 * TanStack Query wiring through a mocked `request()` client (the repo
 * convention — see BackendTool.test.tsx / DLQInspectorPage.test.tsx) so the
 * hooks' URL building, query-key filtering, and mutation side-effects all
 * execute under test rather than being stubbed out.
 *
 * Coverage:
 *   1. Populated — both cards render their tables from the two GET endpoints,
 *      the "affected" counter reflects the VIN list, and null error fields
 *      degrade to the "—" placeholder.
 *   2. Empty — zero rows on both endpoints surface the distinct empty-state
 *      copy and a success-toned "0 affected" badge (never a blank panel).
 *   3. Loading — a pending fetch shows skeleton placeholders for both cards,
 *      with no table, empty message, or error panel leaking through.
 *   4. Error (NEW hardening) — a rejected VIN fetch shows the QueryError alert
 *      instead of masquerading as "no errors", and its Retry re-runs the query.
 *   5. VIN filter — clicking a VIN drives the second query to the vin-scoped
 *      URL and reveals the "Filtered" chip; the clear (×) control resets it.
 *   6. Refresh mutations — each "Refresh from Tesla" button POSTs to the right
 *      endpoint and fires its success toast.
 *   7. Recency highlighting — `isRecent` paints a fresh last-seen rose and a
 *      stale one amber, exercising both branches of the helper.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    // t(key, defaultStr) → defaultStr; falls back to the key otherwise so the
    // component's copy is deterministic and locale-file independent.
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

// Toast is stubbed via a hoisted spy so the refresh mutations' success/error
// side-effects can be asserted without mounting the real <ToastProvider>
// (which pulls in framer-motion). vi.hoisted guarantees the spies exist before
// the mock factory runs.
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  toast: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('@/components/feedback/Toast', () => ({
  useToast: () => toast,
  useOptionalToast: () => toast,
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { request } from '@/api/client'
import { FleetTelemetryHealth } from './FleetTelemetryHealth'
import type {
  FleetTelemetryErrorVIN,
  FleetTelemetryError,
} from '@/api/hooks/useTelemetry'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>
const ASYNC_QUERY_TIMEOUT = { timeout: 5_000 }

// ── Endpoint constants (must mirror the hooks in useTelemetry.ts) ────────────
const VINS_URL = '/tesla/fleet-telemetry/error-vins'
const VINS_REFRESH_URL = '/tesla/fleet-telemetry/error-vins/refresh'
const ERRORS_URL = '/tesla/fleet-telemetry/errors'
const ERRORS_REFRESH_URL = '/tesla/fleet-telemetry/errors/refresh'

// ── Fixtures ─────────────────────────────────────────────────────────────────
const NOW_ISO = new Date().toISOString()
const OLD_ISO = new Date('2020-01-01T00:00:00.000Z').toISOString()

const VIN_A = '5YJ3E1EA1KF000001'
const VIN_B = '7SAYGDEE9PF000002'

const vinA: FleetTelemetryErrorVIN = {
  id: 1,
  vin: VIN_A,
  active: true,
  first_seen_at: OLD_ISO,
  last_seen_at: NOW_ISO, // fresh → rose highlight
  resolved_at: null,
}

const vinB: FleetTelemetryErrorVIN = {
  id: 2,
  vin: VIN_B,
  active: true,
  first_seen_at: OLD_ISO,
  last_seen_at: OLD_ISO, // stale → amber highlight
  resolved_at: null,
}

const errorA: FleetTelemetryError = {
  id: 10,
  vin: VIN_A,
  error_code: 'MISSING_KEY',
  error_message: 'Vehicle key not paired',
  reported_at: NOW_ISO,
  tesla_updated_at: null,
  fetched_at: NOW_ISO,
}

const errorB: FleetTelemetryError = {
  id: 11,
  vin: VIN_B,
  error_code: null, // → "—"
  error_message: null, // → "—"
  reported_at: null,
  tesla_updated_at: null,
  fetched_at: NOW_ISO,
}

interface Handlers {
  vins?: () => Promise<unknown>
  errors?: (vin: string | null) => Promise<unknown>
  refreshVins?: () => Promise<unknown>
  refreshErrors?: () => Promise<unknown>
}

function wire(h: Handlers = {}) {
  mockedRequest.mockImplementation((path: string) => {
    if (path === VINS_REFRESH_URL) {
      return (h.refreshVins ?? (() => Promise.resolve({ ok: true })))()
    }
    if (path === VINS_URL) {
      return (h.vins ?? (() => Promise.resolve([vinA, vinB])))()
    }
    if (path === ERRORS_REFRESH_URL) {
      return (h.refreshErrors ?? (() => Promise.resolve({ ok: true })))()
    }
    if (path.startsWith(ERRORS_URL)) {
      const vin = new URLSearchParams(path.split('?')[1] ?? '').get('vin')
      const fallback = (v: string | null) =>
        Promise.resolve(v ? [errorA] : [errorA, errorB])
      return (h.errors ?? fallback)(vin)
    }
    return Promise.reject(new Error(`unexpected path: ${path}`))
  })
}

function renderHealth() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <FleetTelemetryHealth />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

function callsFor(url: string): number {
  return mockedRequest.mock.calls.filter((c) => c[0] === url).length
}

beforeEach(() => {
  mockedRequest.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('FleetTelemetryHealth', () => {
  it('renders both cards with their tables, the affected counter, and "—" for null fields', async () => {
    wire()
    renderHealth()

    // VIN table populated from the error-vins endpoint.
    expect(
      await screen.findByRole('button', { name: VIN_A }, ASYNC_QUERY_TIMEOUT),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: VIN_B })).toBeInTheDocument()

    // Both card headings render.
    expect(screen.getByText('Error VINs')).toBeInTheDocument()
    expect(screen.getByText('Error Log')).toBeInTheDocument()

    // The affected-vehicles badge counts the VIN list.
    expect(screen.getByText(/affected/)).toHaveTextContent('2 affected')

    // Error-log rows: code badge + message for A, "—" placeholders for B.
    expect(
      await screen.findByText('MISSING_KEY', {}, ASYNC_QUERY_TIMEOUT),
    ).toBeInTheDocument()
    expect(screen.getByText('Vehicle key not paired')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)

    // Both GET endpoints were hit (the error query defaults to the unfiltered URL).
    expect(mockedRequest).toHaveBeenCalledWith(VINS_URL, expect.anything())
    expect(mockedRequest).toHaveBeenCalledWith(ERRORS_URL, expect.anything())
  })

  it('shows distinct empty states and a "0 affected" badge when both endpoints are empty', async () => {
    wire({ vins: () => Promise.resolve([]), errors: () => Promise.resolve([]) })
    renderHealth()

    expect(
      await screen.findByText(
        'No vehicles with telemetry errors',
        {},
        ASYNC_QUERY_TIMEOUT,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('No fleet telemetry errors recorded')).toBeInTheDocument()
    expect(screen.getByText(/affected/)).toHaveTextContent('0 affected')

    // No data rows means no VIN buttons and no error-code badges leaked through.
    expect(screen.queryByRole('button', { name: VIN_A })).toBeNull()
    expect(screen.queryByText('MISSING_KEY')).toBeNull()
  })

  it('renders skeleton placeholders while the fetches are pending', () => {
    // Never-resolving promises keep both queries in the loading state.
    wire({
      vins: () => new Promise(() => {}),
      errors: () => new Promise(() => {}),
    })
    const { container } = renderHealth()

    // Card chrome is present immediately…
    expect(screen.getByText('Error VINs')).toBeInTheDocument()
    expect(screen.getByText('Error Log')).toBeInTheDocument()

    // …with two skeletons and none of the settled-state content.
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('No vehicles with telemetry errors')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a QueryError (not the empty state) when the VIN fetch fails, and Retry refetches', async () => {
    wire({
      vins: () => Promise.reject(new Error('network fail')),
      errors: () => Promise.resolve([]),
    })
    renderHealth()

    // Network failure → assertive alert, NOT the "no vehicles" empty copy.
    const alert = await screen.findByRole('alert', {}, ASYNC_QUERY_TIMEOUT)
    expect(alert).toBeInTheDocument()
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
    expect(screen.queryByText('No vehicles with telemetry errors')).toBeNull()

    // Retry re-invokes the failing query (call count for the VIN URL grows).
    const before = callsFor(VINS_URL)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(callsFor(VINS_URL)).toBeGreaterThan(before))
  })

  it('filters the error log by VIN and clears the filter via the × control', async () => {
    wire()
    renderHealth()

    fireEvent.click(
      await screen.findByRole('button', { name: VIN_A }, ASYNC_QUERY_TIMEOUT),
    )

    // The second query re-runs against the vin-scoped URL…
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        `${ERRORS_URL}?vin=${VIN_A}`,
        expect.anything(),
      ),
    )
    // …and the active-filter chip reflects the selection.
    expect(screen.getByText(/Filtered/)).toHaveTextContent(VIN_A)

    // Clearing the filter removes the chip.
    fireEvent.click(screen.getByRole('button', { name: 'Clear VIN filter' }))
    await waitFor(() => expect(screen.queryByText(/Filtered/)).toBeNull())
  })

  it('POSTs to the correct refresh endpoint and toasts success for each card', async () => {
    wire()
    renderHealth()
    await screen.findByRole('button', { name: VIN_A }, ASYNC_QUERY_TIMEOUT)

    const refreshButtons = screen.getAllByRole('button', {
      name: /Refresh from Tesla/,
    })
    expect(refreshButtons).toHaveLength(2)

    // Card 1 (VINs) → error-vins refresh.
    fireEvent.click(refreshButtons[0])
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(VINS_REFRESH_URL, { method: 'POST' }),
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Telemetry error VINs refreshed'),
    )

    // Card 2 (Errors) → errors refresh.
    fireEvent.click(refreshButtons[1])
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(ERRORS_REFRESH_URL, { method: 'POST' }),
    )
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Telemetry errors refreshed'),
    )
  })

  it('highlights a fresh last-seen row in rose and a stale one in amber (isRecent branches)', async () => {
    wire()
    renderHealth()

    const rowA = (
      await screen.findByRole('button', { name: VIN_A }, ASYNC_QUERY_TIMEOUT)
    ).closest('tr')
    const rowB = screen.getByRole('button', { name: VIN_B }).closest('tr')
    expect(rowA).not.toBeNull()
    expect(rowB).not.toBeNull()

    // Fresh last_seen_at → recent → rose; stale → amber.
    expect(rowA?.querySelector('.text-rose-300')).not.toBeNull()
    expect(rowB?.querySelector('.text-amber-300')).not.toBeNull()
    // A fresh row must NOT be painted stale-amber on its last-seen cell.
    expect(rowA?.querySelector('.text-amber-300')).toBeNull()
  })
})
