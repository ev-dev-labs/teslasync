/**
 * GasPriceKpiBand contract tests.
 *
 * GasPriceKpiBand is a presentational band: it receives a TanStack
 * `UseQueryResult<GasPriceStatus>` as a prop and never fetches itself, so
 * the tests drive it with hand-built query objects rather than mocking the
 * network. Coverage:
 *   1. First-load skeletons + aria-busy region.
 *   2. Background refetch (isLoading + cached data) keeps the KPIs on screen.
 *   3. Error branch renders a QueryError banner and Retry calls refetch().
 *   4. Running/enabled state: formatted price, kWh-eq, relative poll time.
 *   5. Stopped/never-polled state: em-dash placeholders + "Never".
 *   6. Idle query with no data still paints a full placeholder band.
 *   7. gas_unit === 'liter' swaps the "per {{unit}}" subtitle.
 *   8. Currency symbol + decimal precision come from user settings.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import type { GasPriceStatus } from '@/api/types'

// ── i18n: honour t(key, default, opts) with {{var}} interpolation so the
//    "per {{unit}}" subtitle resolves to real copy. ────────────────────────
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// ── Controllable settings. Hoisted so the mock factory (which runs when
//    GasPriceKpiBand's `useSettings` import resolves) can read it without a
//    temporal-dead-zone crash. Reset in beforeEach. ─────────────────────────
const h = vi.hoisted(() => {
  const DEFAULTS = {
    gas_unit: 'gallon' as 'gallon' | 'liter',
    currency_symbol: '$',
    decimal_precision: 2,
    base_cost_per_kwh: 0.12,
    unit_of_length: 'mi' as 'mi' | 'km',
    unit_of_temp: 'F' as 'F' | 'C',
    unit_of_pressure: 'psi' as 'psi' | 'bar',
    locale: 'en-US',
    gas_efficiency_mpg: 25,
    gas_price_per_unit: 0,
  }
  return { DEFAULTS, state: { current: { ...DEFAULTS } } }
})

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: h.state.current,
    isMiles: h.state.current.unit_of_length === 'mi',
    isFahrenheit: h.state.current.unit_of_temp === 'F',
    isPSI: h.state.current.unit_of_pressure === 'psi',
    decimals: h.state.current.decimal_precision,
    locale: h.state.current.locale,
    density: 'comfortable' as const,
    rangeType: 'rated' as const,
  }),
}))

import { GasPriceKpiBand } from './GasPriceKpiBand'

function statusFixture(overrides: Partial<GasPriceStatus> = {}): GasPriceStatus {
  return {
    enabled: false,
    poll_interval: '1h',
    last_poll_time: '0001-01-01T00:00:00Z',
    current_price: 0,
    current_price_kwh_eq: 0,
    ...overrides,
  }
}

function makeQuery(
  overrides: Partial<UseQueryResult<GasPriceStatus, Error>> = {},
): UseQueryResult<GasPriceStatus, Error> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as UseQueryResult<GasPriceStatus, Error>
}

function renderBand(query: UseQueryResult<GasPriceStatus, Error>) {
  return render(
    <MemoryRouter>
      <GasPriceKpiBand query={query} />
    </MemoryRouter>,
  )
}

function getRegion() {
  return screen.getByRole('region', { name: /gas price summary/i })
}

beforeEach(() => {
  h.state.current = { ...h.DEFAULTS }
})

describe('GasPriceKpiBand — loading & error states', () => {
  it('renders four skeletons and marks the region busy on first load', () => {
    const { container } = renderBand(
      makeQuery({ isLoading: true, isPending: true, isFetching: true }),
    )
    expect(getRegion()).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4)
    // No KPI cards while first-loading.
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
  })

  it('keeps the KPI cards on screen during a background refetch that has data', () => {
    const { container } = renderBand(
      makeQuery({
        isLoading: true,
        isFetching: true,
        data: statusFixture({ enabled: true }),
      }),
    )
    // firstLoad is `isLoading && !data`, so cached data wins: cards, no skeleton.
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0)
    expect(getRegion()).not.toHaveAttribute('aria-busy')
  })

  it('shows a QueryError banner and retries on demand when the query fails', () => {
    const refetch = vi.fn()
    const { container } = renderBand(
      makeQuery({ isError: true, error: new Error('network down'), refetch }),
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0)
    expect(screen.queryByText('Status')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe('GasPriceKpiBand — populated states', () => {
  it('renders running status, formatted prices and a relative poll time', () => {
    const recent = new Date(Date.now() - 3 * 60_000).toISOString()
    renderBand(
      makeQuery({
        isSuccess: true,
        data: statusFixture({
          enabled: true,
          current_price: 3.5,
          current_price_kwh_eq: 0.14,
          last_poll_time: recent,
        }),
      }),
    )
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Auto-poll on')).toBeInTheDocument()
    expect(screen.getByText('$3.50')).toBeInTheDocument()
    expect(screen.getByText('$0.14')).toBeInTheDocument()
    expect(screen.getByText('per gal')).toBeInTheDocument()
    // formatRelative(recent) → "3m ago".
    expect(screen.getByText(/ago/)).toBeInTheDocument()
  })

  it('renders the stopped state with placeholders when off and never polled', () => {
    renderBand(
      makeQuery({
        isSuccess: true,
        data: statusFixture({
          enabled: false,
          current_price: 0,
          current_price_kwh_eq: 0,
          last_poll_time: '0001-01-01T00:00:00Z',
        }),
      }),
    )
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('Auto-poll off')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(screen.getByText('Awaiting first poll')).toBeInTheDocument()
    // Both price cards fall back to the em-dash, never a blank value.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('paints a full placeholder band when the query is idle with no data', () => {
    renderBand(makeQuery())
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.getByText('Never')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(getRegion()).not.toHaveAttribute('aria-busy')
  })
})

describe('GasPriceKpiBand — unit & currency preferences', () => {
  it('uses the liter unit label when the user prefers liters', () => {
    h.state.current = { ...h.state.current, gas_unit: 'liter' }
    renderBand(
      makeQuery({
        isSuccess: true,
        data: statusFixture({ enabled: true, current_price: 1.75 }),
      }),
    )
    expect(screen.getByText('per L')).toBeInTheDocument()
    expect(screen.queryByText('per gal')).not.toBeInTheDocument()
    expect(screen.getByText('$1.75')).toBeInTheDocument()
  })

  it('formats prices with the user currency symbol and decimal precision', () => {
    h.state.current = { ...h.state.current, currency_symbol: '€', decimal_precision: 3 }
    renderBand(
      makeQuery({
        isSuccess: true,
        data: statusFixture({
          enabled: true,
          current_price: 2,
          current_price_kwh_eq: 0.5,
        }),
      }),
    )
    expect(screen.getByText('€2.000')).toBeInTheDocument()
    expect(screen.getByText('€0.500')).toBeInTheDocument()
  })
})
