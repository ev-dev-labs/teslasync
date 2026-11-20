import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Geofence } from '@/api/types'
import type {
  SmartChargingLatestStart,
  SmartChargingPlan,
  SmartChargingPlanInput,
} from '@/types/smartCharging'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: (...args: unknown[]) => requestMock(...args),
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ tz: timeZone, formatDateTime: (value: string) => value }),
}))

import { ApiError } from '@/api/client'
import { personalIdentityKey } from '@/api/hooks/usePersonalIdentity'
import { smartChargingKeys } from '@/api/hooks/useSmartCharging'
import { SmartChargingSettings } from './SmartChargingSettings'

const place: Geofence = {
  id: 9, name: 'Synthetic charger', polygon_wkt: 'POLYGON EMPTY', enabled: true,
  needs_review: false, is_charging_location: true, origin: 'manual', alert_on_entry: false,
  alert_on_exit: false, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  latitude: 0, longitude: 0, radius: 1,
}
let plans: SmartChargingPlan[]
let latestStarts: SmartChargingLatestStart[]
let places: Geofence[]
let identityMode: 'forward_auth' | 'open'
let failure: ApiError | null
let timeZone: string

function renderSettings(url = '/settings/smart-charging?vehicle_id=42') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[url]}><SmartChargingSettings active /></MemoryRouter>
  </QueryClientProvider>)
  return { client, ...result }
}

function fillPlan(notify: string, departure: string) {
  fireEvent.change(screen.getByLabelText(/Known charging place/), { target: { value: '9' } })
  fireEvent.change(screen.getByLabelText(/Check from/), { target: { value: notify } })
  fireEvent.change(screen.getByLabelText(/Planned departure/), { target: { value: departure } })
  fireEvent.change(screen.getByLabelText(/Estimated round-trip use, low/), { target: { value: '35' } })
  fireEvent.change(screen.getByLabelText(/Estimated round-trip use, high/), { target: { value: '45' } })
  fireEvent.change(screen.getByLabelText(/Desired return reserve/), { target: { value: '20' } })
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-07T12:00:00Z'))
  timeZone = 'UTC'
  plans = []
  latestStarts = []
  places = [place]
  identityMode = 'forward_auth'
  failure = null
  requestMock.mockReset()
  requestMock.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/system/auth-mode') return { mode: identityMode, subject: 'synthetic-a' }
    if (path === '/vehicles') return [{ id: 42, display_name: 'Synthetic A' }, { id: 43, display_name: 'Synthetic B' }]
    if (path === '/geofences') return places
    if (path === '/smart-charging/plans?vehicle_id=42&limit=100&offset=0') {
      if (failure) throw failure
      return { data: plans }
    }
    if (path === '/smart-charging/latest-start?vehicle_id=42') return { data: latestStarts }
    if (path === '/smart-charging/plans?vehicle_id=43&limit=100&offset=0') return { data: [] }
    if (path === '/smart-charging/plans' && options?.method === 'POST') {
      const input = JSON.parse(String(options.body)) as SmartChargingPlanInput
      plans = [{ ...input, id: 8, snoozed_until: null, created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z' }]
      return { data: plans[0] }
    }
    if (path === '/smart-charging/plans/8' && options?.method === 'PUT') {
      const input = JSON.parse(String(options.body)) as SmartChargingPlanInput
      plans = plans.map((plan) => ({ ...plan, ...input }))
      return { data: plans[0] }
    }
    if (path === '/smart-charging/plans/8/snooze' && options?.method === 'POST') {
      const input = JSON.parse(String(options.body)) as { duration_s: number }
      plans = plans.map((plan) => ({ ...plan, snoozed_until: input.duration_s ? '2026-03-07T13:00:00Z' : null }))
      return undefined
    }
    if (path === '/smart-charging/plans/8?vehicle_id=42' && options?.method === 'DELETE') {
      plans = []
      return undefined
    }
    throw new Error(`Unexpected request: ${path}`)
  })
})

afterEach(() => vi.restoreAllMocks())

describe('private charging readiness settings', () => {
  it('creates an off-by-default plan, then enables, snoozes, pauses and deletes it explicitly', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a trip plan' }))
    const enabled = screen.getByRole('switch', { name: 'Enable readiness checks for this plan' })
    expect(enabled).toHaveAttribute('aria-checked', 'false')
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
    fillPlan('2026-03-08T12:00', '2026-03-08T18:00')
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(await screen.findByText(/Status: Paused/)).toBeInTheDocument()
    const created = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans' && options?.method === 'POST')
    expect(created?.[1]).toMatchObject({
      requiresLiveMode: true, headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-a' },
    })
    expect(JSON.parse(String(created?.[1].body))).toEqual({
      vehicle_id: 42, charging_place_id: 9, enabled: false,
      notify_at: '2026-03-08T12:00:00.000Z', departure_at: '2026-03-08T18:00:00.000Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20,
      compare_site_rates: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText(/Status: Active/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Snooze for 1 hour' }))
    expect(await screen.findByText(/Status: Snoozed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    expect(await screen.findByText(/Status: Active/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(await screen.findByText(/Status: Paused/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this plan?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete plan' }))
    expect(await screen.findByText(/No trip plan is saved/)).toBeInTheDocument()
    expect(requestMock.mock.calls.some(([path]) => /traffic|push|command/.test(String(path)))).toBe(false)
  })

  it('records a dated charging start and preserves it when the plan is resumed', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a trip plan' }))
    fillPlan('2026-03-08T12:00', '2026-03-08T18:00')
    fireEvent.change(screen.getByLabelText('Intended charging start (optional)'), { target: { value: '2026-03-08T17:00' } })
    fireEvent.change(screen.getByLabelText('Maximum site power (W, optional)'), { target: { value: '1800' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(await screen.findByText(/Status: Paused/)).toBeInTheDocument()
    const expectedStart = { at: '2026-03-08T17:00:00.000Z', time_zone: 'UTC', power_ceiling_w: 1800 }
    expect(screen.getByText(/Intended charging start:.*entered by you/)).toBeVisible()
    expect(screen.getByText(/Maximum site power:.*entered by you/)).toBeVisible()
    const created = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans' && options?.method === 'POST')
    expect(JSON.parse(String(created?.[1].body))).toMatchObject({ enabled: false, scheduled_start: expectedStart })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText(/Status: Active/)).toBeInTheDocument()
    const resumed = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans/8' && options?.method === 'PUT')
    expect(JSON.parse(String(resumed?.[1].body))).toMatchObject({ enabled: true, scheduled_start: expectedStart })
  })

  it('records separate leg estimates and preserves them when the plan is resumed', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a trip plan' }))
    fillPlan('2026-03-08T12:00', '2026-03-08T18:00')
    fireEvent.click(screen.getByRole('switch', { name: 'Estimate outbound and return separately' }))
    fireEvent.change(screen.getByLabelText(/Outbound use, low/), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/Outbound use, high/), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText(/Return use, low/), { target: { value: '20' } })
    fireEvent.change(screen.getByLabelText(/Return use, high/), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Planned charge added at destination (%)'), { target: { value: '20' } })
    expect(screen.getByText(/not a confirmed or guaranteed charge/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(await screen.findByText(/Outbound use: 20.*25.*%.*return use: 20.*30.*%/)).toBeInTheDocument()
    expect(screen.getByText(/Planned destination charge: 20.*% added; not confirmed/)).toBeInTheDocument()
    const created = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans' && options?.method === 'POST')
    expect(JSON.parse(String(created?.[1].body))).toMatchObject({
      enabled: false, trip_use_low_pct: 40, trip_use_high_pct: 55,
      trip_legs: {
        outbound_use_low_pct: 20, outbound_use_high_pct: 25,
        return_use_low_pct: 20, return_use_high_pct: 30, destination_charge_pct: 20,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText(/Status: Active/)).toBeInTheDocument()
    const resumed = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans/8' && options?.method === 'PUT')
    expect(JSON.parse(String(resumed?.[1].body))).toMatchObject({
      enabled: true, trip_legs: { destination_charge_pct: 20, return_use_high_pct: 30 },
    })
  })

  it('shows conditional leg projections and lets the user update the destination charge', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 40, trip_use_high_pct: 55, reserve_pct: 20, snoozed_until: null,
      trip_legs: {
        outbound_use_low_pct: 20, outbound_use_high_pct: 25,
        return_use_low_pct: 20, return_use_high_pct: 30, destination_charge_pct: 20,
      },
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'unavailable', reason: 'not_charging',
      required_low_pct: 0, required_high_pct: 0, charging_power_w: 0,
      observed_at: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T12:02:00Z',
      trip_projection: {
        starting_battery_pct: 45, destination_low_pct: 20, destination_high_pct: 25,
        destination_reachability: 'estimated_reachable', return_low_pct: 10, return_high_pct: 25,
        return_reachability: 'estimated_reachable', destination_charge_pct: 20,
      },
    }]
    renderSettings()
    expect(await screen.findByText(/estimated charge at the destination is 20.*25.*% against a 20.*% reserve/)).toHaveTextContent(
      /estimated return charge is 10.*25.*%/,
    )
    expect(screen.getByText(/planned 20.*% destination charge; it is not confirmed or guaranteed/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Review a charging stop in Trip Planner' }))
      .toHaveAttribute('href', '/trip-planner?vehicle_id=42')
    fireEvent.click(screen.getByRole('button', { name: 'Record or update destination charging' }))
    expect(screen.getByLabelText('Planned charge added at destination (%)')).toHaveValue(20)
    fireEvent.change(screen.getByLabelText('Planned charge added at destination (%)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans/8', expect.objectContaining({ method: 'PUT' }),
    ))
    const saved = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans/8' && options?.method === 'PUT')
    expect(JSON.parse(String(saved?.[1].body))).toMatchObject({ trip_legs: { destination_charge_pct: 30 } })
  })

  it('does not present a return estimate when the destination cannot be reached', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 75, trip_use_high_pct: 85, reserve_pct: 20, snoozed_until: null,
      trip_legs: {
        outbound_use_low_pct: 60, outbound_use_high_pct: 65,
        return_use_low_pct: 15, return_use_high_pct: 20, destination_charge_pct: 90,
      },
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'unavailable', reason: 'not_charging',
      required_low_pct: 0, required_high_pct: 0, charging_power_w: 0,
      observed_at: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T12:02:00Z',
      trip_projection: {
        starting_battery_pct: 45, destination_low_pct: 0, destination_high_pct: 0,
        destination_reachability: 'unreachable', return_low_pct: null, return_high_pct: null,
        return_reachability: 'unknown', destination_charge_pct: 90,
      },
    }]
    renderSettings()
    expect(await screen.findByText(/even the lower outbound estimate exceeds the available charge/)).toBeInTheDocument()
    expect(screen.queryByText(/estimated return charge is/)).not.toBeInTheDocument()
  })

  it('hides an estimate after its plan version changes', async () => {
    plans = [{
      id: 8, version: 2, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 40, trip_use_high_pct: 55, reserve_pct: 20, snoozed_until: null,
      trip_legs: {
        outbound_use_low_pct: 20, outbound_use_high_pct: 25,
        return_use_low_pct: 20, return_use_high_pct: 30, destination_charge_pct: null,
      },
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, plan_version: 1, vehicle_id: 42, status: 'sufficient',
      required_low_pct: 0, required_high_pct: 0, charging_power_w: 0,
      observed_at: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T12:02:00Z',
      trip_projection: {
        starting_battery_pct: 45, destination_low_pct: 20, destination_high_pct: 25,
        destination_reachability: 'estimated_reachable', return_low_pct: 10, return_high_pct: 25,
        return_reachability: 'estimated_reachable', destination_charge_pct: 20,
      },
    }]
    renderSettings()
    expect(await screen.findByText('This plan changed. Refresh its estimate before relying on it.')).toBeInTheDocument()
    expect(screen.queryByText(/estimated return charge is/)).not.toBeInTheDocument()
    expect(screen.queryByText(/No extra charge is estimated before departure/)).not.toBeInTheDocument()
  })

  it('rejects nonexistent DST times', async () => {
    timeZone = 'America/Los_Angeles'
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a trip plan' }))
    fillPlan('2026-03-08T02:30', '2026-03-08T08:00')
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Skipped daylight-saving times are not valid')
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
  })

  it('requires explicit price comparison consent and clears it when the charging place changes', async () => {
    places = [place, { ...place, id: 10, name: 'Another synthetic charger' }]
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a trip plan' }))
    fillPlan('2026-03-08T12:00', '2026-03-08T18:00')
    const comparison = screen.getByRole('switch', { name: 'Compare costs using verified place prices' })
    expect(comparison).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(comparison)
    expect(comparison).toHaveAttribute('aria-checked', 'true')
    fireEvent.change(screen.getByLabelText(/Known charging place/), { target: { value: '10' } })
    expect(comparison).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(comparison)
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans', expect.objectContaining({ method: 'POST' }),
    ))
    const saved = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans' && options?.method === 'POST')
    expect(JSON.parse(String(saved?.[1].body))).toMatchObject({ charging_place_id: 10, compare_site_rates: true })
  })

  it('preserves the second occurrence of a repeated local time when editing other fields', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-10-30T12:00:00Z'))
    timeZone = 'America/Los_Angeles'
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-10-31T17:00:00Z', departure_at: '2026-11-01T09:30:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-10-30T12:00:00Z', updated_at: '2026-10-30T12:00:00Z',
    }]
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText(/Planned departure/)).toHaveValue('2026-11-01T01:30')
    fireEvent.change(screen.getByLabelText(/Desired return reserve/), { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans/8', expect.objectContaining({ method: 'PUT' }),
    ))
    const saved = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans/8' && options?.method === 'PUT')
    expect(JSON.parse(String(saved?.[1].body))).toMatchObject({
      departure_at: '2026-11-01T09:30:00.000Z', reserve_pct: 25,
    })
  })

  it('does not silently select a vehicle for an invalid deep link', async () => {
    renderSettings('/settings/smart-charging?vehicle_id=999')
    expect(await screen.findByText(/no other vehicle was selected/)).toBeInTheDocument()
    expect(requestMock.mock.calls.some(([path]) => String(path).startsWith('/smart-charging/plans?'))).toBe(false)
    fireEvent.change(screen.getByLabelText('Vehicle'), { target: { value: '43' } })
    expect(await screen.findByText(/No trip plan is saved/)).toBeInTheDocument()
    expect(requestMock).toHaveBeenCalledWith('/smart-charging/plans?vehicle_id=43&limit=100&offset=0', expect.anything())
  })

  it('uses a disclosed shared scope in open mode and saves plans disabled by default', async () => {
    identityMode = 'open'
    renderSettings()
    expect(await screen.findByText(/Without sign-in, anyone with access to TeslaSync can view and manage these plans/)).toBeInTheDocument()
    expect(screen.queryByText('Shared installation')).not.toBeInTheDocument()
    expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans?vehicle_id=42&limit=100&offset=0', expect.objectContaining({
        cache: 'no-store', headers: { 'X-TeslaSync-Expected-Principal': 'open' },
      }),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Add a trip plan' }))
    expect(screen.getByRole('switch', { name: 'Enable readiness checks for this plan' })).toHaveAttribute('aria-checked', 'false')
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
    fillPlan('2026-03-08T12:00', '2026-03-08T18:00')
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans', expect.objectContaining({
        method: 'POST', headers: { 'X-TeslaSync-Expected-Principal': 'open' },
      }),
    ))
    const saved = requestMock.mock.calls.find(([path, options]) => path === '/smart-charging/plans' && options?.method === 'POST')
    expect(JSON.parse(String(saved?.[1].body))).toMatchObject({ enabled: false })
  })

  it('does not display cached authenticated plans while the shared scope loads', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-08T12:00:00Z', departure_at: '2026-03-08T18:00:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    const original = requestMock.getMockImplementation()
    let resolveShared: ((value: { data: SmartChargingPlan[] }) => void) | undefined
    requestMock.mockImplementation((path: string, options?: RequestInit) => {
      const headers = options?.headers as Record<string, string> | undefined
      if (path === '/smart-charging/plans?vehicle_id=42&limit=100&offset=0' &&
        headers?.['X-TeslaSync-Expected-Principal'] === 'open') {
        return new Promise<{ data: SmartChargingPlan[] }>((resolve) => { resolveShared = resolve })
      }
      return original?.(path, options)
    })
    const { client } = renderSettings()
    expect(await screen.findByText(/Status: Active/)).toBeInTheDocument()
    identityMode = 'open'
    await act(async () => { await client.invalidateQueries({ queryKey: personalIdentityKey }) })
    await waitFor(() => expect(resolveShared).toBeDefined())
    expect(screen.queryByText(/Status: Active/)).not.toBeInTheDocument()
    await act(async () => { resolveShared?.({ data: [] }) })
    expect(await screen.findByText(/No trip plan is saved/)).toBeInTheDocument()
    expect(screen.queryByText(/Status: Active/)).not.toBeInTheDocument()
  })

  it('keeps stale plans read-only and hides them after authorization is lost', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-08T12:00:00Z', departure_at: '2026-03-08T18:00:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    const { client } = renderSettings()
    expect(await screen.findByText(/Status: Active/)).toBeInTheDocument()
    failure = new ApiError('Unavailable', 503)
    await act(async () => { await client.invalidateQueries({ queryKey: smartChargingKeys.all }) })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByText(/Status: Active/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeDisabled()
    failure = new ApiError('Forbidden', 403)
    await act(async () => { await client.invalidateQueries({ queryKey: smartChargingKeys.all }) })
    await waitFor(() => expect(screen.queryByText(/Status: Active/)).not.toBeInTheDocument())
  })

  it('only offers reviewed, active charging places', async () => {
    places = [
      { ...place, needs_review: true },
      { ...place, id: 10, is_charging_location: false },
      { ...place, id: 11, enabled: false },
    ]
    renderSettings()
    expect(await screen.findByText(/Add or review a charging place/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a trip plan' })).toBeDisabled()
  })

  it('shows a bounded latest-start estimate only when live charging power is available', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'estimate',
      required_low_pct: 15, required_high_pct: 25, charging_power_w: 10000,
      earliest_safe_start_at: '2026-03-07T18:30:00Z',
      latest_safe_start_at: '2026-03-07T20:30:00Z',
      observed_at: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T12:02:00Z',
    }]
    renderSettings()
    expect(await screen.findByText(/start by .* for your higher trip-use value/)).toBeInTheDocument()
    expect(screen.queryByText('Compare configured charging prices')).not.toBeInTheDocument()
    const request = requestMock.mock.calls.find(([path]) => path === '/smart-charging/latest-start?vehicle_id=42')
    expect(request?.[1]).toMatchObject({
      cache: 'no-store', headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-a' },
    })
  })

  it('shows a currency-specific price comparison and removes it when live evidence expires', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true, compare_site_rates: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'estimate',
      required_low_pct: 15, required_high_pct: 25, charging_power_w: 10000,
      earliest_safe_start_at: '2026-03-07T18:30:00Z',
      latest_safe_start_at: '2026-03-07T20:30:00Z',
      observed_at: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T12:02:00Z',
      cost_comparison: {
        lower_rate_start_at: '2026-03-07T15:00:00Z', required_energy_wh: 20000,
        cost_now_decimal: '8.000000', cost_later_decimal: '2.000000',
        saving_decimal: '6.000000', currency: 'USD',
      },
    }]
    const timers = vi.spyOn(window, 'setTimeout')
    renderSettings()
    expect(await screen.findByText('Compare configured charging prices')).toBeInTheDocument()
    expect(screen.getByText(/charging now is about/)).toHaveTextContent('$8.00')
    expect(screen.getByText(/charging now is about/)).toHaveTextContent('saving $6.00 (USD)')
    expect(screen.getByText(/taxes, fixed fees and charging losses are excluded/)).toBeInTheDocument()
    const expiry = timers.mock.calls.find(([, delay]) => delay === 120_001)?.[0]
    expect(typeof expiry).toBe('function')
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-03-07T12:02:01Z'))
    act(() => { (expiry as () => void)() })
    expect(screen.getByText(/estimate expired because its live evidence is no longer fresh/)).toBeInTheDocument()
    expect(screen.queryByText('Compare configured charging prices')).not.toBeInTheDocument()
  })

  it('does not show a cached price comparison after its plan consent is revoked', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true, compare_site_rates: false,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'estimate',
      required_low_pct: 15, required_high_pct: 25, charging_power_w: 10000,
      earliest_safe_start_at: '2026-03-07T18:30:00Z',
      latest_safe_start_at: '2026-03-07T20:30:00Z',
      observed_at: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T12:02:00Z',
      cost_comparison: {
        lower_rate_start_at: '2026-03-07T15:00:00Z', required_energy_wh: 20000,
        cost_now_decimal: '8.000000', cost_later_decimal: '2.000000',
        saving_decimal: '6.000000', currency: 'USD',
      },
    }]
    renderSettings()
    expect(await screen.findByText(/start by .* for your higher trip-use value/)).toBeInTheDocument()
    expect(screen.queryByText('Compare configured charging prices')).not.toBeInTheDocument()
  })

  it('does not present a latest-start time from stale live evidence', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'estimate',
      required_low_pct: 15, required_high_pct: 25, charging_power_w: 10000,
      earliest_safe_start_at: '2026-03-07T18:30:00Z',
      latest_safe_start_at: '2026-03-07T20:30:00Z',
      observed_at: '2026-03-07T11:00:00Z', expires_at: '2026-03-07T11:02:00Z',
    }]
    renderSettings()
    expect(await screen.findByText(/estimate expired because its live evidence is no longer fresh/)).toBeInTheDocument()
    expect(screen.queryByText(/start by .* for your higher trip-use value/)).not.toBeInTheDocument()
  })

  it('does not estimate a latest start when the entered upper trip need exceeds full battery', async () => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 80, trip_use_high_pct: 90, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'unachievable',
      required_low_pct: 0, required_high_pct: 0, charging_power_w: 0,
      observed_at: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T12:02:00Z',
    }]
    renderSettings()
    expect(await screen.findByText(/upper trip-use estimate plus your reserve exceeds 100% battery/)).toBeInTheDocument()
    expect(screen.queryByText(/start by .* for your higher trip-use value/)).not.toBeInTheDocument()
  })

  it.each([
    ['unknown_location', /fresh parked location is required/],
    ['outside_site', /power measured elsewhere cannot be used/],
  ] as const)('explains why %s cannot use a measured charging rate', async (reason, message) => {
    plans = [{
      id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
      notify_at: '2026-03-07T12:00:00Z', departure_at: '2026-03-08T00:00:00Z',
      trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
      created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
    }]
    latestStarts = [{
      plan_id: 8, vehicle_id: 42, status: 'unavailable', reason,
      required_low_pct: 0, required_high_pct: 0, charging_power_w: 0,
    }]
    renderSettings()
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByText(/start by .* for your higher trip-use value/)).not.toBeInTheDocument()
  })
})
