import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { ApiError } from '@/api/client'
import { ManagementEndpointCard } from './ManagementEndpointCard'
import * as apiClient from '@/api/client'
import { useRefreshVehicleSpecs, useVehiclePricing } from '@/api/hooks/useVehicles'
import { parseVehicleOptions, parseWarrantyDetails } from './managementData'
import { WarrantyDataView } from './WarrantyDataView'
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions'

/** Pin a face tile's label and exact numeric value (tiles render label first, then value). */
function expectTileValue(brief: HTMLElement, id: string, label: string, value: string) {
  const tile = brief.querySelector(`[data-operational-metric="${id}"]`)
  if (!(tile instanceof HTMLElement)) throw new Error(`Missing tile ${id}`)
  expect(tile).toHaveTextContent(label)
  const face = tile.querySelector('[data-operational-value]')
  if (!(face instanceof HTMLElement)) throw new Error(`Missing face value ${id}`)
  expect(face).toHaveTextContent(value)
}

const preferences = vi.hoisted(() => ({
  locale: 'en-US',
  timezone: 'UTC',
}))
const operationalMode = vi.hoisted(() => ({
  canWrite: true,
  writeBlockReason: null as string | null,
}))

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => operationalMode,
}))
vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: { tz_display_default: 'user' },
    locale: preferences.locale,
  }),
}))

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => preferences.timezone,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback ?? key,
      ),
    i18n: { language: 'en' },
  }),
}))

const baseProps = {
  endpointId: 'vehicle-specs',
  title: 'Vehicle specifications',
  description: 'Returned Tesla specification fields',
  endpoint: '/api/1/vehicles/{vehicle_id}/vehicle_specs',
  prerequisite: 'user' as const,
  kind: 'specs' as const,
  fetchedAt: '2026-08-08T12:00:00Z',
}

describe('ManagementEndpointCard preservation', () => {
  it.each([undefined, null, '', 'invalid', NaN, Infinity, -Infinity, true])(
    'keeps unknown subscription amounts separate from measured zero: %s',
    (value) => {
      render(<MemoryRouter><ManagementEndpointCard {...baseProps}
        endpointId="subscription-eligibility" kind="subscriptions"
        data={{ eligible: [{ product: 'SUBSCRIPTION', billingOptions: [
          { price: value, total: value, currencyCode: 'USD', billingPeriod: 'MONTHLY' },
          { price: 0, total: 0, currencyCode: 'USD', billingPeriod: 'YEARLY' },
        ] }] }}
      /></MemoryRouter>)
      expect(screen.getByText('—')).toBeInTheDocument()
      expect(screen.getAllByText('$0.00', { exact: false })).toHaveLength(2)
      expect(screen.getByText('Total $0.00')).toBeInTheDocument()
      expect(screen.queryByText('Total —')).not.toBeInTheDocument()
    },
  )

  it.each([
    { price: -1234.5678, total: 0, currencyCode: 'EUR', first: '-€1,234.57', second: '-1.234,568 €', totalText: 'Total 0,000 €' },
    { price: '12.3456', total: '-2.3456', currencyCode: '$', first: '$ 12.35', second: '$ 12,346', totalText: 'Total $ -2,346' },
    { price: 12.3456, total: -2.3456, currencyCode: null, first: '12.35', second: '12,346', totalText: 'Total -2,346' },
  ])('reacts to money preferences without guessing currency: %j', ({ price, total, currencyCode, first, second, totalText }) => {
    setGlobalPrecision(0)
    const data = Object.freeze({ eligible: [{ product: 'SUBSCRIPTION', billingOptions: [
      { price, total, currencyCode, billingPeriod: 'MONTHLY' },
    ] }] })
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      endpointId="subscription-eligibility" kind="subscriptions" data={data}
    /></MemoryRouter>)
    expect(screen.getByText(first, { exact: false })).toBeInTheDocument()
    act(() => {
      setGlobalLocale('de-DE')
      setGlobalPrecision(3)
    })
    expect(screen.getByText(second, { exact: false })).toBeInTheDocument()
    expect(screen.getByText(totalText)).toBeInTheDocument()
    expect(data.eligible[0].billingOptions[0]).toEqual({ price, total, currencyCode, billingPeriod: 'MONTHLY' })
  })

  afterEach(() => {
    act(() => {
      setGlobalLocale('en-US')
      setGlobalPrecision(2)
    })
  })

  beforeEach(() => {
    preferences.locale = 'en-US'
    preferences.timezone = 'UTC'
    operationalMode.canWrite = true
    operationalMode.writeBlockReason = null
  })

  it('updates primary specification numbers with preferences while retaining exact technical values', () => {
    setGlobalLocale('en-US')
    setGlobalPrecision(2)
    const data = Object.freeze({
      battery_capacity: 1234.56789, offset: -2.34567, count: 0,
      vehicle_id: 123456, vehicleId: 123456, model_year: 2026,
      option_code: 12345, latitude: 37.1234567, software_version: 2026.1234,
      source_precision: 0.1234567, numeric_string: '0012.34567', enabled: false,
    })
    render(<MemoryRouter><ManagementEndpointCard {...baseProps} data={data} /></MemoryRouter>)
    const table = screen.getByRole('table', { name: 'Vehicle specifications' })
    expect(within(table).getByText('1,234.57')).toBeInTheDocument()
    expect(within(table).getByText('-2.35')).toBeInTheDocument()
    expect(within(table).getByText('0.00')).toBeInTheDocument()
    for (const exact of ['123456', '2026', '12345', '37.1234567', '2026.1234', '0.1234567', '0012.34567', 'No']) {
      expect(within(table).getByText(exact)).toBeInTheDocument()
    }
    expect(within(table).getAllByRole('rowheader', { name: 'Vehicle ID' })).toHaveLength(1)
    act(() => {
      setGlobalLocale('de-DE')
      setGlobalPrecision(3)
    })
    expect(within(table).getByText('1.234,568')).toBeInTheDocument()
    expect(within(table).getByText('-2,346')).toBeInTheDocument()
    expect(within(table).getByText('0,000')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Technical response details' }))
    const raw = screen.getByTestId('management-structured-data')
    expect(within(raw).getByText('1234.56789')).toBeInTheDocument()
    expect(within(raw).getByText('-2.34567')).toBeInTheDocument()
    expect(within(raw).getByText('0')).toBeInTheDocument()
    expect(data.battery_capacity).toBe(1234.56789)
    expect(table).not.toHaveTextContent(/kWh|Wh|km|mi/)
  })

  it.each([undefined, null, '', 'invalid', NaN, Infinity, -Infinity])(
    'does not turn absent or invalid specifications into measured zero: %s',
    (value) => {
      setGlobalPrecision(2)
      render(<MemoryRouter><ManagementEndpointCard {...baseProps}
        data={{ model: 'Model 3', battery_capacity: value, count: 0 }}
      /></MemoryRouter>)
      const table = screen.getByRole('table', { name: 'Vehicle specifications' })
      expect(within(table).getAllByText('0.00')).toHaveLength(1)
      const row = within(table).queryByRole('rowheader', { name: 'Battery capacity' })?.closest('tr')
      if (typeof value === 'string') {
        expect(row).toBeDefined()
        if (value.length > 0) expect(row).toHaveTextContent(value)
        expect(row).not.toHaveTextContent('0.00')
      } else {
        expect(row).toBeUndefined()
      }
      expect(within(table).getByText('Model 3')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Technical response details' })).toBeInTheDocument()
    },
  )

  it.each([undefined, null, '', 'invalid', 0, 1, -1, 0.5, NaN, Infinity])(
    'keeps total-active unknown for an absent or invalid option status: %s',
    (status) => {
      const data = { codes: [
        { code: 'ACTIVE', isActive: true },
        { code: 'INACTIVE', isActive: false },
        { code: 'UNKNOWN', isActive: status },
      ] }
      expect(parseVehicleOptions(data).map((option) => option.isActive)).toEqual([true, false, null])
      render(<MemoryRouter><ManagementEndpointCard {...baseProps}
        endpointId="vehicle-options" kind="options" data={data}
      /></MemoryRouter>)
      expect(screen.getByText('Unknown active of 3 options returned')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
      expect(screen.getByText('Inactive')).toBeInTheDocument()
      expect(screen.getByText('Status unknown')).toBeInTheDocument()
      expect(screen.queryByText('1 active of 3 options returned')).not.toBeInTheDocument()
      expect(data.codes[2].isActive).toBe(status)
    },
  )

  it.each([
    { statuses: [false, false], count: 0 },
    { statuses: [true, false], count: 1 },
    { statuses: ['true', 'false'], count: 1 },
  ])('preserves a known active count including genuine zero: %j', ({ statuses, count }) => {
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      endpointId="vehicle-options" kind="options"
      data={{ codes: statuses.map((isActive, index) => ({ code: `OPTION-${index}`, isActive })) }}
    /></MemoryRouter>)
    expect(screen.getByText(`${count} active of 2 options returned`)).toBeInTheDocument()
    expect(screen.queryByText('Status unknown')).not.toBeInTheDocument()
  })

  it.each([undefined, null, '', 'invalid', NaN, Infinity])(
    'keeps missing or invalid warranty measurements distinct from zero: %s',
    (value) => {
      const parsed = parseWarrantyDetails({
        activeWarranty: [{ displayName: 'Coverage', coverageAgeInYears: value, expirationOdometer: value }],
      })
      expect(parsed.active[0]).toMatchObject({ coverageAgeYears: null, expirationOdometer: null })
    },
  )

  it.each([0, -2, 2.5, '0', '-2', '2.5'])(
    'preserves finite zero, signed and fractional warranty measurements: %s',
    (value) => {
      const parsed = parseWarrantyDetails({
        activeWarranty: [{ displayName: 'Coverage', coverageAgeInYears: value, expirationOdometer: value }],
      })
      expect(parsed.active[0]).toMatchObject({
        coverageAgeYears: Number(value), expirationOdometer: Number(value),
      })
    },
  )

  it.each([undefined, 'unknown', 'unrecognized'])(
    'retains a bare warranty without inventing active status: %s',
    (status) => {
      const data = Object.freeze({
        warrantyDisplayName: 'Bare warranty',
        warrantyCode: 'BARE',
        coverageAgeInYears: 4,
        expirationOdometer: 80000,
        endDate: '2030-06-15',
        status,
      })
      const parsed = parseWarrantyDetails(data)
      expect(parsed.active).toEqual([])
      expect(parsed.upcoming).toEqual([])
      expect(parsed.expired).toEqual([])
      expect(parsed.unknown).toEqual([{
        state: 'unknown', displayName: 'Bare warranty', code: 'BARE',
        coverageAgeYears: 4, coverageAgeMonths: null,
        expirationOdometer: 80000, expirationDate: '2030-06-15',
      }])

      render(<MemoryRouter><ManagementEndpointCard {...baseProps}
        endpointId="warranty-details" kind="warranty" data={data}
      /></MemoryRouter>)
      expect(screen.getByText('Bare warranty')).toBeInTheDocument()
      const coverageCard = screen.getByText('Bare warranty').closest('div.rounded-xl')
      if (!(coverageCard instanceof HTMLElement)) throw new Error('Coverage card missing')
      expect(within(coverageCard).getByText('Unknown')).toBeInTheDocument()
      expect(screen.getByText('4 years')).toBeInTheDocument()
      expect(screen.getByText('80,000')).toBeInTheDocument()
      expect(screen.getByText(/2030/)).toBeInTheDocument()
      expect(screen.getByTestId('vehicle-warranty-counts')).not.toHaveTextContent(/0 (active|upcoming|expired)/)
      fireEvent.click(screen.getByRole('button', { name: 'Technical response details' }))
      expect(screen.getByText('2030-06-15')).toBeInTheDocument()
      expect(data.status).toBe(status)
    },
  )

  it.each([
    { activeWarranty: [{ displayName: 'Reported coverage' }] },
    { active_warranties: [{ display_name: 'Reported coverage' }] },
  ])('keeps missing warranty groups unknown alongside populated coverage: %j', (data) => {
    render(<WarrantyDataView data={data} />)
    const brief = screen.getByTestId('vehicle-warranty-counts')
    expectTileValue(brief, 'active', 'Active', '1')
    expect(brief).not.toHaveTextContent(/0 (upcoming|expired)/)
    assertOperationalMetricUnavailable(brief, 'Upcoming')
    assertOperationalMetricUnavailable(brief, 'Expired')
    expect(screen.getByText('Reported coverage')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Technical response details' }))
    expect(screen.getAllByText('Reported coverage')).toHaveLength(2)
  })

  it('distinguishes an explicit empty group from an omitted group in a partial response', () => {
    render(<WarrantyDataView data={{
      activeWarranty: [{ displayName: 'Reported coverage' }],
      upcomingWarranty: [],
    }} />)
    const brief = screen.getByTestId('vehicle-warranty-counts')
    expectTileValue(brief, 'active', 'Active', '1')
    expectTileValue(brief, 'upcoming', 'Upcoming', '0')
    expect(brief).not.toHaveTextContent('0 expired')
    expect(brief.querySelector('[data-operational-metric="active"]')).toHaveAttribute('data-value-state', 'value')
    expect(brief.querySelector('[data-operational-metric="upcoming"]')).toHaveAttribute('data-value-state', 'value')
    expect(brief.querySelector('[data-operational-metric="expired"]')).toBeNull()
    assertOperationalMetricUnavailable(brief, 'Expired')
  })

  it.each([null, {}, { activeWarranty: null }, { activeWarranty: 'unsupported' }, { activeWarranty: [{}] }])(
    'does not fabricate zero counts for absent or unrecognized groups: %j',
    (data) => {
      render(<WarrantyDataView data={data} />)
      const brief = screen.getByTestId('vehicle-warranty-counts')
      expect(brief).not.toHaveTextContent(/0 (active|upcoming|expired)/)
      assertOperationalMetricUnavailable(brief, 'Active')
      assertOperationalMetricUnavailable(brief, 'Upcoming')
      assertOperationalMetricUnavailable(brief, 'Expired')
    },
  )

  it.each([
    { activeWarranty: [], upcomingWarranty: [], expiredWarranty: [] },
    { active_warranties: [], upcoming_warranties: [], expired_warranties: [] },
  ])('shows genuine zero counts for explicit successful empty groups: %j', (data) => {
    render(<WarrantyDataView data={data} />)
    const brief = screen.getByTestId('vehicle-warranty-counts')
    expectTileValue(brief, 'active', 'Active', '0')
    expectTileValue(brief, 'upcoming', 'Upcoming', '0')
    expectTileValue(brief, 'expired', 'Expired', '0')
    expect(screen.getByText('No warranty coverage returned')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Technical response details' })).toBeInTheDocument()
  })

  it('preserves populated counts and cards for every reported group', () => {
    render(<WarrantyDataView data={{
      activeWarranty: [{ displayName: 'Active coverage' }],
      upcomingWarranty: [{ displayName: 'Upcoming coverage' }],
      expiredWarranty: [{ displayName: 'Expired coverage' }],
    }} />)
    const brief = screen.getByTestId('vehicle-warranty-counts')
    for (const [id, label] of [['active', 'Active'], ['upcoming', 'Upcoming'], ['expired', 'Expired']]) {
      expectTileValue(brief, id, label, '1')
    }
    for (const name of ['Active coverage', 'Upcoming coverage', 'Expired coverage']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it.each(['active', 'upcoming', 'expired'] as const)(
    'classifies bare warranty only when the source reports %s',
    (state) => {
      const parsed = parseWarrantyDetails({
        display_name: 'Source-classified warranty',
        warranty_status: state,
        expiration_date: '2030-06-15',
      })
      expect(parsed[state]).toHaveLength(1)
      expect(parsed[state][0]).toMatchObject({
        state, displayName: 'Source-classified warranty',
        expirationDate: '2030-06-15',
      })
      expect(parsed.unknown).toBeUndefined()
    },
  )

  it('preserves every source-reported warranty group without reclassifying by date', () => {
    const parsed = parseWarrantyDetails({
      activeWarranty: [{ displayName: 'Active coverage', endDate: '2000-01-01' }],
      upcoming_warranty: [{ display_name: 'Upcoming coverage' }],
      expiredWarranties: [{ displayName: 'Expired coverage', endDate: '2099-01-01' }],
    })
    expect(parsed.active[0]).toMatchObject({ state: 'active', displayName: 'Active coverage' })
    expect(parsed.upcoming[0]).toMatchObject({ state: 'upcoming', displayName: 'Upcoming coverage' })
    expect(parsed.expired[0]).toMatchObject({ state: 'expired', displayName: 'Expired coverage' })
    expect(parsed.unknown).toBeUndefined()
  })

  it('formats the raw cached instant with current locale and timezone preferences', () => {
    const props = { ...baseProps, data: Object.freeze({ model: 'Model 3' }) }
    const { rerender } = render(
      <MemoryRouter><ManagementEndpointCard {...props} /></MemoryRouter>,
    )
    const expectedTime = (locale: string, timeZone: string) =>
      new Intl.DateTimeFormat(locale, {
        timeZone,
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(baseProps.fetchedAt))

    expect(screen.getByText(`Cached ${expectedTime('en-US', 'UTC')}`)).toBeInTheDocument()

    preferences.locale = 'de-DE'
    preferences.timezone = 'America/Los_Angeles'
    rerender(<MemoryRouter><ManagementEndpointCard {...props} /></MemoryRouter>)

    expect(screen.getByText(`Cached ${expectedTime('de-DE', 'America/Los_Angeles')}`)).toBeInTheDocument()
    expect(screen.queryByText(`Cached ${expectedTime('en-US', 'UTC')}`)).not.toBeInTheDocument()
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    expect(props.fetchedAt).toBe('2026-08-08T12:00:00Z')
    expect(props.data).toEqual({ model: 'Model 3' })
  })

  it('preserves the not-cached state when no source timestamp exists', () => {
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      fetchedAt={null} data={{ model: 'Model 3' }}
    /></MemoryRouter>)
    expect(screen.getByText('Not cached')).toBeInTheDocument()
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    expect(screen.queryByText(/^Cached /)).not.toBeInTheDocument()
  })

  it('retains cached specifications, endpoint identity and refresh controls on a failed refresh', () => {
    const onRefresh = vi.fn()
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      data={{ model: 'Model 3', exterior_color: 'Midnight Silver Metallic' }}
      error={new Error('refresh failed')} onRefresh={onRefresh}
    /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: baseProps.title })).toBeInTheDocument()
    const card = document.querySelector('[data-management-endpoint="vehicle-specs"]')
    if (!(card instanceof HTMLElement)) throw new Error('Endpoint identity missing')
    expect(within(card).getByText(baseProps.endpoint)).toBeInTheDocument()
    expect(within(card).getByText('Model 3')).toBeInTheDocument()
    expect(within(card).getByText('Midnight Silver Metallic')).toBeInTheDocument()
    expect(within(card).getByText('Data may be stale')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Refresh from Tesla' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('keeps a completed empty response distinct from a failed initial read', () => {
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      data={{}} error={new Error('refresh failed')}
    /></MemoryRouter>)
    expect(screen.getByText('No matching data returned')).toBeInTheDocument()
    expect(screen.getByText('Data may be stale')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('preserves prerequisite-denial context alongside cached data', () => {
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      data={{ model: 'Model 3' }} error={new ApiError('Partner scope required', 412)}
    /></MemoryRouter>)
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    expect(screen.getByText('Prerequisite required')).toBeInTheDocument()
    expect(screen.getByText('Partner scope required')).toBeInTheDocument()
  })

  it.each([
    'Return to live mode before making operational changes.',
    'Reconnect before making operational changes.',
  ])('explains paid-spec readiness without hiding populated data: %s', (reason) => {
    operationalMode.canWrite = false
    operationalMode.writeBlockReason = reason
    const onRefresh = vi.fn()
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      data={{ model: 'Model 3' }} onRefresh={onRefresh}
    /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent(reason)
    expect(screen.getByText('Model 3')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Refresh from Tesla' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('does not classify the read-only pricing POST as a live-only physical action', () => {
    operationalMode.canWrite = false
    operationalMode.writeBlockReason = 'Return to live mode before making operational changes.'
    const onRefresh = vi.fn()
    render(<MemoryRouter><ManagementEndpointCard {...baseProps}
      kind="pricing" endpoint="POST /api/1/dx/vehicles/pricing"
      data={{ price: 42000 }} onRefresh={onRefresh}
    /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Tesla' }))
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('paid specifications transport', () => {
  it.each(['historical', 'offline'] as const)('rejects paid requests before the network when %s', async (mode) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const fetch = vi.spyOn(globalThis, 'fetch')
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(mode !== 'offline')
    const originalURL = window.location.href
    window.history.replaceState(null, '', mode === 'historical' ? '/?as_of=2026-08-08T12:00:00Z' : '/')
    onlineManager.setOnline(mode !== 'offline')
    try {
      const hook = renderHook(() => useRefreshVehicleSpecs('7'), { wrapper })
      await expect(hook.result.current.mutateAsync()).rejects.toMatchObject({
        code: 'OPERATIONAL_MODE_READ_ONLY',
        mode: mode === 'historical' ? 'as_of' : 'cached',
      })
      expect(fetch).not.toHaveBeenCalled()
      hook.unmount()
    } finally {
      window.history.replaceState(null, '', originalURL)
      onlineManager.setOnline(true)
      client.clear()
      online.mockRestore()
      fetch.mockRestore()
    }
  })

  it('opts into live-only requests without queuing offline and preserves paid confirmation', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: {} })
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    onlineManager.setOnline(false)
    try {
      const hook = renderHook(() => useRefreshVehicleSpecs('7'), { wrapper })
      await hook.result.current.mutateAsync()
      expect(request).toHaveBeenCalledWith('/vehicles/7/specs/refresh', {
        method: 'POST', requiresLiveMode: true,
        body: JSON.stringify({ confirmed: true }),
      })
      hook.unmount()
    } finally {
      onlineManager.setOnline(true)
      client.clear()
      request.mockRestore()
    }
  })

  it('keeps account pricing read-only at the request boundary', async () => {
    const request = vi.spyOn(apiClient, 'request').mockResolvedValue({ data: {} })
    const client = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    try {
      const hook = renderHook(() => useVehiclePricing(), { wrapper })
      await hook.result.current.mutateAsync({ payload: { market: 'US' } })
      expect(request).toHaveBeenCalledWith('/tesla/vehicle-pricing', {
        method: 'POST', body: JSON.stringify({ payload: { market: 'US' } }),
      })
      hook.unmount()
    } finally {
      client.clear()
      request.mockRestore()
    }
  })
})
