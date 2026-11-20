import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionCenterRecommendation } from '@/types/actionCenter'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import type { SmartCommuteRoutine, SmartCommuteSnapshot } from '@/types/smartCommute'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: (...args: unknown[]) => requestMock(...args),
}))

import { SmartCommuteRecommendationActions } from './SmartCommuteRecommendationActions'

const routine: SmartCommuteRoutine = {
  id: 8, vehicle_id: 42, status: 'suggested', name: '', weekday: 2,
  departure_s: 28800, time_zone: 'America/Los_Angeles',
  origin: { latitude: 47.1, longitude: -122.1 }, destination: { latitude: 47.2, longitude: -122.2 },
  evidence: {
    matching_days: 7, window_start_s: 28500, window_end_s: 29100,
    first_observed_at: '2026-02-01T16:00:00Z', last_observed_at: '2026-04-01T15:00:00Z',
  },
  snoozed_until: null,
  created_at: '2026-04-01T15:00:00Z', updated_at: '2026-04-01T15:00:00Z',
}
const recommendation: ActionCenterRecommendation = {
  id: 'ac_example', fingerprint: 'a'.repeat(64), source_feature: 'smart_commute',
  related_sources: ['smart_commute'], vehicle: { id: 42, display_name: 'Synthetic vehicle' },
  title: 'Review routine', summary: 'Seven days', rationale: 'Comparable drives',
  priority: 'low', severity: 'info', rank: { score: 200, basis: [] },
  confidence: { score: 0.8, label: 'high', basis: [] },
  evidence: [{
    id: 'routine:8', kind: 'recurring_drive', summary: 'Seven days',
    provenance: { source: 'local_drive_analysis', record_id: 'routine:8', source_url: null },
    observed_at: '2026-04-01T15:00:00Z',
    recurring_drive: {
      routine_id: 8, weekday: 2, matching_days: 7, window_start_s: 28500, window_end_s: 29100,
      time_zone: 'America/Los_Angeles', destination_latitude: 47.2, destination_longitude: -122.2,
    },
  }],
  projected_impact: null, safe_actions: ['navigate', 'smart_commute_use', 'smart_commute_edit', 'smart_commute_decline', 'smart_commute_snooze'],
  navigation_path: '/settings?vehicle_id=42#smart-commute', expires_at: '2099-01-01T00:00:00Z',
  freshness: { status: 'fresh', observed_at: '2026-04-01T15:00:00Z', age_s: 60 },
  limitations: [], current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
  action_history: [],
}

let snapshot: SmartCommuteSnapshot

function renderActions(disabled = false, scope: PersonalScope = { mode: 'forward_auth', subject: 'synthetic-a' }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>
    <SmartCommuteRecommendationActions recommendation={recommendation}
      personalScope={scope} disabled={disabled} />
  </QueryClientProvider>)
}

beforeEach(() => {
  snapshot = {
    settings: { vehicle_id: 42, enabled: true, local_analysis_enabled: true, paused: false, time_zone: 'America/Los_Angeles' },
    routines: [routine],
  }
  requestMock.mockReset()
  requestMock.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/smart-commute?vehicle_id=42') return { data: snapshot }
    if (path === '/smart-commute/routines/8' && options?.method === 'PUT') {
      snapshot = { ...snapshot, routines: [] }
      return { data: null }
    }
    if (path === '/smart-commute/routines/8/decline' && options?.method === 'POST') {
      snapshot = { ...snapshot, routines: [] }
      return undefined
    }
    if (path === '/smart-commute/routines/8/snooze' && options?.method === 'POST') {
      snapshot = { ...snapshot, routines: [{ ...routine, snoozed_until: '2099-01-01T00:00:00Z' }] }
      return undefined
    }
    throw new Error(`Unexpected request: ${path}`)
  })
})

describe('Smart Commute actions on a private recommendation', () => {
  it('reviews the suggested endpoints and confirms only an explicit edited routine', async () => {
    renderActions()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText(/Origin latitude/)).toHaveValue(47.1)
    expect(screen.getByLabelText(/Destination longitude/)).toHaveValue(-122.2)
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
    fireEvent.change(screen.getByLabelText(/Routine name/), { target: { value: 'Studio' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save routine' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-commute/routines/8',
      expect.objectContaining({ method: 'PUT', headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-a' } }),
    ))
    const saved = requestMock.mock.calls.find(([path, options]) =>
      path === '/smart-commute/routines/8' && options?.method === 'PUT')
    expect(JSON.parse(String(saved?.[1].body))).toMatchObject({
      vehicle_id: 42, name: 'Studio', weekday: 2, departure_s: 28800,
      origin: { latitude: 47.1, longitude: -122.1 }, destination: { latitude: 47.2, longitude: -122.2 },
    })
  })

  it('declines the suggestion without saving or operating the car', async () => {
    renderActions()
    fireEvent.click(await screen.findByRole('button', { name: 'Not mine' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-commute/routines/8/decline', expect.objectContaining({ method: 'POST' }),
    ))
    expect(requestMock.mock.calls.some(([path]) => /traffic|push|command/.test(String(path)))).toBe(false)
    expect(requestMock.mock.calls.some(([path, options]) =>
      path === '/smart-commute/routines/8' && options?.method === 'PUT')).toBe(false)
  })

  it('snoozes the suggestion through the subject-scoped endpoint', async () => {
    renderActions()
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze for 24 hours' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-commute/routines/8/snooze', expect.objectContaining({
        method: 'POST', headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-a' },
      }),
    ))
    const saved = requestMock.mock.calls.find(([path]) => path === '/smart-commute/routines/8/snooze')
    expect(JSON.parse(String(saved?.[1].body))).toEqual({ vehicle_id: 42, duration_s: 86400 })
    expect(requestMock.mock.calls.some(([path]) => /traffic|push|command/.test(String(path)))).toBe(false)
  })

  it('allows shared-open suggestions to be snoozed with the open scope guard', async () => {
    renderActions(false, { mode: 'open' })
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze for 24 hours' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-commute/routines/8/snooze', expect.objectContaining({
        method: 'POST', headers: { 'X-TeslaSync-Expected-Principal': 'open' },
      }),
    ))
  })

  it('disables every decision when the routine is paused or the inbox is read-only', async () => {
    snapshot.settings.paused = true
    const { unmount } = renderActions()
    expect(await screen.findByRole('button', { name: 'Use routine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Not mine' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Snooze for 24 hours' })).toBeDisabled()
    unmount()
    snapshot.settings.paused = false
    renderActions(true)
    expect(await screen.findByRole('button', { name: 'Use routine' })).toBeDisabled()
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
  })
})
