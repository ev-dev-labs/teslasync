import { describe, expect, it } from 'vitest'
import { alerts, notificationLogs } from './fixtures'
import { notificationDomain } from './notificationDomain'

const get = (path: string, query = '') => notificationDomain(path, new URLSearchParams(query))

describe('fictional notification READ fixtures', () => {
  it('links rule, alert and triggered inbox event without inventing deliveries', () => {
    const [rule] = get('/alerts/rules')!.body as { id: number; vehicle_ids: number[]; channel_ids: number[] }[]
    const alert = get(`/alerts/${alerts[0].id}`)!.body as {
      id: number; rule_id: number; events: { kind: string; occurred_at: string }[]
    }
    expect(alert).toMatchObject({
      id: alerts[0].id, rule_id: rule.id, events: [{ kind: 'created', occurred_at: alerts[0].created_at }],
    })
    expect(rule.vehicle_ids).toContain(alerts[0].vehicle_id)
    expect(rule.channel_ids).toEqual([])
    expect(notificationLogs[0]).toMatchObject({
      alert_id: alert.id, status: 'triggered', channel_id: null, sent_at: null,
    })
    expect(get('/notifications/stats')?.body).toMatchObject({
      sent: 0, failed: 0, total_sent: 0, total_channels: 1, enabled_channels: 0,
    })
  })

  it('returns typed channel, policy, and reference catalogs without a delivered channel', () => {
    expect(get('/notifications/701')?.body).toMatchObject({
      id: 701, kind: 'webhook', enabled: false, method: 'POST',
    })
    expect(get('/notifications/701/preferences')?.body).toEqual([])
    expect(get('/notifications/701/metrics')?.body).toEqual([])
    expect(get('/notifications/analytics', 'days=7')?.body).toMatchObject({
      total_sent: 0, total_failed: 0, active_channels: 0, period_days: 7,
    })
    expect(get('/notifications/quiet-hours')?.body).toMatchObject({
      windows: [{ id: 801, timezone: 'UTC', weekdays: 127, bypass_severities: ['critical'] }],
    })
    const catalog = get('/notifications/event-types')?.body as { event_type: string; transition: string }[]
    expect(catalog).toHaveLength(12)
    expect(catalog).toContainEqual(expect.objectContaining({
      event_type: 'system.telemetry.outage', transition: 'outage',
    }))
    expect(get('/alerts/metrics')?.body).toEqual([expect.objectContaining({
      id: 'charging_cost', windows: expect.arrayContaining(['day']), ops: expect.arrayContaining(['>=']),
    })])
    expect(get('/alerts/message-presets', 'kind=signal')?.body).toEqual([
      expect.objectContaining({ id: 'sample-charge-complete', template: expect.any(String) }),
    ])
    expect(get('/alerts/message-placeholders')?.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'VehicleName', group: 'Built-in' })]),
    )
    expect(get('/alerts/packs')?.body).toEqual([
      expect.objectContaining({ id: 'sample', rules: [expect.objectContaining({ rule: expect.objectContaining({ id: 601 }) })] }),
    ])
    expect(get('/alerts/pack-installations')?.body).toEqual([])
  })

  it('reports triggers within a half-open time window and zero outbound attempts', () => {
    const timestamp = Date.parse(notificationLogs[0].created_at)
    const from = new Date(timestamp - 1000).toISOString()
    const until = new Date(timestamp + 1000).toISOString()
    const query = `from_instant=${encodeURIComponent(from)}&to_exclusive=${encodeURIComponent(until)}&timezone=UTC`
    expect(get('/notifications/report', query)?.body).toMatchObject({
      from_instant: from, to_exclusive: until, timezone: 'UTC',
      triggered: 1, deliveries: 0, outbound_http_calls: 0,
      uncorrelated_deliveries: 0, by_channel: [], by_status: [],
      by_type: [{ key: notificationLogs[0].event_type, count: 1 }],
      daily: [expect.objectContaining({ triggered: 1, deliveries: 0 })],
    })
    const empty = get('/notifications/report',
      `from_instant=${encodeURIComponent(until)}&to_exclusive=${encodeURIComponent(new Date(timestamp + 2000).toISOString())}`)
      ?.body as { triggered: number; daily: { triggered: number }[] }
    expect(empty.triggered).toBe(0)
    expect(empty.daily[0].triggered).toBe(0)
  })

  it('rejects invalid IDs and filters instead of fabricating records', () => {
    for (const path of ['/alerts/0', '/alerts/oops', '/alerts/9007199254740993',
      '/notifications/0', '/notifications/nope', '/notifications/9007199254740993']) {
      expect(get(path)?.status, path).toBe(400)
    }
    for (const path of ['/alerts/999', '/notifications/999', '/notifications/999/preferences']) {
      expect(get(path)?.status, path).toBe(404)
    }
    for (const query of [
      'limit=0', 'limit=bad', 'offset=-1',
    ]) expect(get('/alerts/pack-installations', query)?.status, query).toBe(400)
    for (const query of [
      'from_instant=invalid&to_exclusive=2026-01-01', 'from_instant=2026-02-01',
      'from=2026-03-01&to=2026-02-01', 'from=2026-99-99', 'timezone=Not/AZone',
      'from=2026-01-01&from_instant=2026-01-01T00%3A00%3A00Z&to_exclusive=2026-02-01T00%3A00%3A00Z',
    ]) expect(get('/notifications/report', query)?.status, query).toBe(400)
  })

  it('does not consume paths owned by the central fixture API or write routes', () => {
    for (const path of ['/alerts', '/notifications', '/notifications/logs', '/notifications/unread-count',
      '/alerts/301/acknowledge', '/alerts/rules/601', '/notifications/701/test', '/anything']) {
      expect(get(path), path).toBeUndefined()
    }
  })
})
