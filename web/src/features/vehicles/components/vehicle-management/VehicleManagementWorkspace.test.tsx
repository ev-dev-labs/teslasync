import type { ReactNode } from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>(
    '@/api/client',
  )
  return { ...actual, request: vi.fn() }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  )
  const interpolate = (
    template: string,
    values?: Record<string, unknown>,
  ): string =>
    values
      ? template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) =>
          String(values[key] ?? `{{${key}}}`),
        )
      : template
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        if (typeof fallback === 'string') {
          return interpolate(
            fallback,
            options && typeof options === 'object'
              ? options as Record<string, unknown>
              : undefined,
          )
        }
        if (fallback && typeof fallback === 'object') {
          const values = fallback as Record<string, unknown>
          return typeof values.defaultValue === 'string'
            ? interpolate(values.defaultValue, values)
            : key
        }
        return key
      },
      i18n: { language: 'en' },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { ApiError, request } from '@/api/client'
import { VehicleManagementWorkspace } from './VehicleManagementWorkspace'

const requestMock = request as unknown as ReturnType<typeof vi.fn>
const VEHICLE_ID = 42

type RequestCall = [string, RequestInit?]

let pricingError: Error | null
let optionsError: Error | null
let holdReads: boolean

const cachedAt = '2026-08-08T12:00:00Z'

function responseFor(url: string): unknown {
  if (url.endsWith('/options')) {
    if (optionsError) throw optionsError
    return {
      data: {
        codes: ['A', 'B'],
        api_token: 'must-never-render',
        nested: { enabled: true },
      },
      fetched_at: cachedAt,
    }
  }
  if (url.endsWith('/specs')) {
    return {
      data: { model: 'Model 3', trim_badging: 'Performance' },
      fetched_at: cachedAt,
    }
  }
  if (url.endsWith('/subscriptions')) {
    return {
      data: { subscriptions: [{ name: 'Premium' }], eligible: true },
      fetched_at: cachedAt,
    }
  }
  if (url.endsWith('/upgrades')) {
    return {
      data: { upgrades: [{ name: 'Acceleration Boost' }] },
      fetched_at: cachedAt,
    }
  }
  if (url === '/tesla/warranty') {
    return {
      data: { warranty_status: 'active', expiry_date: '2028-01-01' },
      fetched_at: cachedAt,
    }
  }
  if (url.endsWith('/enterprise-roles')) {
    return {
      data: { roles: ['fleet_manager'] },
      fetched_at: cachedAt,
    }
  }
  return { data: { ok: true }, fetched_at: cachedAt }
}

function installRequestRouter() {
  requestMock.mockImplementation((url: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET'
    if (method === 'GET') {
      if (holdReads) return new Promise(() => undefined)
      try {
        return Promise.resolve(responseFor(url))
      } catch (error) {
        return Promise.reject(error)
      }
    }
    if (url === '/tesla/vehicle-pricing' && pricingError) {
      return Promise.reject(pricingError)
    }
    if (url === '/tesla/vehicle-pricing') {
      return Promise.resolve({ data: { quote: 17, currency: 'USD' } })
    }
    if (url.endsWith('/enterprise-payer')) {
      return Promise.resolve({ data: { updated: true } })
    }
    return Promise.resolve(responseFor(url.replace('/refresh', '')))
  })
}

function renderWorkspace(vehicleId: number | null = VEHICLE_ID) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <VehicleManagementWorkspace vehicleId={vehicleId ?? undefined} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function calls(method?: string): RequestCall[] {
  return (requestMock.mock.calls as RequestCall[]).filter(([, options]) =>
    method ? (options?.method ?? 'GET') === method : true,
  )
}

function endpointCard(id: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(
    `[data-management-endpoint="${id}"]`,
  )
  if (!card) throw new Error(`Missing endpoint card ${id}`)
  return card
}

beforeEach(() => {
  requestMock.mockReset()
  pricingError = null
  optionsError = null
  holdReads = false
  installRequestRouter()
})

describe('VehicleManagementWorkspace', () => {
  it('shows all eight official endpoint cards, reuses cached reads, and never auto-refreshes', async () => {
    renderWorkspace()

    const expectedCards = [
      'vehicle-options',
      'vehicle-specs',
      'warranty-details',
      'subscription-eligibility',
      'upgrade-eligibility',
      'vehicle-pricing',
      'enterprise-roles',
      'enterprise-payer',
    ]
    for (const id of expectedCards) {
      expect(endpointCard(id)).toBeInTheDocument()
    }

    await screen.findByText('Model 3')
    const readURLs = calls('GET').map(([url]) => url)
    expect(readURLs).toEqual(expect.arrayContaining([
      `/vehicles/${VEHICLE_ID}/options`,
      `/vehicles/${VEHICLE_ID}/specs`,
      `/vehicles/${VEHICLE_ID}/subscriptions`,
      `/vehicles/${VEHICLE_ID}/upgrades`,
      '/tesla/warranty',
      `/vehicles/${VEHICLE_ID}/enterprise-roles`,
    ]))
    expect(calls('POST')).toHaveLength(0)

    expect(screen.queryByText('must-never-render')).not.toBeInTheDocument()
    expect(screen.getByText('Redacted')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('[object Object]')
  })

  it('warns about the paid specs result and requires confirmation before refresh', async () => {
    renderWorkspace()
    await screen.findByText('Model 3')
    const card = endpointCard('vehicle-specs')

    expect(card).toHaveTextContent('$0.10')
    fireEvent.click(
      within(card).getByRole('button', { name: 'Refresh from Tesla' }),
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('A successful Tesla response costs $0.10')
    expect(calls('POST')).toHaveLength(0)
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Request $0.10 result' }),
    )

    await waitFor(() =>
      expect(calls('POST').map(([url]) => url)).toContain(
        `/vehicles/${VEHICLE_ID}/specs/refresh`,
      ),
    )
  })

  it('validates and submits the exact non-empty pricing object', async () => {
    renderWorkspace()
    const card = endpointCard('vehicle-pricing')
    fireEvent.click(
      within(card).getByRole('button', { name: 'Open pricing query' }),
    )

    let dialog = screen.getByRole('dialog')
    const textarea = within(dialog).getByLabelText(/JSON object/)
    fireEvent.change(textarea, { target: { value: '[]' } })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Submit pricing query' }),
    )
    expect(
      within(dialog).getByText(/must be a JSON object/i),
    ).toBeInTheDocument()
    expect(calls('POST')).toHaveLength(0)

    const payload = { opaque: { nested: [1, true] } }
    fireEvent.change(textarea, { target: { value: JSON.stringify(payload) } })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Submit pricing query' }),
    )

    await waitFor(() => {
      const pricingCall = calls('POST').find(
        ([url]) => url === '/tesla/vehicle-pricing',
      )
      expect(pricingCall).toBeDefined()
      expect(JSON.parse(String(pricingCall?.[1]?.body))).toEqual({ payload })
    })
    await waitFor(() => {
      dialog = screen.queryByRole('dialog') as HTMLElement
      expect(dialog).not.toBeInTheDocument()
    })
    expect(
      within(endpointCard('vehicle-pricing')).getByText('Request completed'),
    ).toBeInTheDocument()
  })

  it('refreshes cached enterprise roles only after the explicit action', async () => {
    renderWorkspace()
    await screen.findByText('fleet_manager')
    const card = endpointCard('enterprise-roles')

    fireEvent.click(
      within(card).getByRole('button', { name: 'Refresh from Tesla' }),
    )

    await waitFor(() =>
      expect(calls('POST').map(([url]) => url)).toContain(
        `/vehicles/${VEHICLE_ID}/enterprise-roles/refresh`,
      ),
    )
  })

  it('requires a second destructive payer confirmation and sends the exact object', async () => {
    renderWorkspace()
    const card = endpointCard('enterprise-payer')
    fireEvent.click(
      within(card).getByRole('button', { name: 'Configure payer change' }),
    )

    let dialog = screen.getByRole('dialog')
    const payload = { opaque: { nested: [1, true] } }
    fireEvent.change(within(dialog).getByLabelText(/JSON object/), {
      target: { value: JSON.stringify(payload) },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Continue to confirmation' }),
    )

    dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('changes enterprise billing responsibility')
    expect(
      calls('POST').some(([url]) => url.endsWith('/enterprise-payer')),
    ).toBe(false)

    const confirm = within(dialog).getByRole('button', {
      name: 'Change enterprise payer',
    })
    expect(confirm).toBeDisabled()
    fireEvent.change(
      within(dialog).getByLabelText('Type PAYER to confirm the billing change'),
      { target: { value: 'PAYER' } },
    )
    fireEvent.click(confirm)

    await waitFor(() => {
      const payerCall = calls('POST').find(([url]) =>
        url.endsWith('/enterprise-payer'),
      )
      expect(payerCall).toBeDefined()
      expect(JSON.parse(String(payerCall?.[1]?.body))).toEqual({
        payload,
        confirmed: true,
      })
    })
    await waitFor(() => {
      const roleReads = calls('GET').filter(([url]) =>
        url.endsWith('/enterprise-roles'),
      )
      expect(roleReads.length).toBeGreaterThan(1)
    })
  })

  it('keeps cards honest when no vehicle is selected', async () => {
    renderWorkspace(null)

    expect(screen.getByText('Vehicle selection required')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
    await waitFor(() => expect(calls('GET').length).toBeGreaterThan(0))
    expect(
      calls().some(([url]) => url.includes('/vehicles/undefined')),
    ).toBe(false)
    expect(screen.getAllByText('Select a vehicle').length).toBeGreaterThan(0)
    expect(
      within(endpointCard('enterprise-payer')).getByRole('button', {
        name: 'Configure payer change',
      }),
    ).toBeDisabled()
    expect(
      within(endpointCard('warranty-details')).getByRole('button', {
        name: 'Refresh from Tesla',
      }),
    ).toBeEnabled()
    expect(
      within(endpointCard('vehicle-pricing')).getByRole('button', {
        name: 'Open pricing query',
      }),
    ).toBeEnabled()
  })

  it('renders loading, error, and prerequisite-unavailable states without hiding cards', async () => {
    holdReads = true
    installRequestRouter()
    const view = renderWorkspace()
    expect(screen.getAllByText('Loading cached data').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
    view.unmount()

    holdReads = false
    optionsError = new Error('cached options unavailable')
    pricingError = new ApiError(
      'Tesla account lacks vehicle_pricing_info scope',
      403,
    )
    installRequestRouter()
    renderWorkspace()
    expect(await screen.findByText('cached options unavailable')).toBeInTheDocument()

    fireEvent.click(
      within(endpointCard('vehicle-pricing')).getByRole('button', {
        name: 'Open pricing query',
      }),
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/JSON object/), {
      target: { value: '{"opaque":true}' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Submit pricing query' }),
    )
    expect(await screen.findByText('Capability unavailable')).toBeInTheDocument()
    expect(
      screen.getAllByText('Tesla account lacks vehicle_pricing_info scope'),
    ).not.toHaveLength(0)
  })
})
