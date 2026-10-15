import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/feedback/Toast'
import { SelectedVehicleProvider } from '@/store/selectedVehicle'
import { request } from '@/api/client'
import type { TeslaChargingSession } from '@/api/hooks/useCharging'
import TeslaChargingSessionsPage from './TeslaChargingSessionsPage'

vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'), request: vi.fn(),
}))
vi.mock('./TeslaChargingSessionsMap', () => ({ default: () => <div>Map surface retained</div> }))

const observers: { element: Element; callback: ResizeObserverCallback }[] = []
const session: TeslaChargingSession = {
  id: 1, session_id: 101, vin: 'VIN00000000000007', charger_id: 'charger-original',
  site_location_name: 'Real charging site', charge_start_datetime: '2026-10-01T12:00:00Z',
  charge_stop_datetime: '2026-10-01T12:30:00Z', total_energy_added_wh: 0,
  peak_power_kw: null, max_charge_rate_kw: null, charge_duration_s: 0,
  charger_type: 'SUPERCHARGER', currency_code: 'USD', total_cost: 0, per_kwh_rate: null,
  idle_fee: 0, congestion_fee: null, latitude: null, longitude: null,
  fetched_at: '2026-10-02T12:00:00Z', created_at: '2026-10-02T12:00:00Z',
}
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )))
}
beforeEach(() => {
  localStorage.clear()
  observers.length = 0
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }) }
    disconnect() {}
    unobserve() {}
  })
  vi.mocked(request).mockImplementation(async <T,>(path: string): Promise<T> => {
    const response: unknown = path === '/vehicles' ? [{
      id: 7, vehicle_id: 7, vin: session.vin, display_name: 'Test vehicle', model: 'Model 3',
      state: 'online', healthy: true, created_at: session.created_at, updated_at: session.created_at,
    }] : path.startsWith('/tesla/charging/sessions') ? {
      sessions: [session], summary: { total_sessions: 1, total_wh: 0, total_cost: 0, avg_cost_per_kwh: null, peak_power_kw: null },
    } : []
    return response as T
  })
})
afterEach(() => vi.unstubAllGlobals())
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<MemoryRouter initialEntries={['/tesla-charging-sessions?from=2026-10-01&to=2026-10-03']}>
    <QueryClientProvider client={client}><ToastProvider><SelectedVehicleProvider>
      <TeslaChargingSessionsPage />
    </SelectedVehicleProvider></ToastProvider></QueryClientProvider>
  </MemoryRouter>)
}

describe('first real Fleet Charging mobile adoption', () => {
  it('uses the real table model and preserves desktop sections, zero, hidden details and VIN mask', async () => {
    mount()
    const recordsRegion = await screen.findByRole('region', { name: 'Charging sessions table' })
    await waitFor(() => expect(recordsRegion.querySelector('[data-grid-frame]')).not.toBeNull())
    expect(recordsRegion.querySelectorAll('[data-grid-frame]')).toHaveLength(1)
    const frame = recordsRegion.querySelector('[data-grid-frame]') as HTMLElement
    const costRegion = screen.getByRole('region', { name: 'Cost analysis' })
    const chartTable = within(costRegion).getByRole('table', { name: 'Monthly charging cost — data table' })
    expect(within(chartTable).getByRole('cell', { name: '2026-10' })).toBeInTheDocument()
    expect(within(chartTable).getByRole('cell', { name: '0' })).toBeInTheDocument()
    resize(390)
    expect(recordsRegion.querySelectorAll('[data-grid-frame]')).toHaveLength(1)
    expect(frame.querySelector('table')).toBeNull()
    expect(frame.querySelectorAll('[data-mobile-table]')).toHaveLength(1)
    const mobile = frame.querySelector('[data-mobile-table]') as HTMLElement
    expect(mobile).not.toBeNull()
    expect(mobile.querySelectorAll('[data-card]')).toHaveLength(1)
    expect(within(mobile).getByRole('button', { name: 'Real charging site' })).toBeInTheDocument()
    expect(within(mobile).getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByTestId('charging-operational-brief')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeInTheDocument()
    for (const name of ['Fleet charging info', 'Summary metrics', 'Wait forecast', 'Cost analysis', 'Session locations']) {
      expect(screen.getByLabelText(name, { selector: 'section[aria-label]' })).toBeInTheDocument()
    }
    expect(within(costRegion).getByRole('table', { name: 'Monthly charging cost — data table' })).toBe(chartTable)
    expect(within(costRegion).getByText('Energy by charger type')).toBeInTheDocument()
    const locations = screen.getByRole('region', { name: 'Session locations' })
    expect(within(locations).getByText('Top locations by cost')).toBeInTheDocument()
    expect(within(locations).getByText('No location data available yet.')).toBeInTheDocument()
    const detailsTrigger = within(mobile).getByRole('button', { name: 'Quick view' })
    expect(detailsTrigger.parentElement?.closest('button, [role="button"], a[href]')).toBeNull()
    detailsTrigger.focus()
    fireEvent.click(detailsTrigger)
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Rate/kWh')).toBeInTheDocument()
    expect(within(dialog).getByText('charger_id')).toBeInTheDocument()
    expect(within(dialog).getByText('"charger-original"')).toBeInTheDocument()
    expect(within(dialog).getByText('max_charge_rate_kw')).toBeInTheDocument()
    for (const key of ['peak_power_kw', 'max_charge_rate_kw', 'per_kwh_rate', 'congestion_fee', 'latitude', 'longitude']) {
      const field = within(dialog).getByText(key).parentElement as HTMLElement
      expect(within(field).getByText('null')).toBeInTheDocument()
    }
    const energyField = within(dialog).getByText('total_energy_added_wh').parentElement as HTMLElement
    expect(within(energyField).getByText('0')).toBeInTheDocument()
    expect(dialog.textContent).not.toContain(session.vin)
    expect(dialog.textContent).toContain('…000007')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(detailsTrigger).toHaveFocus())
    resize(640)
    expect(frame.querySelectorAll('table')).toHaveLength(1)
    expect(within(frame).getByRole('table', { name: 'tesla-charging-sessions' })).toBeInTheDocument()
    expect(frame.querySelector('[data-mobile-table]')).toBeNull()
    expect(frame.querySelector('[data-card]')).toBeNull()
    expect(frame).toHaveAttribute('data-grid-variant', 'standalone')
    expect(recordsRegion.querySelectorAll('[data-grid-frame]')).toHaveLength(1)
    expect(within(costRegion).getByRole('table', { name: 'Monthly charging cost — data table' })).toBe(chartTable)
    expect(localStorage.getItem('teslasync.table.tesla-charging-sessions.page-size')).toBeNull()
  })

  it('keeps source query identity and real refresh callback unchanged', async () => {
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from Tesla' }))
    await waitFor(() => expect(vi.mocked(request).mock.calls.some(([path]) =>
      path.startsWith('/tesla/charging/sessions/refresh'))).toBe(true))
    expect(vi.mocked(request).mock.calls.some(([path]) =>
      path.startsWith('/tesla/charging/sessions'))).toBe(true)
    expect(vi.mocked(request).mock.calls.some(([path]) => path.includes('/api/v1/api/v1'))).toBe(false)
  })
})
