import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { MemoryRouter } from 'react-router-dom'
import type { Vehicle } from '@/types/vehicle'

const {
  useVehiclesMock,
  useSelectedVehicleMock,
  setVehicleIdMock,
  refetchMock,
  endpointQueries,
  refreshEndpointMock,
  workspaceMode,
  refreshSpecsMock,
  operationalMode,
} = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useSelectedVehicleMock: vi.fn(),
  setVehicleIdMock: vi.fn(),
  refetchMock: vi.fn(),
  endpointQueries: new Map<string, Record<string, unknown>>(),
  refreshEndpointMock: vi.fn(),
  workspaceMode: { real: false },
  refreshSpecsMock: vi.fn(),
  operationalMode: { canWrite: true, writeBlockReason: null as string | null },
}))

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => operationalMode,
}))

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: useVehiclesMock,
  useVehicleOptions: () => endpointQueries.get('options'),
  useWarrantyDetails: () => endpointQueries.get('warranty'),
  useVehicleSubscriptions: () => endpointQueries.get('subscriptions'),
  useVehicleUpgrades: () => endpointQueries.get('upgrades'),
  useVehicleSpecs: () => endpointQueries.get('specs'),
  useEnterpriseRoles: () => endpointQueries.get('roles'),
  useRefreshVehicleOptions: () => ({ mutate: refreshEndpointMock }),
  useRefreshWarrantyDetails: () => ({ mutate: vi.fn() }),
  useRefreshVehicleSubscriptions: () => ({ mutate: vi.fn() }),
  useRefreshVehicleUpgrades: () => ({ mutate: vi.fn() }),
  useRefreshVehicleSpecs: () => ({ mutate: refreshSpecsMock, isPending: false }),
  useRefreshEnterpriseRoles: () => ({ mutate: vi.fn() }),
  useVehiclePricing: () => ({ mutate: vi.fn(), isPending: false }),
  useSetEnterprisePayer: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: useSelectedVehicleMock,
}))

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: vi.fn(),
}))

vi.mock('../components/vehicle-management', async () => {
  const { VehicleManagementWorkspace } = await import('../components/vehicle-management/VehicleManagementWorkspace')
  return {
    VehicleManagementWorkspace: ({ vehicleId }: { vehicleId?: number }) => workspaceMode.real
      ? <VehicleManagementWorkspace vehicleId={vehicleId} />
      : (
        <div data-testid="vehicle-management-workspace">
          {vehicleId ? `management:${vehicleId}` : 'management:no-vehicle'}
        </div>
      ),
  }
})

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  )
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        if (typeof fallback !== 'string') return key
        if (!options || typeof options !== 'object') return fallback
        const values = options as Record<string, unknown>
        return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
          String(values[name] ?? `{{${name}}}`),
        )
      },
      i18n: { language: 'en' },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import VehicleManagementPage from './VehicleManagementPage'

function makeVehicle(id: number, name: string): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin: `5YJ3E1EA0PF00000${id}`,
    display_name: name,
    model: 'Model 3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-08-08T20:00:00Z',
    updated_at: '2026-08-08T20:00:00Z',
  }
}

function installHooks({
  vehicles,
  selected = vehicles?.[0] ?? null,
  loading = false,
  error = null,
}: {
  vehicles?: Vehicle[]
  selected?: Vehicle | null
  loading?: boolean
  error?: Error | null
}) {
  useVehiclesMock.mockReturnValue({
    data: vehicles,
    isLoading: loading,
    error,
    refetch: refetchMock,
  })
  useSelectedVehicleMock.mockReturnValue({
    vehicleId: selected?.id ?? null,
    vehicle: selected,
    vehicles: vehicles ?? [],
    setVehicleId: setVehicleIdMock,
  })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/vehicle-management']}>
      <VehicleManagementPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  workspaceMode.real = false
  endpointQueries.clear()
  operationalMode.canWrite = true
  operationalMode.writeBlockReason = null
})

afterEach(() => {
  act(() => {
    setGlobalLocale('en-US')
    setGlobalPrecision(2)
  })
})

describe('VehicleManagementPage', () => {
  it('preserves reported subscription currency and signed amounts in the real workspace', () => {
    workspaceMode.real = true
    setGlobalLocale('en-US')
    setGlobalPrecision(2)
    installHooks({ vehicles: [makeVehicle(1, 'Falcon')] })
    for (const key of ['options', 'warranty', 'subscriptions', 'upgrades', 'specs', 'roles']) {
      endpointQueries.set(key, {
        data: { data: key === 'subscriptions' ? { eligible: [{
          product: 'SUBSCRIPTION', billingOptions: [{
            price: -12.3456, total: 0, currencyCode: 'EUR', billingPeriod: 'MONTHLY',
          }],
        }] } : null, fetched_at: null },
        isSuccess: true, isPending: false, isLoading: false, fetchStatus: 'idle',
      })
    }
    renderPage()
    expect(screen.getByText('-€12.35', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Total €0.00')).toBeInTheDocument()
    act(() => {
      setGlobalLocale('de-DE')
      setGlobalPrecision(4)
    })
    expect(screen.getByText('-12,3456 €', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Total 0,0000 €')).toBeInTheDocument()
    expect(refreshEndpointMock).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
  })

  it('uses numeric preferences in the real workspace without rounding identifiers or raw source data', () => {
    workspaceMode.real = true
    setGlobalLocale('en-US')
    setGlobalPrecision(2)
    const vehicle = makeVehicle(1, 'Falcon')
    installHooks({ vehicles: [vehicle], selected: vehicle })
    const data = Object.freeze({
      capacity: 1234.56789, offset: -2.34567, count: 0,
      missing: null, invalid: Infinity, vehicle_id: 123456, model_year: 2026,
    })
    for (const key of ['options', 'warranty', 'subscriptions', 'upgrades', 'specs', 'roles']) {
      endpointQueries.set(key, {
        data: { data: key === 'specs' ? data : null, fetched_at: null },
        isSuccess: true, isPending: false, isLoading: false, fetchStatus: 'idle',
      })
    }
    renderPage()
    const table = screen.getByRole('table', { name: 'Vehicle specifications' })
    expect(within(table).getByText('1,234.57')).toBeInTheDocument()
    expect(within(table).getByText('-2.35')).toBeInTheDocument()
    expect(within(table).getAllByText('0.00')).toHaveLength(1)
    expect(within(table).queryByRole('rowheader', { name: 'Missing' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('rowheader', { name: 'Invalid' })).not.toBeInTheDocument()
    act(() => {
      setGlobalLocale('de-DE')
      setGlobalPrecision(3)
    })
    expect(within(table).getByText('1.234,568')).toBeInTheDocument()
    expect(within(table).getByText('123456')).toBeInTheDocument()
    expect(within(table).getByText('2026')).toBeInTheDocument()
    const card = table.closest('[data-management-endpoint]')
    if (!(card instanceof HTMLElement)) throw new Error('Missing specification card')
    fireEvent.click(within(card).getByRole('button', { name: 'Technical response details' }))
    expect(within(card).getByText('1234.56789')).toBeInTheDocument()
    expect(refreshSpecsMock).not.toHaveBeenCalled()
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
  })

  it.each([
    { status: null, summary: 'Unknown active of 1 options returned', label: 'Status unknown' },
    { status: false, summary: '0 active of 1 options returned', label: 'Inactive' },
  ])('preserves unknown versus measured zero in the real workspace: %j', ({ status, summary, label }) => {
    workspaceMode.real = true
    const vehicle = makeVehicle(1, 'Falcon')
    installHooks({ vehicles: [vehicle], selected: vehicle })
    for (const key of ['options', 'warranty', 'subscriptions', 'upgrades', 'specs', 'roles']) {
      endpointQueries.set(key, {
        data: {
          data: key === 'options' ? { codes: [{ code: 'OPTION', isActive: status }] } : null,
          fetched_at: null,
        },
        isSuccess: true, isPending: false, isLoading: false, fetchStatus: 'idle',
      })
    }
    renderPage()
    expect(screen.getByText(summary)).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
  })

  it('preserves paid confirmation and the 24-hour disclosure, with readiness scoped away from pricing', () => {
    workspaceMode.real = true
    const vehicle = makeVehicle(1, 'Falcon')
    installHooks({ vehicles: [vehicle], selected: vehicle })
    for (const key of ['options', 'warranty', 'subscriptions', 'upgrades', 'specs', 'roles']) {
      endpointQueries.set(key, {
        data: { data: key === 'specs' ? { model: 'Model 3' } : null, fetched_at: null },
        isSuccess: true, isPending: false, isLoading: false, fetchStatus: 'idle',
      })
    }
    const page = renderPage()
    const specsElement = document.querySelector<HTMLElement>('[data-management-endpoint="vehicle-specs"]')
    if (!specsElement) throw new Error('Missing paid specifications')
    const specs = within(specsElement)
    expect(specs.getByText(/24-hour refresh guard/)).toBeInTheDocument()
    expect(specs.getByText('Model 3')).toBeInTheDocument()
    fireEvent.click(specs.getByRole('button', { name: 'Refresh from Tesla' }))
    expect(refreshSpecsMock).not.toHaveBeenCalled()
    expect(screen.getByText(/A successful Tesla response costs \$0.10/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Request $0.10 result' }))
    expect(refreshSpecsMock).toHaveBeenCalledOnce()

    operationalMode.canWrite = false
    operationalMode.writeBlockReason = 'Return to live mode before making operational changes.'
    page.rerender(<MemoryRouter><VehicleManagementPage /></MemoryRouter>)
    expect(specs.getByRole('button', { name: 'Refresh from Tesla' })).toBeDisabled()
    expect(specs.getByRole('status')).toHaveTextContent(operationalMode.writeBlockReason)
    expect(specs.getByText('Model 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open pricing query' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Configure payer change' })).toBeDisabled()
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
  })

  it('renders a standalone selected-vehicle workspace', () => {
    const first = makeVehicle(1, 'Roadster')
    const second = makeVehicle(2, 'Cybertruck')
    installHooks({ vehicles: [first, second], selected: second })

    renderPage()

    expect(
      screen.getByRole('heading', { level: 1, name: 'Vehicle management' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:2',
    )
    expect(screen.queryByText('Vehicle Command Center')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Select management vehicle')).not.toBeInTheDocument()
  })

  it('reads persistent vehicle selection from the shared header', () => {
    const first = makeVehicle(1, 'Roadster')
    const second = makeVehicle(2, 'Cybertruck')
    installHooks({ vehicles: [first, second], selected: first })

    const page = renderPage()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent('management:1')
    installHooks({ vehicles: [first, second], selected: second })
    page.rerender(<MemoryRouter><VehicleManagementPage /></MemoryRouter>)
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent('management:2')
    expect(setVehicleIdMock).not.toHaveBeenCalled()
  })

  it('keeps the workspace visible for a single-vehicle fleet without a local dropdown', () => {
    const vehicle = makeVehicle(1, 'Falcon')
    installHooks({ vehicles: [vehicle], selected: vehicle })

    renderPage()

    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent('management:1')
    expect(screen.queryByLabelText('Select management vehicle')).not.toBeInTheDocument()
  })

  it('keeps the workspace visible while the fleet loads', () => {
    installHooks({ vehicles: undefined, selected: null, loading: true })

    renderPage()

    expect(screen.getByText('Loading vehicle context')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:no-vehicle',
    )
  })

  it('keeps account-level management visible on roster error and retries', () => {
    installHooks({
      vehicles: undefined,
      selected: null,
      error: new Error('fleet unavailable'),
    })

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText('Vehicle context unavailable')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:no-vehicle',
    )
    expect(refetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders an honest empty-fleet state without hiding endpoint cards', () => {
    installHooks({ vehicles: [], selected: null })

    renderPage()

    expect(screen.getByText('No vehicles available')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent(
      'management:no-vehicle',
    )
  })

  it.each(['paused', 'idle'] as const)('does not call an unresolved %s roster empty', (fetchStatus) => {
    installHooks({ vehicles: undefined, selected: null })
    useVehiclesMock.mockReturnValue({
      data: undefined, isPending: true, isLoading: false,
      fetchStatus, refetch: refetchMock,
    })

    renderPage()

    expect(screen.getByText(fetchStatus === 'paused' ? 'Refresh paused' : 'Awaiting data')).toBeInTheDocument()
    expect(screen.queryByText('No vehicles available')).not.toBeInTheDocument()
    expect(screen.getByTestId('vehicle-management-workspace')).toBeInTheDocument()
  })

  it('distinguishes paused, active and completed endpoint reads without losing shells or recovery', () => {
    workspaceMode.real = true
    const vehicle = makeVehicle(1, 'Falcon')
    installHooks({ vehicles: [vehicle], selected: vehicle })
    for (const key of ['options', 'warranty', 'subscriptions', 'upgrades', 'specs', 'roles']) {
      endpointQueries.set(key, {
        data: undefined, isPending: true, isLoading: false,
        isSuccess: false, fetchStatus: 'paused',
      })
    }
    const page = renderPage()
    const card = (id: string) => {
      const element = document.querySelector<HTMLElement>(`[data-management-endpoint="${id}"]`)
      if (!element) throw new Error(`Missing endpoint ${id}`)
      return within(element)
    }
    const rerender = () => page.rerender(<MemoryRouter><VehicleManagementPage /></MemoryRouter>)
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
    expect(card('vehicle-options').getByText('Refresh paused')).toBeInTheDocument()
    expect(card('vehicle-options').queryByText('No cached data')).not.toBeInTheDocument()
    fireEvent.click(card('vehicle-options').getByRole('button', { name: 'Refresh from Tesla' }))
    expect(refreshEndpointMock).toHaveBeenCalledTimes(1)

    endpointQueries.set('options', {
      data: undefined, isPending: true, isLoading: true,
      isSuccess: false, fetchStatus: 'fetching',
    })
    rerender()
    expect(card('vehicle-options').getByTestId('vehicle-management-loading')).toBeInTheDocument()
    expect(card('warranty-details').getByText('Refresh paused')).toBeInTheDocument()

    endpointQueries.set('options', {
      data: { data: null, fetched_at: null },
      isSuccess: true, isPending: false, isLoading: false, fetchStatus: 'idle',
    })
    rerender()
    expect(card('vehicle-options').getByText('No cached data')).toBeInTheDocument()
    expect(card('vehicle-options').queryByText('No matching data returned')).not.toBeInTheDocument()

    endpointQueries.set('options', {
      data: { data: null, fetched_at: '2026-08-08T12:00:00Z' },
      isSuccess: true, isPending: false, isLoading: false, fetchStatus: 'idle',
    })
    rerender()
    expect(card('vehicle-options').getByText('No matching data returned')).toBeInTheDocument()
    expect(card('vehicle-options').queryByTestId('vehicle-management-loading')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)

    endpointQueries.set('options', {
      data: { data: { codes: [{ code: '$APF2', displayName: 'Full Self-Driving (Supervised)' }] } },
      isSuccess: true, isPending: false, fetchStatus: 'paused',
      dataUpdatedAt: Date.parse('2026-08-08T12:00:00Z'),
    })
    rerender()
    expect(card('vehicle-options').getByText('Full Self-Driving (Supervised)')).toBeInTheDocument()
    expect(card('vehicle-options').getByText('Refresh paused')).toBeInTheDocument()

    endpointQueries.set('options', {
      ...endpointQueries.get('options'), fetchStatus: 'idle',
      error: new Error('refresh failed'), isError: true, isSuccess: false,
    })
    rerender()
    expect(card('vehicle-options').getByText('Full Self-Driving (Supervised)')).toBeInTheDocument()
    expect(card('vehicle-options').getByText('Data may be stale')).toBeInTheDocument()
    expect(card('warranty-details').getByText('Refresh paused')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-management-endpoint]')).toHaveLength(8)
  })

  it('retains the selected management workspace and explains a failed roster refresh', () => {
    const vehicle = makeVehicle(2, 'Cybertruck')
    installHooks({ vehicles: [vehicle], selected: vehicle, error: new Error('refresh failed') })
    renderPage()
    expect(screen.getByTestId('vehicle-management-workspace')).toHaveTextContent('management:2')
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.queryByText('Vehicle context unavailable')).not.toBeInTheDocument()
    expect(setVehicleIdMock).not.toHaveBeenCalled()
  })
})
