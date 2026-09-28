type FixtureResult = { status: number; body: unknown }

const found = (body: unknown): FixtureResult => ({ status: 200, body })
const invalid = (): FixtureResult => ({
  status: 400,
  body: { error: 'Invalid synthetic administration filters', code: 'INVALID_FILTER' },
})

// A migration version, real connection pool or backup artifact cannot be inferred
// from a browser fixture. Report them as unavailable rather than as healthy.
const unavailable = (subject: string): FixtureResult => ({
  status: 503,
  body: { error: `${subject} is unavailable in the synthetic public demo`, code: 'DEMO_NOT_AVAILABLE' },
})

const apiCalls = [
  {
    id: 2, ts: '2026-01-02T12:00:00Z', vehicle_id: null, service: 'synthetic_demo',
    http_method: 'GET', endpoint: '/demo/example', status_code: 200, duration_ms: 12,
    error_message: null, rate_limited: false, request_body: null, response_body: null,
  },
  {
    id: 1, ts: '2026-01-01T12:00:00Z', vehicle_id: null, service: 'synthetic_demo',
    http_method: 'GET', endpoint: '/demo/unavailable', status_code: 503, duration_ms: 18,
    error_message: 'Fictional demo request unavailable', rate_limited: false,
    request_body: null, response_body: null,
  },
]

const auditRows = [
  {
    id: 2, ts: '2026-01-02T12:00:00Z', actor: 'Fictional demo operator',
    action: 'demo.fixture.viewed', entity_type: 'demo_fixture', entity_id: null,
    detail: 'Synthetic example only; no operator action occurred',
  },
  {
    id: 1, ts: '2026-01-01T12:00:00Z', actor: 'Fictional demo operator',
    action: 'demo.fixture.created', entity_type: 'demo_fixture', entity_id: null,
    detail: 'Synthetic example only; no operator action occurred',
  },
]

const integer = (value: string | null, fallback: number, min: number, max: number): number | null => {
  if (value === null) return fallback
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
}

function windowBounds(params: URLSearchParams, includeLegacyEnd: boolean): [number, number] | null {
  const start = params.get('start')
  const endExclusive = params.get('end_exclusive')
  const end = includeLegacyEnd ? params.get('end') : null
  if (end != null && endExclusive != null) return null
  if ((start == null) !== (endExclusive == null) && end == null) return null
  const from = start == null ? -Infinity : Date.parse(start)
  const until = endExclusive != null ? Date.parse(endExclusive)
    : end == null ? Infinity : Date.parse(end)
  if ((start != null && !Number.isFinite(from))
    || ((endExclusive != null || end != null) && !Number.isFinite(until))
    || from >= until) return null
  return [from, until]
}

function filteredCalls(params: URLSearchParams, stats: boolean): FixtureResult {
  const allowed = stats
    ? new Set(['start', 'end_exclusive'])
    : new Set(['page', 'limit', 'offset', 'method', 'status', 'endpoint', 'service', 'start', 'end', 'end_exclusive'])
  if ([...params.keys()].some(key => !allowed.has(key))) return invalid()
  const bounds = windowBounds(params, !stats)
  if (!bounds) return invalid()
  const [start, end] = bounds
  const rows = apiCalls.filter(row => Date.parse(row.ts) >= start
    && (params.has('end') ? Date.parse(row.ts) <= end : Date.parse(row.ts) < end)
    && (stats || (
      (!params.has('method') || row.http_method === params.get('method'))
      && (!params.has('status') || String(row.status_code) === params.get('status'))
      && (!params.has('endpoint') || row.endpoint.includes(params.get('endpoint')!))
      && (!params.has('service') || row.service === params.get('service'))
    )))
  if (stats) {
    const errors = rows.filter(row => row.status_code >= 400 || row.error_message != null).length
    const countBy = (key: 'http_method' | 'service') => Object.fromEntries(
      [...new Set(rows.map(row => row[key]))].map(value => [
        value, rows.filter(row => row[key] === value).length,
      ]),
    )
    return found({
      total_calls: rows.length, error_count: errors,
      error_rate: rows.length ? errors / rows.length * 100 : 0,
      avg_duration_ms: rows.length
        ? rows.reduce((total, row) => total + row.duration_ms, 0) / rows.length : 0,
      last_24h: rows.filter(row => Date.parse(row.ts) >= Date.now() - 86_400_000).length,
      by_method: countBy('http_method'), by_service: countBy('service'),
    })
  }
  const limit = integer(params.get('limit'), 50, 1, 200)
  const offset = integer(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const page = integer(params.get('page'), 1, 1, Number.MAX_SAFE_INTEGER)
  if (limit == null || offset == null || page == null
    || (params.has('page') && params.has('offset'))) return invalid()
  const from = params.has('page') ? (page - 1) * limit : offset
  if (!Number.isSafeInteger(from)) return invalid()
  return found({
    data: rows.slice(from, from + limit).map(row => ({ ...row })),
    total: rows.length, limit, offset: from,
  })
}

/**
 * Browser-only GET fixtures. Unknown paths are deliberately left for the
 * central demo transport; this module never handles mutations.
 */
export function adminDomain(pathname: string, params: URLSearchParams): FixtureResult | undefined {
  if (pathname === '/api-keys') return found([])
  if (pathname === '/api-logs' || pathname === '/api-logs/') return filteredCalls(params, false)
  if (pathname === '/api-logs/stats') return filteredCalls(params, true)
  if (pathname === '/backup/configs') return found([])
  if (pathname === '/backup/runs') {
    const limit = integer(params.get('limit'), 50, 1, 200)
    const offset = integer(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
    return limit == null || offset == null ? invalid() : found([])
  }
  if (pathname === '/system/audit') {
    const limit = integer(params.get('limit'), 50, 1, 200)
    return limit == null ? invalid() : found(auditRows.slice(0, limit).map(row => ({ ...row })))
  }
  if (pathname === '/dev-tools/db-stats') {
    return found({
      tables: [{ schema: 'demo', name: 'synthetic_sample_events', row_count: apiCalls.length }],
      table_count: 1, database_size: 0, source: 'synthetic_demo',
    })
  }
  if (pathname === '/dev-tools/migration-status') return unavailable('Database migration status')
  if (pathname === '/dev-tools/runtime-info') return unavailable('Server runtime and connection pool')
  if (pathname === '/admin/maintenance') {
    return found({
      mode: 'maintenance', maintenance_message: 'Synthetic public demo — no live service status',
      updated_at: '2026-01-01T00:00:00Z', source: 'default',
    })
  }
  if (pathname === '/admin/web-errors/summary') {
    return found({ window_seconds: 3600, total: 0, top: [], as_of: new Date().toISOString() })
  }
  return undefined
}
