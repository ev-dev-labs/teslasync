import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmartCommuteRoutine, SmartCommuteSettings as Settings, SmartCommuteSnapshot } from '@/types/smartCommute'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: (...args: unknown[]) => requestMock(...args),
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate: () => 'April 1, 2026', formatDateTime: () => 'April 2, 2026 at 8:00 AM' }),
}))

import { ApiError } from '@/api/client'
import { personalIdentityKey } from '@/api/hooks/usePersonalIdentity'
import { smartCommuteKeys } from '@/api/hooks/useSmartCommute'
import { SmartCommuteSettings } from './SmartCommuteSettings'

const suggestion: SmartCommuteRoutine = {
  id: 8, vehicle_id: 42, status: 'suggested', name: '', weekday: 2,
  departure_s: 28800, time_zone: 'America/Los_Angeles',
  origin: { latitude: 47.1, longitude: -122.1 },
  destination: { latitude: 47.2, longitude: -122.2 },
  evidence: {
    matching_days: 7, window_start_s: 28500, window_end_s: 29100,
    first_observed_at: '2026-02-01T16:00:00Z', last_observed_at: '2026-04-01T15:00:00Z',
  },
  snoozed_until: null,
  created_at: '2026-04-01T15:00:00Z', updated_at: '2026-04-01T15:00:00Z',
}

let snapshot: SmartCommuteSnapshot
let identityMode: 'forward_auth' | 'open'
let failure: ApiError | null

function fresh(vehicleId: number): SmartCommuteSnapshot {
  return {
    settings: { vehicle_id: vehicleId, enabled: false, local_analysis_enabled: false, paused: false, time_zone: '' },
    routines: [],
  }
}

function LocationProbe() {
  const { pathname, search, hash } = useLocation()
  return <span data-testid="location">{pathname}{search}{hash}</span>
}

function renderSettings(url = '/settings/smart-commute?vehicle_id=42') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <SmartCommuteSettings active />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...result }
}

beforeEach(() => {
  requestMock.mockReset()
  snapshot = fresh(42)
  identityMode = 'forward_auth'
  failure = null
  requestMock.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/system/auth-mode') return { mode: identityMode, subject: 'synthetic-a' }
    if (path === '/vehicles') return [
      { id: 42, display_name: 'Synthetic A' },
      { id: 43, display_name: 'Synthetic B' },
    ]
    if (path === '/smart-commute?vehicle_id=42' && !options?.method) {
      if (failure) throw failure
      return { data: snapshot }
    }
    if (path === '/smart-commute?vehicle_id=43' && !options?.method) return { data: fresh(43) }
    if (path === '/smart-commute' && options?.method === 'PUT') {
      const settings = JSON.parse(String(options.body)) as Settings
      snapshot = {
        settings,
        routines: settings.local_analysis_enabled && !settings.paused ? [suggestion] : [],
      }
      return undefined
    }
    if (path === '/smart-commute/routines/8' && options?.method === 'PUT') {
      const input = JSON.parse(String(options.body))
      snapshot = { ...snapshot, routines: [{ ...suggestion, ...input, status: 'confirmed', evidence: null }] }
      return { data: snapshot.routines?.[0] }
    }
    if (path === '/smart-commute/routines' && options?.method === 'POST') {
      const input = JSON.parse(String(options.body))
      snapshot = { ...snapshot, routines: [{ ...suggestion, ...input, status: 'confirmed', evidence: null }] }
      return { data: snapshot.routines?.[0] }
    }
    if (path === '/smart-commute/routines/8/decline' && options?.method === 'POST') {
      snapshot = { ...snapshot, routines: [] }
      return undefined
    }
    if (path === '/smart-commute/routines/8/snooze' && options?.method === 'POST') {
      const input = JSON.parse(String(options.body)) as { duration_s: number }
      snapshot = { ...snapshot, routines: [{ ...suggestion, snoozed_until: input.duration_s ? '2099-01-01T00:00:00Z' : null }] }
      return undefined
    }
    throw new Error(`Unexpected request: ${path}`)
  })
})

describe('Smart Commute settings', () => {
  it('starts off, asks for separate local consent, and saves an explicitly named suggestion', async () => {
    renderSettings()
    const feature = await screen.findByRole('switch', { name: /Enable Smart Commute/ })
    const local = screen.getByRole('switch', { name: /Allow local analysis/ })
    const pause = screen.getByRole('switch', { name: /Pause Smart Commute/ })
    expect(feature).toHaveAttribute('aria-checked', 'false')
    expect(feature).toHaveAccessibleDescription('Enable this vehicle’s commute settings and routines.')
    expect(local).toHaveAccessibleDescription('Use this vehicle’s completed drives on this server to suggest routines.')
    expect(pause).toHaveAccessibleDescription('Temporarily pause Smart Commute without deleting your routines.')
    expect(local).toBeDisabled()
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)

    fireEvent.click(feature)
    await waitFor(() => expect(feature).toHaveAttribute('aria-checked', 'true'))
    const firstSave = requestMock.mock.calls.find(([path, options]) =>
      path === '/smart-commute' && options?.method === 'PUT')
    expect(JSON.parse(String(firstSave?.[1].body))).toMatchObject({
      vehicle_id: 42, enabled: true, local_analysis_enabled: false, paused: false,
    })

    await waitFor(() => expect(local).toBeEnabled())
    fireEvent.click(local)
    expect(await screen.findByText('Is this your regular Tuesday drive?')).toBeInTheDocument()
    expect(screen.getByText(/7 matching days/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use routine' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Use routine' }))
    fireEvent.change(screen.getByLabelText(/Routine name/), { target: { value: 'Studio' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(screen.getByText('Studio')).toBeInTheDocument())
    const save = requestMock.mock.calls.find(([path, options]) =>
      path === '/smart-commute/routines/8' && options?.method === 'PUT')
    expect(JSON.parse(String(save?.[1].body))).toMatchObject({
      vehicle_id: 42, name: 'Studio', weekday: 2, departure_s: 28800,
      destination: { latitude: 47.2, longitude: -122.2 },
    })
    expect(requestMock.mock.calls.some(([path]) => /traffic|push|command/.test(String(path)))).toBe(false)
  })

  it('does not silently select a different vehicle for an invalid deep link', async () => {
    renderSettings('/settings/smart-commute?vehicle_id=999')
    expect(await screen.findByText(/no other vehicle was selected/)).toBeInTheDocument()
    expect(requestMock.mock.calls.some(([path]) => String(path).startsWith('/smart-commute?'))).toBe(false)
    fireEvent.change(screen.getByLabelText('Vehicle'), { target: { value: '43' } })
    expect(await screen.findByRole('switch', { name: /Enable Smart Commute/ })).toHaveAttribute('aria-checked', 'false')
    expect(requestMock).toHaveBeenCalledWith('/smart-commute?vehicle_id=43', expect.anything())
    expect(requestMock).not.toHaveBeenCalledWith('/smart-commute?vehicle_id=42', expect.anything())
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/smart-commute?vehicle_id=43')
  })

  it('creates and edits a manual routine without enabling history analysis', async () => {
    snapshot = {
      settings: { vehicle_id: 42, enabled: true, local_analysis_enabled: false, paused: false, time_zone: 'UTC' },
      routines: [],
    }
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Add a routine manually' }))
    fireEvent.change(screen.getByLabelText(/Routine name/), { target: { value: 'Studio' } })
    for (const [label, value] of [
      ['Origin latitude', '47.1'], ['Origin longitude', '-122.1'],
      ['Destination latitude', '47.2'], ['Destination longitude', '-122.2'],
    ]) fireEvent.change(screen.getByLabelText(new RegExp(label)), { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    expect(await screen.findByText('Studio')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText(/Routine name/), { target: { value: 'Workshop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    expect(await screen.findByText('Workshop')).toBeInTheDocument()
    expect(requestMock.mock.calls.some(([path]) => path === '/smart-commute/analyses')).toBe(false)
  })

  it('declines a suggestion without confirming it', async () => {
    snapshot = {
      settings: { vehicle_id: 42, enabled: true, local_analysis_enabled: true, paused: false, time_zone: 'UTC' },
      routines: [suggestion],
    }
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Not mine' }))
    await waitFor(() => expect(screen.queryByText('Is this your regular Tuesday drive?')).not.toBeInTheDocument())
    expect(requestMock).toHaveBeenCalledWith('/smart-commute/routines/8/decline', expect.objectContaining({ method: 'POST' }))
    expect(requestMock.mock.calls.some(([path, options]) =>
      path === '/smart-commute/routines/8' && options?.method === 'PUT')).toBe(false)
  })

  it('lets the person reveal a snoozed suggestion again', async () => {
    snapshot = {
      settings: { vehicle_id: 42, enabled: true, local_analysis_enabled: true, paused: false, time_zone: 'UTC' },
      routines: [{ ...suggestion, snoozed_until: '2099-01-01T00:00:00Z' }],
    }
    renderSettings()
    expect(await screen.findByText(/Snoozed until April 2/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show suggestion now' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Snooze for 24 hours' })).toBeEnabled())
    const saved = requestMock.mock.calls.find(([path]) => path === '/smart-commute/routines/8/snooze')
    expect(JSON.parse(String(saved?.[1].body))).toEqual({ vehicle_id: 42, duration_s: 0 })
  })

  it('uses a disclosed shared scope in open mode and keeps consent off until enabled', async () => {
    identityMode = 'open'
    renderSettings()
    expect(await screen.findByText(/Without sign-in, anyone with access to TeslaSync can view and manage these routines/)).toBeInTheDocument()
    expect(screen.queryByText('Shared installation')).not.toBeInTheDocument()
    const feature = await screen.findByRole('switch', { name: /Enable Smart Commute/ })
    expect(feature).toHaveAttribute('aria-checked', 'false')
    expect(requestMock).toHaveBeenCalledWith(
      '/smart-commute?vehicle_id=42', expect.objectContaining({
        cache: 'no-store', headers: { 'X-TeslaSync-Expected-Principal': 'open' },
      }),
    )
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
    fireEvent.click(feature)
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-commute', expect.objectContaining({
        method: 'PUT', headers: { 'X-TeslaSync-Expected-Principal': 'open' },
      }),
    ))
  })

  it('does not display cached authenticated routines while the shared scope loads', async () => {
    snapshot = {
      settings: { vehicle_id: 42, enabled: true, local_analysis_enabled: true, paused: false, time_zone: 'UTC' },
      routines: [suggestion],
    }
    const original = requestMock.getMockImplementation()
    let resolveShared: ((value: { data: SmartCommuteSnapshot }) => void) | undefined
    requestMock.mockImplementation((path: string, options?: RequestInit) => {
      const headers = options?.headers as Record<string, string> | undefined
      if (path === '/smart-commute?vehicle_id=42' && headers?.['X-TeslaSync-Expected-Principal'] === 'open') {
        return new Promise<{ data: SmartCommuteSnapshot }>((resolve) => { resolveShared = resolve })
      }
      return original?.(path, options)
    })
    const { client } = renderSettings()
    expect(await screen.findByText('Is this your regular Tuesday drive?')).toBeInTheDocument()
    identityMode = 'open'
    await act(async () => { await client.invalidateQueries({ queryKey: personalIdentityKey }) })
    await waitFor(() => expect(resolveShared).toBeDefined())
    expect(screen.queryByText('Is this your regular Tuesday drive?')).not.toBeInTheDocument()
    await act(async () => { resolveShared?.({ data: fresh(42) }) })
    expect(await screen.findByRole('switch', { name: /Enable Smart Commute/ })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Is this your regular Tuesday drive?')).not.toBeInTheDocument()
  })

  it('keeps stale data readable but disables actions, and hides it after access is denied', async () => {
    snapshot = {
      settings: { vehicle_id: 42, enabled: true, local_analysis_enabled: true, paused: false, time_zone: 'America/Los_Angeles' },
      routines: [suggestion],
    }
    const { client } = renderSettings()
    expect(await screen.findByText('Is this your regular Tuesday drive?')).toBeInTheDocument()
    failure = new ApiError('Unavailable', 503)
    await act(async () => { await client.invalidateQueries({ queryKey: smartCommuteKeys.all }) })
    expect(await screen.findByTestId('stale-refresh-warning')).toBeInTheDocument()
    expect(screen.getByText('Is this your regular Tuesday drive?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use routine' })).toBeDisabled()

    failure = new ApiError('Forbidden', 403)
    await act(async () => { await client.invalidateQueries({ queryKey: smartCommuteKeys.all }) })
    await waitFor(() => expect(screen.queryByText('Is this your regular Tuesday drive?')).not.toBeInTheDocument())
  })
})
