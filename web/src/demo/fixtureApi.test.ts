import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/api/client'
import { resilientFetch } from '@/lib/resilience'
import { demoResponse } from './fixtureApi'

beforeEach(() => {
  vi.stubEnv('VITE_DEMO_MODE', 'true')
  vi.stubEnv('VITE_DEMO_API_BASE', '/demo-api/v1')
  vi.stubEnv('VITE_DEMO_STATIC_FIXTURES', 'true')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('static public demo', () => {
  it('loads filtered synthetic history without a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const vehicles = await request<{ id: number }[]>('/vehicles')
    expect(vehicles).toHaveLength(2)
    const drives = await request<{ vehicle_id: number; distance_m: number }[]>(
      '/drives?vehicle_id=7&limit=2&offset=1',
    )
    expect(drives).toHaveLength(2)
    expect(drives.every(drive => drive.vehicle_id === 7 && drive.distance_m > 0)).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps setup bypass separate from Tesla connectivity', async () => {
    const setup = await request<{
      setup_complete: boolean; tesla_connected: boolean; vehicle_count: number;
    }>('/onboarding/status')
    expect(setup.setup_complete).toBe(true)
    expect(setup.tesla_connected).toBe(false)
    expect(setup.vehicle_count).toBe(2)
  })

  it('keeps each supported dashboard widget scoped to a fictional vehicle', async () => {
    const climate = await request<{ vehicle_id: number; inside_temp_c: number }>(
      '/climate/latest?vehicle_id=7',
    )
    const security = await request<{ vehicle_id: number; locked: boolean }>(
      '/security/latest?vehicle_id=8',
    )
    expect(climate).toMatchObject({ vehicle_id: 7, inside_temp_c: 21 })
    expect(security).toMatchObject({ vehicle_id: 8, locked: true })
    expect(demoResponse('/climate/latest?vehicle_id=99', 'GET').status).toBe(400)
  })

  it('supplies a coherent battery history and projection for each sample vehicle', async () => {
    const battery = await request<{
      current_soh: number; history: { soh_pct: number; capacity_wh: number }[];
      prediction: { has_enough_data: boolean };
      charging_analysis: { total_sessions: number };
    }>('/analytics/battery-health?vehicle_id=7')
    expect(battery.history).toHaveLength(12)
    expect(battery.history.at(-1)?.soh_pct).toBe(battery.current_soh)
    expect(battery.history.at(-1)?.capacity_wh).toBeGreaterThan(0)
    expect(battery.prediction.has_enough_data).toBe(true)
    expect(battery.charging_analysis.total_sessions).toBeGreaterThan(0)
    expect(demoResponse('/analytics/battery-health?vehicle_id=99', 'GET').status).toBe(400)
  })

  it('respects instant bounds, inclusive calendar days, and pagination', async () => {
    const all = await demoResponse('/drives?vehicle_id=7', 'GET').json() as { start_ts: string }[]
    const date = all[0].start_ts.slice(0, 10)
    const day = await demoResponse(`/drives?vehicle_id=7&start=${date}&end=${date}`, 'GET').json() as { start_ts: string }[]
    expect(day).toHaveLength(1)
    expect(day[0].start_ts).toBe(all[0].start_ts)

    const atStart = all[1].start_ts
    const atEnd = all[0].start_ts
    const bounded = await demoResponse(`/drives?vehicle_id=7&start=${atStart}&end=${atEnd}`, 'GET').json() as { start_ts: string }[]
    expect(bounded.map(drive => drive.start_ts)).toContain(atStart)
    expect(bounded.map(drive => drive.start_ts)).not.toContain(atEnd)
    expect(demoResponse('/drives?limit=0', 'GET').status).toBe(400)
    expect(demoResponse('/charging?vehicle_id=999', 'GET').status).toBe(400)
  })

  it('rejects unknown data and all mutations without falling back to the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(request('/unsupported')).rejects.toMatchObject({
      status: 404, code: 'DEMO_NOT_AVAILABLE',
    })
    await expect(request('/vehicles/7/commands/flash', { method: 'POST' }))
      .rejects.toMatchObject({ status: 403, code: 'DEMO_READ_ONLY' })
    await expect(resilientFetch('/unsupported', { retries: 0 }))
      .rejects.toMatchObject({ status: 404, code: 'DEMO_NOT_AVAILABLE' })
    expect(demoResponse('/vehicles', 'DELETE').status).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fails closed on a misconfigured static build', async () => {
    vi.stubEnv('VITE_DEMO_API_BASE', '/api/v1')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(request('/vehicles')).rejects.toThrow(/Static demo requires/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the ordinary production request path when the static flag is absent', async () => {
    vi.stubEnv('VITE_DEMO_STATIC_FIXTURES', undefined)
    vi.stubEnv('VITE_DEMO_MODE', undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
    )
    expect(await request('/vehicles')).toEqual([])
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/vehicles', expect.any(Object))
  })
})
