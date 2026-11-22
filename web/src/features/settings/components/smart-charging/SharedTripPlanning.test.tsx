import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { personalIdentityKey, personalScope, usePersonalIdentity } from '@/api/hooks/usePersonalIdentity'
import type { SharedTrip, SharedTripInvitation } from '@/api/hooks/useSharedTripPlanning'
import { SharedTripPlanning } from './SharedTripPlanning'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: (...args: unknown[]) => requestMock(...args),
}))
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ tz: 'America/New_York', formatDateTime: (value: string) => value }),
}))
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtPercent: (value: number) => `${value}%` }),
}))
vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({ canWrite: true }),
}))

const base = '/smart-charging/shared-trips'
const departure = '2026-03-08T12:00:00Z'
const consentExpiry = '2026-03-07T18:00:00Z'
const invite: SharedTripInvitation = {
  trip_id: 17, revision: 3, vehicle_id: 8, entry_version: 2, departure_at: departure, consent_expires_at: null,
}
let invitations: SharedTripInvitation[]
let trips: SharedTrip[]
let subject: string
let open: boolean

function PlanningWithIdentity() {
  const identity = usePersonalIdentity()
  const scope = personalScope(identity.data)
  return !identity.isFetching && scope && <SharedTripPlanning scope={scope} />
}

function renderPlanning() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><PlanningWithIdentity /></QueryClientProvider>)
  return client
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-07T12:00:00Z'))
  open = false
  subject = 'participant'
  invitations = [invite]
  trips = []
  requestMock.mockReset()
  requestMock.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/system/auth-mode') return open ? { mode: 'open' } : { mode: 'forward_auth', subject }
    if (path === '/vehicles') return [{ id: 8, display_name: 'Synthetic A' }, { id: 12, display_name: 'Synthetic B' }]
    if (new Headers(options?.headers).get('X-TeslaSync-Expected-Principal') !== `subject:${subject}`) {
      throw new ApiError('Identity changed', 409, 'IDENTITY_CHANGED')
    }
    if (path === `${base}?limit=50&offset=0`) {
      return { data: { can_manage: subject === 'operator', owned: trips, invitations: subject === 'participant' ? invitations : [] } }
    }
    if (path === `${base}/17/vehicles/8` && options?.method === 'PUT') {
      invitations = [{ ...invite, entry_version: 3, consent_expires_at: consentExpiry }]
      return undefined
    }
    if (path === `${base}/17/vehicles/8?revision=3&entry_version=3` && options?.method === 'DELETE') {
      invitations = []
      return undefined
    }
    if (path === `${base}/17/comparison`) {
      const observed_at = '2026-03-07T11:59:30Z'
      const expires_at = '2026-03-07T12:01:30Z'
      return { data: { comparison: {
        id: 17, revision: 3, departure_at: departure, expires_at,
        options: [
          { vehicle_id: 12, return_low_pct: 43, return_high_pct: 60, reserve_pct: 20, observed_at, expires_at },
          { vehicle_id: 8, return_low_pct: 32, return_high_pct: 52, reserve_pct: 18, observed_at, expires_at },
        ],
      } } }
    }
    if (path === base && options?.method === 'POST') {
      trips = [{ id: 17, revision: 1, departure_at: departure }]
      return { data: trips[0] }
    }
    throw new Error(`Unexpected request: ${path}`)
  })
})

afterEach(() => { vi.restoreAllMocks() })

describe('shared trip planning', () => {
  it('requires explicit current consent before comparison and withdraws by entry version', async () => {
    renderPlanning()
    fireEvent.click(await screen.findByRole('button', { name: 'Review and confirm' }))
    expect(screen.queryByRole('button', { name: 'Compare vehicles' })).not.toBeInTheDocument()
    expect(requestMock.mock.calls.some(([path]) => path === `${base}/17/comparison`)).toBe(false)
    fireEvent.change(screen.getByLabelText(/minimum battery use/), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText(/maximum battery use/), { target: { value: '28' } })
    fireEvent.change(screen.getByLabelText(/minimum battery reserve/i), { target: { value: '18' } })
    fireEvent.change(screen.getByLabelText(/available for the shared departure/), { target: { value: 'clear' } })
    const submit = screen.getByRole('button', { name: 'Confirm participation' })
    fireEvent.click(submit)
    expect(requestMock.mock.calls.some(([path]) => path === `${base}/17/vehicles/8`)).toBe(false)
    fireEvent.change(screen.getByLabelText(/clear of overdue maintenance/), { target: { value: 'clear' } })
    fireEvent.click(submit)
    fireEvent.click(await screen.findByRole('button', { name: 'Compare vehicles' }))
    const options = await screen.findAllByText(/^Vehicle \d+: estimated return /)
    expect(options.map((option) => option.textContent)).toEqual([
      'Vehicle 12: estimated return 43%–60%; minimum reserve 20%.',
      'Vehicle 8: estimated return 32%–52%; minimum reserve 18%.',
    ])
    expect(requestMock).toHaveBeenCalledWith(`${base}/17/vehicles/8`, expect.objectContaining({
      method: 'PUT', cache: 'no-store', requiresLiveMode: true,
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:participant' },
      body: JSON.stringify({
        trip_use_low_pct: 12, trip_use_high_pct: 28, reserve_pct: 18, schedule_clear: true, maintenance_clear: true,
        revision: 3, entry_version: 2,
      }),
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw vehicle' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw vehicle' }))
    await screen.findByText(/No upcoming shared departures/)
    expect(screen.queryByText(/^Vehicle \d+: estimated return /)).not.toBeInTheDocument()
    expect(requestMock).toHaveBeenCalledWith(`${base}/17/vehicles/8?revision=3&entry_version=3`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('removes authorized comparison data on a browser account change', async () => {
    invitations = [{ ...invite, consent_expires_at: consentExpiry }]
    const client = renderPlanning()
    fireEvent.click(await screen.findByRole('button', { name: 'Compare vehicles' }))
    await screen.findByText(/Vehicle 12: estimated return/)
    subject = 'another-participant'
    await act(async () => { await client.invalidateQueries({ queryKey: personalIdentityKey }) })
    await screen.findByText(/No upcoming shared departures/)
    expect(screen.queryByText(/Vehicle 12: estimated return/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compare vehicles' })).not.toBeInTheDocument()
    expect(requestMock).toHaveBeenCalledWith(`${base}?limit=50&offset=0`, expect.objectContaining({
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:another-participant' },
    }))
  })

  it('requires browser sign-in and only offers creation to a trusted organizer', async () => {
    open = true
    const client = renderPlanning()
    await screen.findByText(/requires a verified browser sign-in/)
    expect(requestMock.mock.calls.some(([path]) => path.startsWith(base))).toBe(false)

    open = false
    subject = 'operator'
    await act(async () => { await client.invalidateQueries({ queryKey: personalIdentityKey }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Create shared trip' }))
    const departureInput = await screen.findByLabelText(/Shared departure \(America\/New_York\)/)
    fireEvent.change(departureInput, { target: { value: '2026-03-08T02:30' } })
    const vehicles = screen.getAllByLabelText(/Nominated vehicle/)
    const subjects = screen.getAllByLabelText(/Exact participant sign-in identity/)
    fireEvent.change(vehicles[0], { target: { value: '8' } })
    fireEvent.change(vehicles[1], { target: { value: '12' } })
    fireEvent.change(subjects[0], { target: { value: 'Synthetic-A' } })
    fireEvent.change(subjects[1], { target: { value: 'Synthetic-B' } })
    const save = screen.getByRole('button', { name: 'Save trip and invitations' })
    fireEvent.click(save)
    await screen.findByText(/Enter a future departure/)
    expect(requestMock.mock.calls.some(([path]) => path === base)).toBe(false)
    fireEvent.change(departureInput, { target: { value: '2026-03-08T08:00' } })
    fireEvent.click(save)
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(base, expect.objectContaining({
      method: 'POST',
      headers: { 'X-TeslaSync-Expected-Principal': 'subject:operator' },
      body: JSON.stringify({
        departure_at: '2026-03-08T12:00:00.000Z',
        nominations: [{ vehicle_id: 8, subject: 'Synthetic-A' }, { vehicle_id: 12, subject: 'Synthetic-B' }],
      }),
    })))
    await screen.findByRole('button', { name: 'Revise trip' })
  })
})
