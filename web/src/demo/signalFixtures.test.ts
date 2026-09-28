import { describe, expect, it } from 'vitest'
import { charging, drives, vehicles } from './fixtures'
import { signalFixtures } from './signalFixtures'

const read = (path: string, query = '') =>
  signalFixtures(path, new URLSearchParams(query))

describe('synthetic signal reads', () => {
  it('does not handle unrelated or unsupported endpoints', () => {
    expect(read('/vehicles')).toBeUndefined()
    expect(read('/signals/7/snapshot')).toBeUndefined()
    expect(read('/signals/7/VehicleSpeed/diff')).toBeUndefined()
    expect(read('/signals/catalog')).toBeUndefined()
  })

  it('offers only documented fixture-backed fields with proto-compatible metadata', () => {
    const result = read('/signals/7/available')
    expect(result?.status).toBe(200)
    const body = result?.body as {
      vehicle_id: number
      count: number
      signals: Array<{ name: string; value_kind: string; unit_kind: string }>
    }
    expect(body.vehicle_id).toBe(vehicles[0].id)
    expect(body.count).toBe(body.signals.length)
    expect(body.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Odometer', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindDistance' }),
      expect.objectContaining({ name: 'VehicleSpeed', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindNone' }),
      expect.objectContaining({ name: 'ChargeState', value_kind: 'ValueKindEnum' }),
    ]))
    expect(read('/signals/8/available')?.status).toBe(200)
    expect(read('/signals/99/available')?.status).toBe(400)
    expect(read('/signals/0/available')?.status).toBe(400)
    expect(read('/signals/7/available', 'surprise=1')?.status).toBe(400)
  })

  it('labels aggregate-derived values stale rather than pretending a live feed exists', () => {
    const result = read('/signals/7/live')
    expect(result?.status).toBe(200)
    const body = result?.body as {
      count: number
      at: string
      signals: Record<string, { source: string; age_ms: number; ts: string; timestamp: string; kind: string }>
    }
    expect(body.count).toBe(Object.keys(body.signals).length)
    expect(body.count).toBeGreaterThan(0)
    for (const entry of Object.values(body.signals)) {
      expect(entry.source).toBe('stale')
      expect(entry.age_ms).toBeGreaterThan(120_000)
      expect(entry.age_ms).toBeCloseTo(Date.parse(body.at) - Date.parse(entry.ts), 0)
      expect(entry.timestamp).toBe(entry.ts)
    }
    expect(read('/signals/7/live', 'hours=1')?.status).toBe(400)
  })

  it('derives SI driving and charging observations with typed history envelopes', () => {
    const drive = drives.find(row => row.vehicle_id === 7)!
    const session = charging.find(row => row.vehicle_id === 7)!
    const from = new Date(Math.min(Date.parse(drive.start_ts), Date.parse(session.started_at)) - 1000).toISOString()
    const to = new Date(Math.max(Date.parse(drive.end_ts), Date.parse(session.ended_at)) + 1000).toISOString()
    const range = new URLSearchParams({ from, to })
    const speed = signalFixtures('/signals/7/VehicleSpeed/history', range)?.body as {
      expected_kind: string; count: number; data: Array<{ ts: string; kind: string; value: number; ingest_origin: string; source_emitted_at: null }>
    }
    expect(speed.expected_kind).toBe('ValueKindFloat')
    expect(speed.count).toBeGreaterThan(0)
    expect(speed.data).toContainEqual(expect.objectContaining({
      value: drive.avg_speed_mps, kind: 'ValueKindFloat',
      ingest_origin: 'unknown', source_emitted_at: null,
    }))
    const odo = signalFixtures('/signals/7/Odometer/history', range)?.body as {
      data: Array<{ value: number; ts: string }>
    }
    expect(odo.data).toContainEqual(expect.objectContaining({
      ts: drive.end_ts, value: drive.end_odometer_m,
    }))
    const charge = signalFixtures('/signals/7/ChargeState/history', range)?.body as {
      data: Array<{ value: number; ts: string }>
    }
    expect(charge.data).toContainEqual(expect.objectContaining({
      ts: session.started_at, value: 4,
    }))
    expect(charge.data).toContainEqual(expect.objectContaining({
      ts: session.ended_at, value: 6,
    }))
  })

  it('applies vehicle, inclusive time window, limit and optional legacy page filters', () => {
    const drive = drives.find(row => row.vehicle_id === 8)!
    const range = new URLSearchParams({ from: drive.start_ts, to: drive.end_ts, limit: '1' })
    const first = signalFixtures('/signals/8/Odometer/history', range)?.body as {
      count: number; data: Array<{ ts: string; value: number }>
    }
    expect(first.count).toBe(1)
    expect(first.data[0]).toMatchObject({ ts: drive.start_ts, value: drive.start_odometer_m })
    range.set('page', '2')
    const second = signalFixtures('/signals/8/Odometer/history', range)?.body as {
      count: number; data: Array<{ ts: string; value: number }>
    }
    expect(second.count).toBe(1)
    expect(second.data[0]).toMatchObject({ ts: drive.end_ts, value: drive.end_odometer_m })
    const recent = read('/signals/8/Odometer/history', 'hours=1')?.body as { count: number }
    expect(recent.count).toBe(0)
    const stats = read('/signals/8/stats')?.body as { count: number; oldest: string; newest: string }
    expect(stats.count).toBeGreaterThan(0)
    expect(Date.parse(stats.oldest)).toBeLessThan(Date.parse(stats.newest))
  })

  it.each([
    ['/signals/x/live', ''],
    ['/signals/7/Unknown/history', ''],
    ['/signals/7/%ZZ/history', ''],
    ['/signals/7/Odometer/history', 'hours=0'],
    ['/signals/7/Odometer/history', 'hours=NaN'],
    ['/signals/7/Odometer/history', 'limit=-1'],
    ['/signals/7/Odometer/history', 'page=0'],
    ['/signals/7/Odometer/history', 'from=not-a-date'],
    ['/signals/7/Odometer/history', 'from=2026-09-28T00%3A00%3A00Z&to=2026-09-27T00%3A00%3A00Z'],
    ['/signals/7/Odometer/history', 'unexpected=true'],
    ['/signals/7/Odometer/history', 'limit=2&limit=3'],
  ])('rejects invalid or unknown request %s?%s', (path, query) => {
    expect(read(path, query)?.status).toBe(path.includes('Unknown') ? 404 : 400)
  })
})
