import { describe, expect, it } from 'vitest'
import { adminDomain } from './adminDomain'

const get = (path: string, query = '') => adminDomain(path, new URLSearchParams(query))

describe('synthetic administration READ fixtures', () => {
  it('does not mint credentials or pretend backups completed', () => {
    expect(get('/api-keys')).toEqual({ status: 200, body: [] })
    expect(get('/backup/configs')).toEqual({ status: 200, body: [] })
    expect(get('/backup/runs')).toEqual({ status: 200, body: [] })
    expect(get('/backup/runs', 'limit=0')?.status).toBe(400)
    expect(get('/backup/runs', 'offset=-1')?.status).toBe(400)
  })

  it('paginates and filters API logs with backend data/total shape', () => {
    const all = get('/api-logs')?.body as { data: Record<string, unknown>[]; total: number }
    expect(all.total).toBe(2)
    expect(all.data).toHaveLength(2)
    expect(all.data[0]).toMatchObject({
      service: 'synthetic_demo', http_method: 'GET', endpoint: '/demo/example',
      status_code: 200, error_message: null, vehicle_id: null,
    })
    expect(JSON.stringify(all)).not.toMatch(/key_hash|access_token|request_headers/i)
    expect((get('/api-logs', 'page=2&limit=1')?.body as { data: unknown[]; offset: number }))
      .toMatchObject({ data: [all.data[1]], offset: 1 })
    expect((get('/api-logs', 'method=POST')?.body as { data: unknown[]; total: number }))
      .toMatchObject({ data: [], total: 0 })
    expect((get('/api-logs', 'status=503&service=synthetic_demo')?.body as { total: number }).total)
      .toBe(1)
    expect((get('/api-logs', 'start=2030-01-01T00%3A00%3A00Z&end_exclusive=2030-01-02T00%3A00%3A00Z')
      ?.body as { total: number }).total).toBe(0)
    expect((get('/api-logs', 'endpoint=unavailable')?.body as { data: unknown[] }).data)
      .toEqual([all.data[1]])
  })

  it('derives log stats from precisely the same filtered rows', () => {
    expect(get('/api-logs/stats')?.body).toMatchObject({
      total_calls: 2, error_count: 1, error_rate: 50, avg_duration_ms: 15,
      by_method: { GET: 2 }, by_service: { synthetic_demo: 2 },
    })
    expect(get('/api-logs/stats',
      'start=2026-01-02T00%3A00%3A00Z&end_exclusive=2026-01-03T00%3A00%3A00Z')?.body)
      .toMatchObject({ total_calls: 1, error_count: 0, error_rate: 0 })
    expect(get('/api-logs/stats',
      'start=2030-01-01T00%3A00%3A00Z&end_exclusive=2030-01-02T00%3A00%3A00Z')?.body)
      .toMatchObject({ total_calls: 0, avg_duration_ms: 0, by_method: {} })
  })

  it('rejects invalid pagination and windows rather than showing unrelated data', () => {
    for (const query of [
      'limit=0', 'limit=foo', 'offset=-1', 'page=0', 'page=2&offset=0',
      'start=not-a-date&end_exclusive=2030-01-01', 'start=2030-01-02&end_exclusive=2030-01-01',
      'start=2030-01-01', 'start=2026-01-01&end=2026-01-02&end_exclusive=2026-01-03',
      'vehicleId=7',
    ]) {
      expect(get('/api-logs', query)?.status, query).toBe(400)
    }
    expect(get('/api-logs/stats', 'end_exclusive=2030-01-01')?.status).toBe(400)
  })

  it('identifies fictional audit and database data without asserting production health', () => {
    const audit = get('/system/audit')?.body as { actor: string; action: string; ts: string }[]
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({ actor: 'Fictional demo operator', action: 'demo.fixture.viewed' })
    expect(get('/system/audit', 'limit=1')?.body).toEqual([audit[0]])
    expect(get('/system/audit', 'limit=bad')?.status).toBe(400)
    expect(get('/dev-tools/db-stats')?.body).toMatchObject({
      source: 'synthetic_demo', table_count: 1, database_size: 0,
      tables: [{ schema: 'demo', name: 'synthetic_sample_events', row_count: 2 }],
    })
    expect(get('/dev-tools/migration-status')).toMatchObject({
      status: 503, body: { code: 'DEMO_NOT_AVAILABLE' },
    })
    expect(get('/dev-tools/runtime-info')?.status).toBe(503)
    expect(get('/admin/maintenance')?.body).toMatchObject({
      mode: 'maintenance', source: 'default', maintenance_message: expect.stringContaining('Synthetic'),
    })
    expect(get('/admin/web-errors/summary')?.body).toMatchObject({
      window_seconds: 3600, total: 0, top: [],
    })
  })

  it('keeps callers isolated and leaves unknown paths to the central transport', () => {
    const first = get('/api-logs')!.body as { data: { endpoint: string }[] }
    first.data[0].endpoint = '/mutated'
    const audit = get('/system/audit')!.body as { detail: string }[]
    audit[0].detail = 'mutated'
    expect((get('/api-logs')!.body as typeof first).data[0].endpoint).toBe('/demo/example')
    expect((get('/system/audit')!.body as typeof audit)[0].detail).toContain('Synthetic')
    expect(get('/api-keys/1')).toBeUndefined()
    expect(get('/backup/configs/1')).toBeUndefined()
    expect(get('/admin/not-a-real-panel')).toBeUndefined()
  })
})
