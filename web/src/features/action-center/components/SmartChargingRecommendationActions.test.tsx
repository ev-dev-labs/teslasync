import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionCenterRecommendation } from '@/types/actionCenter'
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity'
import type { SmartChargingPlan } from '@/types/smartCharging'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: (...args: unknown[]) => requestMock(...args),
}))

import { SmartChargingRecommendationActions } from './SmartChargingRecommendationActions'

const plan: SmartChargingPlan = {
  id: 8, vehicle_id: 42, charging_place_id: 9, enabled: true,
  notify_at: '2098-01-01T10:00:00Z', departure_at: '2098-01-01T18:00:00Z',
  trip_use_low_pct: 35, trip_use_high_pct: 45, reserve_pct: 20, snoozed_until: null,
  created_at: '2026-03-07T12:00:00Z', updated_at: '2026-03-07T12:00:00Z',
}
const recommendation: ActionCenterRecommendation = {
  id: 'ac_example', fingerprint: 'a'.repeat(64), source_feature: 'smart_charging',
  related_sources: ['smart_charging'], vehicle: { id: 42, display_name: 'Synthetic vehicle' },
  title: 'Plug in', summary: 'Synthetic estimate', rationale: 'Synthetic evidence',
  priority: 'medium', severity: 'warning', rank: { score: 200, basis: [] },
  confidence: { score: 0.8, label: 'high', basis: [] },
  evidence: [{
    id: 'charging_plan:8', kind: 'charging_readiness', summary: 'Synthetic estimate',
    provenance: { source: 'live_signal_store', record_id: 'charging_plan:8', source_url: null },
    observed_at: '2026-03-07T12:00:00Z',
    charging_readiness: {
      plan_id: 8, place_name: 'Synthetic charger', battery_pct: 45, arrival_low_pct: 0,
      arrival_high_pct: 10, reserve_pct: 20, departure_at: plan.departure_at,
    },
  }],
  projected_impact: null, safe_actions: ['navigate', 'smart_charging_snooze'],
  navigation_path: '/settings?vehicle_id=42#smart-charging', expires_at: '2098-01-01T12:00:00Z',
  freshness: { status: 'fresh', observed_at: '2026-03-07T12:00:00Z', age_s: 0 },
  limitations: [], current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
  action_history: [],
}
let plans: SmartChargingPlan[]

function renderActions(
  disabled = false,
  scope: PersonalScope = { mode: 'forward_auth', subject: 'synthetic-a' },
  item: ActionCenterRecommendation = recommendation,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>
    <SmartChargingRecommendationActions recommendation={item}
      personalScope={scope} disabled={disabled} />
  </QueryClientProvider>)
}

beforeEach(() => {
  plans = [plan]
  requestMock.mockReset()
  requestMock.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/smart-charging/plans?vehicle_id=42&limit=100&offset=0') return { data: plans }
    if (path === '/smart-charging/plans/8/snooze' && options?.method === 'POST') return undefined
    throw new Error(`Unexpected request: ${path}`)
  })
  afterEach(() => vi.restoreAllMocks())
})

describe('private charging readiness action', () => {
  it('snoozes through the subject-scoped endpoint without operating the vehicle', async () => {
    renderActions()
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze for 1 hour' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans/8/snooze', expect.objectContaining({
        method: 'POST', requiresLiveMode: true,
        headers: { 'X-TeslaSync-Expected-Principal': 'subject:synthetic-a' },
      }),
    ))
    const saved = requestMock.mock.calls.find(([path]) => path === '/smart-charging/plans/8/snooze')
    expect(JSON.parse(String(saved?.[1].body))).toEqual({ vehicle_id: 42, duration_s: 3600 })
    expect(requestMock.mock.calls.some(([path]) => /traffic|push|command|action-center\/.*\/actions/.test(String(path)))).toBe(false)
  })

  it('does not allow actions for a paused plan or read-only inbox', async () => {
    plans = [{ ...plan, enabled: false }]
    const { unmount } = renderActions()
    expect(await screen.findByRole('button', { name: 'Snooze for 1 hour' })).toBeDisabled()
    unmount()
    plans = [plan]
    renderActions(true)
    expect(await screen.findByRole('button', { name: 'Snooze for 1 hour' })).toBeDisabled()
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
  })

  it('allows shared-open plans to be snoozed with the open scope guard', async () => {
    renderActions(false, { mode: 'open' })
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze for 1 hour' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans/8/snooze', expect.objectContaining({
        method: 'POST', headers: { 'X-TeslaSync-Expected-Principal': 'open' },
      }),
    ))
  })

  it('snoozes a sampled charging-feasibility card through the same scoped plan', async () => {
    const item = {
      ...recommendation,
      evidence: recommendation.evidence.map((evidence) => ({ ...evidence, kind: 'charging_feasibility' })),
    }
    renderActions(false, { mode: 'open' }, item)
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze for 1 hour' }))
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith(
      '/smart-charging/plans/8/snooze', expect.objectContaining({
        method: 'POST', headers: { 'X-TeslaSync-Expected-Principal': 'open' },
      }),
    ))
  })

  it('does not apply an action after its evidence expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2098-01-01T11:59:00Z'))
    renderActions()
    const snooze = await screen.findByRole('button', { name: 'Snooze for 1 hour' })
    expect(snooze).toBeEnabled()
    now.mockReturnValue(Date.parse('2098-01-01T12:00:00Z'))
    fireEvent.click(snooze)
    expect(requestMock.mock.calls.some(([, options]) => options?.method)).toBe(false)
  })
})
