import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { RedisSignalsResponse } from '@/api/hooks/useRedisSignals'
import { deriveDataState } from '@/api/dataState'

const state = vi.hoisted(() => ({
  vehicleId: 4 as number | null,
  data: undefined as RedisSignalsResponse | undefined,
  isLoading: false,
  isError: false,
  error: null as Error | null,
  fetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  refetch: vi.fn(),
  purgeOne: vi.fn(),
  purgeAll: vi.fn(),
  setVehicleId: vi.fn(),
  fleetData: [{ id: 4, display_name: 'DRILL fixture', vin: '' }] as { id: number; display_name: string; vin: string }[] | undefined,
  fleetError: null as Error | null,
  fleetFetchStatus: 'idle' as 'idle' | 'paused' | 'fetching',
  fleetRefetch: vi.fn(),
}))

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        if (typeof fallback !== 'string') return key
        return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
          options && name in options ? String(options[name]) : match)
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: state.vehicleId,
    vehicles: state.fleetData ?? [],
    vehiclesState: deriveDataState({
      data: state.fleetData,
      error: state.fleetError,
      fetchStatus: state.fleetFetchStatus,
      isFetching: state.fleetFetchStatus === 'fetching',
      refetch: state.fleetRefetch,
    }),
    setVehicleId: state.setVehicleId,
  }),
}))

vi.mock('@/api/hooks/useRedisSignals', async () => ({
  ...await vi.importActual<typeof import('@/api/hooks/useRedisSignals')>('@/api/hooks/useRedisSignals'),
  useRedisSignals: () => ({
    data: state.data,
    isLoading: state.isLoading,
    isFetching: state.fetchStatus === 'fetching',
    isError: state.isError,
    error: state.error,
    fetchStatus: state.fetchStatus,
    dataUpdatedAt: state.data ? Date.now() : 0,
    refetch: state.refetch,
  }),
  usePurgeRedisSignals: () => ({ mutateAsync: state.purgeOne }),
  usePurgeAllRedisSignals: () => ({ mutateAsync: state.purgeAll }),
}))

vi.mock('@/api/devtools', async () => ({
  ...await vi.importActual<typeof import('@/api/devtools')>('@/api/devtools'),
  getRedisSignalKeys: vi.fn().mockResolvedValue({ keys: [], total: 0 }),
}))

vi.mock('@tanstack/react-virtual', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-virtual')>('@tanstack/react-virtual')
  return {
    ...actual,
    // jsdom has no layout; retain the real virtualizer with a measured test viewport.
    useVirtualizer: (options: Parameters<typeof actual.useVirtualizer>[0]) => actual.useVirtualizer({
      ...options,
      initialRect: { width: 1024, height: 900 },
      observeElementRect: (_instance, callback) => {
        callback({ width: 1024, height: 900 })
        return () => undefined
      },
    }),
  }
})

import { ToastProvider } from '@/components/feedback/Toast'
import { gaugeTone } from '@/lib/tokens'
import RedisSignalViewerPage from './RedisSignalViewerPage'
import { getRedisSignalKeys } from '@/api/devtools'

function fixture(): RedisSignalsResponse {
  return {
    vehicle_id: 4,
    signal_count: 7,
    signals: {
      BatteryLevel: { value: 0, type: 'number' },
      ChargePower: { value: -125.75, type: 'number' },
      VehicleSpeed: { value: 15.123456789, type: 'number' },
      OutsideTemp: { value: -273.15, type: 'number' },
      DoorOpen: { value: false, type: 'boolean' },
      DiagnosticMessage: { value: 'synthetic-long-value-'.repeat(16), type: 'string' },
      DiagnosticBlank: { value: '', type: 'string' },
    },
    meta: {
      live_signal_store_mode: 'hybrid',
      redis_key: 'vehicle:4:signals',
      redis_field_count: 9,
      l1_signal_count: 7,
      vehicle_vin: '',
      l1_last_seen_at: null,
      l2_last_seen_at: null,
    },
  }
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const content = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider><RedisSignalViewerPage /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
  const page = render(content())
  return { ...page, rerenderPage: () => page.rerender(content()) }
}

function signalRow(name: string) {
  const row = screen.getByText(name).closest('tr')
  expect(row).not.toBeNull()
  if (!row) throw new Error('Expected signal table row')
  return within(row)
}

function expectSections() {
  for (const title of ['Cache metrics', 'Cached signals', 'Cache diagnostics', 'Signal categories', 'Cache actions']) {
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.vehicleId = 4
  state.data = fixture()
  state.isLoading = false
  state.isError = false
  state.error = null
  state.fetchStatus = 'idle'
  state.fleetData = [{ id: 4, display_name: 'DRILL fixture', vin: '' }]
  state.fleetError = null
  state.fleetFetchStatus = 'idle'
})

describe('RedisSignalViewerPage semantic adoption', () => {
  it('renders structured JSON and explicit null without changing the backend type or cache identity', () => {
    const object = { nested: { enabled: false, count: 0, missing: null }, label: '<script>fixture</script>' }
    const array = [0, false, '', null, { mode: 'fixture' }]
    state.data = {
      vehicle_id: 4,
      signal_count: 3,
      signals: {
        DiagnosticObject: { value: object, type: 'string', source: 'redis', freshness: 'unknown' },
        DiagnosticArray: { value: array, type: 'string' },
        DiagnosticNull: { value: null, type: 'string' },
      },
      meta: fixture().meta,
    }
    mount()
    for (const [name, value] of Object.entries({ DiagnosticObject: object, DiagnosticArray: array, DiagnosticNull: null })) {
      const row = signalRow(name)
      const code = row.getAllByRole('cell')[1].querySelector('code')
      expect(code?.textContent).toBe(JSON.stringify(value, null, 2))
      expect(code).toHaveClass('whitespace-pre-wrap', 'break-all')
      expect(row.getByText('string')).toBeInTheDocument()
    }
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByText('vehicle:4:signals')).toBeInTheDocument()
    expectSections()
  })

  it('distinguishes an absent boundary value from JSON null, false and measured zero', () => {
    state.data = {
      vehicle_id: 4,
      signal_count: 4,
      signals: {
        DiagnosticMissing: JSON.parse('{"type":"string"}'),
        DiagnosticNull: { value: null, type: 'string' },
        DoorOpen: { value: false, type: 'boolean' },
        BatteryLevel: { value: 0, type: 'number' },
      },
    }
    mount()
    expect(signalRow('DiagnosticMissing').getByText('Unknown')).toBeInTheDocument()
    expect(signalRow('DiagnosticNull').getByText('null')).toBeInTheDocument()
    expect(signalRow('DoorOpen').getByText('false')).toBeInTheDocument()
    expect(signalRow('BatteryLevel').getByText('0')).toBeInTheDocument()
  })

  it('distinguishes unresolved, failed and successful-empty fleet selection and retries the fleet', () => {
    state.vehicleId = null
    state.data = undefined
    state.fleetData = undefined
    state.fleetFetchStatus = 'fetching'
    const page = mount()
    const selector = within(screen.getByTestId('redis-fleet-selector'))
    expect(selector.getByText('Loading...')).toBeInTheDocument()
    expect(selector.getByRole('combobox')).toBeDisabled()
    expect(selector.queryByText('No data available')).not.toBeInTheDocument()
    state.fleetFetchStatus = 'paused'
    page.rerenderPage()
    expect(selector.getByText('Refresh paused')).toBeInTheDocument()
    expect(selector.queryByText('Loading...')).not.toBeInTheDocument()
    expect(selector.queryByText('No data available')).not.toBeInTheDocument()
    fireEvent.click(selector.getByRole('button', { name: 'Retry' }))
    expect(state.fleetRefetch).toHaveBeenCalledTimes(1)
    state.fleetFetchStatus = 'idle'
    state.fleetError = new Error('Fleet failed')
    page.rerenderPage()
    expect(selector.getByRole('alert')).toHaveTextContent('Failed')
    fireEvent.click(selector.getByRole('button', { name: 'Retry' }))
    expect(state.fleetRefetch).toHaveBeenCalledTimes(2)
    expect(state.refetch).not.toHaveBeenCalled()
    state.fleetError = null
    state.fleetData = []
    page.rerenderPage()
    expect(selector.getByText('No data available')).toBeInTheDocument()
    expect(selector.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(selector.getByRole('combobox')).toBeDisabled()
  })

  it('retains populated fleet choices and signals across fleet refresh failure, pause and recovery', () => {
    const page = mount()
    const selector = within(screen.getByTestId('redis-fleet-selector'))
    state.fleetError = new Error('Fleet refresh failed')
    page.rerenderPage()
    expect(selector.getByText('Cached · refresh failed')).toBeInTheDocument()
    expect(selector.getByRole('combobox')).toBeEnabled()
    expect(selector.getByRole('option', { name: 'DRILL fixture' })).toBeInTheDocument()
    expect(signalRow('BatteryLevel').getByText('0')).toBeInTheDocument()
    fireEvent.click(selector.getByRole('button', { name: 'Retry' }))
    expect(state.fleetRefetch).toHaveBeenCalledTimes(1)
    state.fleetError = null
    state.fleetFetchStatus = 'paused'
    page.rerenderPage()
    expect(selector.getByText('Refresh paused')).toBeInTheDocument()
    state.fleetFetchStatus = 'fetching'
    page.rerenderPage()
    expect(selector.getByText('Refreshing')).toBeInTheDocument()
    state.fleetFetchStatus = 'idle'
    page.rerenderPage()
    expect(selector.queryByText('Refreshing')).not.toBeInTheDocument()
    expect(selector.getByRole('combobox')).toHaveValue('4')
    expectSections()
  })

  it.each([
    { name: 'active loading', fetchStatus: 'fetching' as const, message: null },
    { name: 'paused without data', fetchStatus: 'paused' as const, message: 'Refresh paused' },
    { name: 'pending without data', fetchStatus: 'idle' as const, message: 'Pending' },
  ])('does not diagnose an empty cache during $name', async ({ fetchStatus, message }) => {
    state.data = undefined
    state.fetchStatus = fetchStatus
    state.isLoading = fetchStatus === 'fetching'
    const page = mount()
    expectSections()
    if (message) expect(screen.getAllByText(message).length).toBeGreaterThanOrEqual(4)
    const skeletons = page.container.querySelectorAll('[aria-hidden="true"][class*="--skeleton-bg"]')
    if (message) expect(skeletons).toHaveLength(0)
    else expect(skeletons.length).toBeGreaterThanOrEqual(11)
    expect(screen.queryByText('No signals cached for this vehicle')).not.toBeInTheDocument()
    expect(screen.queryByText('Cache diagnostics are unavailable for this vehicle')).not.toBeInTheDocument()
    expect(screen.queryByText('No categorized signals to summarize')).not.toBeInTheDocument()
    expect(screen.queryByTestId('redis-diagnostic-banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    await waitFor(() => expect(getRedisSignalKeys).not.toHaveBeenCalled())
    page.unmount()
  })

  it('preserves successful empty cache diagnostics and measured zero counts', async () => {
    state.data = {
      vehicle_id: 4, signal_count: 0, signals: {},
      meta: { ...fixture().meta!, l1_signal_count: 0, redis_field_count: 0, l1_last_seen_at: new Date().toISOString() },
    }
    mount()
    expectSections()
    expect(screen.getByText('No signals cached for this vehicle')).toBeInTheDocument()
    expect(screen.getByText('No categorized signals to summarize')).toBeInTheDocument()
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
    expect(screen.getByTestId('redis-signals-summary')).toHaveTextContent('0')
    await waitFor(() => expect(getRedisSignalKeys).toHaveBeenCalledTimes(1))
  })

  it('retains all section data through refresh failure and removes the retained state on recovery', () => {
    const page = mount()
    state.isError = true
    state.error = new Error('Synthetic refresh failure')
    page.rerenderPage()
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument()
    expect(signalRow('BatteryLevel').getByText('0')).toBeInTheDocument()
    expect(screen.getByText('vehicle:4:signals')).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar')).toHaveLength(5)
    state.isError = false
    state.error = null
    page.rerenderPage()
    expect(screen.queryByText('Showing retained measurements')).not.toBeInTheDocument()
    expect(screen.getByTestId('redis-signals-summary')).toHaveAttribute('data-retained', 'false')
    expect(signalRow('BatteryLevel').getByText('0')).toBeInTheDocument()
    expectSections()
    expect(getRedisSignalKeys).not.toHaveBeenCalled()
  })

  it('preserves raw SI values, types, diagnostic fields and all five sections', () => {
    mount()
    expectSections()
    for (const [name, value, type] of [
      ['BatteryLevel', '0', 'number'],
      ['ChargePower', '-125.75', 'number'],
      ['VehicleSpeed', '15.123456789', 'number'],
      ['OutsideTemp', '-273.15', 'number'],
      ['DoorOpen', 'false', 'boolean'],
      ['DiagnosticMessage', 'synthetic-long-value-'.repeat(16), 'string'],
    ]) {
      const row = signalRow(name)
      expect(row.getByText(value)).toHaveClass('text-[var(--text-primary)]', 'break-all')
      expect(row.getByText(type)).toBeInTheDocument()
    }
    expect(signalRow('DiagnosticBlank').getAllByRole('cell')[1].textContent).toBe('')
    for (const label of ['Live store mode', 'VIN', 'Redis key', 'L1 signals', 'L2 fields (raw)', 'L1 last seen', 'L2 last seen']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('vehicle:4:signals')).toBeInTheDocument()
    expect(screen.getByLabelText('Select vehicle')).toHaveValue('4')
    expect(state.purgeOne).not.toHaveBeenCalled()
    expect(state.purgeAll).not.toHaveBeenCalled()
  })

  it('keeps category cells reachable on mobile and uses neutral solid count bars', () => {
    mount()
    expect(signalRow('OutsideTemp').getByText('Climate').closest('td')).not.toHaveClass('hidden')
    expect(signalRow('DoorOpen').getByText('boolean')).toHaveClass('text-[var(--text-secondary)]')
    const counts = { Battery: 1, Charging: 1, Driving: 1, Climate: 1, Other: 3 }
    expect(screen.getAllByRole('progressbar')).toHaveLength(5)
    for (const [name, count] of Object.entries(counts)) {
      const bar = screen.getByRole('progressbar', { name })
      expect(bar).toHaveAttribute('aria-valuenow', String(count))
      expect(bar).toHaveAttribute('aria-valuemax', '7')
      expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({ background: gaugeTone.neutral })
    }
  })

  it('retains coordinate masking without changing the loaded signal identity', () => {
    state.data = {
      vehicle_id: 4,
      signal_count: 1,
      signals: { Latitude: { value: 12.345678, type: 'number' } },
    }
    mount()
    expect(signalRow('Latitude').getByText('number')).toBeInTheDocument()
    expect(screen.getByLabelText('Coordinate, click to reveal')).toBeInTheDocument()
    expect(screen.queryByText('12.345678')).not.toBeInTheDocument()
    expect(state.purgeOne).not.toHaveBeenCalled()
  })

  it('preserves name and category filtering while counts remain scoped to all signals', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Filter signals by name'), { target: { value: 'outside' } })
    expect(signalRow('OutsideTemp').getByText('-273.15')).toBeInTheDocument()
    expect(screen.queryByText('BatteryLevel')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Other' })).toHaveAttribute('aria-valuenow', '3')
    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'Battery' } })
    expect(screen.getByText('No signals match the current filter')).toBeInTheDocument()
    expectSections()
    fireEvent.change(screen.getByLabelText('Filter signals by name'), { target: { value: '' } })
    expect(signalRow('BatteryLevel').getByText('0')).toBeInTheDocument()
  })

  it.each([
    { name: 'refresh failure', paused: false },
    { name: 'paused refresh', paused: true },
  ])('keeps measurements and diagnostics visibly retained during $name', ({ paused }) => {
    state.isError = !paused
    state.error = paused ? null : new Error('Synthetic refresh failure')
    state.fetchStatus = paused ? 'paused' : 'idle'
    mount()
    expect(screen.getByTestId('redis-signals-summary')).toHaveAttribute('data-retained', 'true')
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument()
    expect(signalRow('ChargePower').getByText('-125.75')).toBeInTheDocument()
    expect(screen.getByText('vehicle:4:signals')).toBeInTheDocument()
    expectSections()
  })

  it.each([
    { name: 'no selection', loading: false },
    { name: 'initial loading', loading: true },
  ])('keeps section shells and actions present during $name', ({ loading }) => {
    state.data = undefined
    state.isLoading = loading
    state.vehicleId = loading ? 4 : null
    mount()
    expectSections()
    expect(screen.getByRole('button', { name: 'Purge all Redis' })).toBeInTheDocument()
    if (!loading) {
      expect(screen.getByRole('button', { name: 'Purge Redis (L2)' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    }
  })

  it('uses restrained purge entries while preserving danger and exact typed confirmation', () => {
    mount()
    const purgeAll = screen.getByRole('button', { name: 'Purge all Redis' })
    expect(purgeAll).toHaveClass('border-[var(--control-border)]')
    fireEvent.click(purgeAll)
    const dialog = within(screen.getByRole('dialog'))
    const confirm = dialog.getByRole('button', { name: 'Purge all vehicles' })
    expect(confirm).toBeDisabled()
    fireEvent.change(dialog.getByLabelText('Type PURGE ALL to confirm'), { target: { value: 'purge all' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(dialog.getByLabelText('Type PURGE ALL to confirm'), { target: { value: 'PURGE ALL' } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(state.purgeOne).not.toHaveBeenCalled()
    expect(state.purgeAll).not.toHaveBeenCalled()
  })
})
