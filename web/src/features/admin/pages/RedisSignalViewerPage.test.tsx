import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { RedisSignalsResponse } from '@/api/hooks/useRedisSignals'

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
    vehicles: [{ id: 4, display_name: 'DRILL fixture', vin: '' }],
    setVehicleId: state.setVehicleId,
  }),
}))

vi.mock('@/api/hooks/useRedisSignals', () => ({
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
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><RedisSignalViewerPage /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
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
})

describe('RedisSignalViewerPage semantic adoption', () => {
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
      expect(screen.getByText(label)).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Coordinate, click to reveal' })).toBeInTheDocument()
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
