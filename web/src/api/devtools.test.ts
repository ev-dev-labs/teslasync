// devtools.ts wire-contract tests.
//
// devtools.ts is a flat catalogue of typed HTTP wrappers for the admin /
// dev-tools surface (telemetry capture, Redis L2 signal cache, API call
// logs, system health, data-repair, backup/restore, API keys, audit,
// async export/import jobs, and the AI chatbot). Every export is a thin
// adapter over the shared @/api/client `request()` (or, for browser-owned
// download / multipart flows, `apiUrl()` + raw `fetch`/`window.open`).
//
// Because these wrappers ARE the wire contract the Go router must satisfy,
// the assertions below pin the exact request each export issues: the
// un-prefixed path (the client auto-adds /api/v1 — hooks must NOT), the
// snake_case query params, the HTTP verb, and the serialised body. We mock
// only the network boundary (`request`) and keep the real `apiUrl` /
// `ApiError` so URL construction and error typing are exercised for real.
//
// Two regression guards live here:
//   • submitImportJob MUST bypass request() and post raw FormData — routing a
//     multipart body through request() lets the client force
//     `Content-Type: application/json`, stripping the boundary and breaking
//     the server's form parser (mirrors the useUploadVehiclePhoto pattern).
//   • getChatHistory MUST URL-encode the session_id query param, matching
//     the encodeURIComponent used by rename/delete.
//
// Sibling-of-source location is mandatory: the elevation gate resolves the
// co-located `devtools.test.ts` next to `devtools.ts`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request, apiUrl, ApiError } from '@/api/client'
import type { ChargingSession, Drive } from '@/api/types'
import {
  getCaptureStats,
  getRedisSignals,
  getRedisSignalKeys,
  purgeRedisSignals,
  purgeAllRedisSignals,
  getTelemetryStatus,
  getAPICallLogs,
  getAPICallLogStats,
  getAPIUsage,
  getCompressionStats,
  getExtendedHealth,
  getBackupStats,
  getErrorStats,
  getWorkersHealth,
  getVersionInfo,
  checkForUpdates,
  getStaleSessions,
  updateChargingSession,
  updateDrive,
  closeChargingSession,
  closeDrive,
  deleteChargingSession,
  deleteDrive,
  getBackupConfigs,
  getBackupConfig,
  createBackupConfig,
  updateBackupConfig,
  deleteBackupConfig,
  triggerBackup,
  triggerQuickBackup,
  getBackupRuns,
  getBackupRun,
  downloadBackup,
  verifyBackup,
  previewRestore,
  getAPIKeys,
  createAPIKey,
  deleteAPIKey,
  revokeAPIKey,
  getAuditLogs,
  submitExportJob,
  getExportJobs,
  getExportJob,
  getExportJobDownloadUrl,
  submitImportJob,
  sendChatMessage,
  getChatHistory,
  getChatSessions,
  renameChatSession,
  deleteChatSession,
} from './devtools'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

/** Reads back the [path, options] pair from the Nth request() call. */
function call(n = 0): [string, Record<string, unknown> | undefined] {
  return mockedRequest.mock.calls[n] as [string, Record<string, unknown> | undefined]
}

beforeEach(() => {
  mockedRequest.mockReset()
})

// ---------------------------------------------------------------------------
// Parameterless GETs — one adapter per path, all issuing a bare request(path)
// with no options object. Table-driven so a new endpoint is one row.
// ---------------------------------------------------------------------------

describe.each([
  ['getCaptureStats', getCaptureStats, '/dev-tools/telemetry-capture/stats'],
  ['getTelemetryStatus', getTelemetryStatus, '/telemetry'],
  ['getAPICallLogStats', getAPICallLogStats, '/api-logs/stats'],
  ['getAPIUsage', getAPIUsage, '/system/api-usage'],
  ['getCompressionStats', getCompressionStats, '/system/compression-stats'],
  ['getBackupStats', getBackupStats, '/system/backup/stats'],
  ['getErrorStats', getErrorStats, '/system/errors/stats'],
  ['getWorkersHealth', getWorkersHealth, '/system/workers'],
  ['getVersionInfo', getVersionInfo, '/system/version'],
  ['checkForUpdates', checkForUpdates, '/system/update-check'],
  ['getStaleSessions', getStaleSessions, '/data-repair/stale-sessions'],
  ['getBackupConfigs', getBackupConfigs, '/backup/configs'],
  ['getAPIKeys', getAPIKeys, '/api-keys'],
] as const)('%s (parameterless GET)', (_name, fn, path) => {
  it('GETs the canonical un-prefixed path and forwards the payload verbatim', async () => {
    const payload = { _endpoint: path }
    mockedRequest.mockResolvedValueOnce(payload)

    const res = await (fn as () => Promise<unknown>)()

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    const [url, opts] = call()
    expect(url).toBe(path)
    // Bare GET — no verb / body / options are attached.
    expect(opts).toBeUndefined()
    expect(res).toBe(payload)
  })
})

describe('getExtendedHealth', () => {
  it('accepts the endpoint health snapshot when degraded state uses HTTP 503', async () => {
    const payload = { status: 'degraded', components: {} }
    mockedRequest.mockResolvedValueOnce(payload)

    const result = await getExtendedHealth()

    expect(call()).toEqual([
      '/system/health',
      { acceptedStatuses: [503] },
    ])
    expect(result).toBe(payload)
  })
})

// ---------------------------------------------------------------------------
// Redis L2 signal cache — parameterised reads + purge verbs
// ---------------------------------------------------------------------------

describe('Redis signal cache', () => {
  it('getRedisSignals threads the vehicle id as a snake_case query param', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 7, signal_count: 0, signals: {} })
    await getRedisSignals(7)
    expect(call()[0]).toBe('/dev-tools/redis-signals?vehicle_id=7')
    expect(call()[1]).toBeUndefined()
  })

  it('getRedisSignalKeys defaults the limit to 50 and honours an override', async () => {
    mockedRequest.mockResolvedValue({ keys: [], total: 0 })
    await getRedisSignalKeys()
    expect(call(0)[0]).toBe('/dev-tools/redis-signals/keys?limit=50')
    await getRedisSignalKeys(10)
    expect(call(1)[0]).toBe('/dev-tools/redis-signals/keys?limit=10')
  })

  it('purgeRedisSignals DELETEs a single vehicle HSET', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 7, purged: true })
    await purgeRedisSignals(7)
    const [url, opts] = call()
    expect(url).toBe('/dev-tools/redis-signals?vehicle_id=7')
    expect(opts?.method).toBe('DELETE')
  })

  it('purgeAllRedisSignals DELETEs the bounded keyspace sweep', async () => {
    mockedRequest.mockResolvedValueOnce({ purged: 0, scanned: 0, limit: 100, has_more: false })
    await purgeAllRedisSignals()
    const [url, opts] = call()
    expect(url).toBe('/dev-tools/redis-signals/keys')
    expect(opts?.method).toBe('DELETE')
  })
})

// ---------------------------------------------------------------------------
// API call logs — the URLSearchParams query builder has real branches
// ---------------------------------------------------------------------------

describe('getAPICallLogs', () => {
  it('issues a bare query when no filters are supplied', async () => {
    mockedRequest.mockResolvedValueOnce({ logs: [], total: 0 })
    await getAPICallLogs()
    expect(call()[0]).toBe('/api-logs?')
  })

  it('serialises every provided filter in declaration order and URL-encodes values', async () => {
    mockedRequest.mockResolvedValueOnce({ logs: [], total: 0 })
    await getAPICallLogs({
      limit: 10,
      offset: 20,
      method: 'GET',
      status: '200',
      endpoint: '/vehicles',
      service: 'api',
      start: '2025-01-01',
      end: '2025-01-02',
    })
    expect(call()[0]).toBe(
      '/api-logs?limit=10&offset=20&method=GET&status=200&endpoint=%2Fvehicles&service=api&start=2025-01-01&end=2025-01-02',
    )
  })

  it('omits falsy filters (0 limit, empty method) so no blank params leak into the URL', async () => {
    mockedRequest.mockResolvedValueOnce({ logs: [], total: 0 })
    await getAPICallLogs({ limit: 0, offset: 0, method: '', endpoint: '/x' })
    // limit/offset 0 and empty method are dropped; only the truthy endpoint survives.
    expect(call()[0]).toBe('/api-logs?endpoint=%2Fx')
  })
})

// ---------------------------------------------------------------------------
// Data repair — PUT patches, POST closes, DELETE removals
// ---------------------------------------------------------------------------

describe('data repair mutations', () => {
  it('updateChargingSession PUTs the JSON patch to the session path', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 3 })
    await updateChargingSession(3, { end_soc_pct: 80 } as Partial<ChargingSession>)
    const [url, opts] = call()
    expect(url).toBe('/data-repair/charging/3')
    expect(opts?.method).toBe('PUT')
    expect(JSON.parse(opts?.body as string)).toEqual({ end_soc_pct: 80 })
  })

  it('updateDrive PUTs the JSON patch to the drive path', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 4 })
    await updateDrive(4, { end_address: 'Home' } as Partial<Drive>)
    const [url, opts] = call()
    expect(url).toBe('/data-repair/drive/4')
    expect(opts?.method).toBe('PUT')
    expect(JSON.parse(opts?.body as string)).toEqual({ end_address: 'Home' })
  })

  it('closeChargingSession and closeDrive POST to their /close sub-routes', async () => {
    mockedRequest.mockResolvedValue(undefined)
    await closeChargingSession(3)
    await closeDrive(4)
    expect(call(0)[0]).toBe('/data-repair/charging/3/close')
    expect(call(0)[1]?.method).toBe('POST')
    expect(call(1)[0]).toBe('/data-repair/drive/4/close')
    expect(call(1)[1]?.method).toBe('POST')
  })

  it('deleteChargingSession and deleteDrive DELETE their base rows', async () => {
    mockedRequest.mockResolvedValue(undefined)
    await deleteChargingSession(3)
    await deleteDrive(4)
    expect(call(0)[0]).toBe('/data-repair/charging/3')
    expect(call(0)[1]?.method).toBe('DELETE')
    expect(call(1)[0]).toBe('/data-repair/drive/4')
    expect(call(1)[1]?.method).toBe('DELETE')
  })
})

// ---------------------------------------------------------------------------
// Backup & restore — CRUD, triggers, paginated runs, browser download
// ---------------------------------------------------------------------------

describe('backup & restore', () => {
  it('getBackupConfig reads a single config by id', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 2 })
    await getBackupConfig(2)
    expect(call()[0]).toBe('/backup/configs/2')
  })

  it('createBackupConfig POSTs the config as JSON with an explicit Content-Type', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 5 })
    const cfg = { name: 'nightly' } as unknown as Parameters<typeof createBackupConfig>[0]
    await createBackupConfig(cfg)
    const [url, opts] = call()
    expect(url).toBe('/backup/configs')
    expect(opts?.method).toBe('POST')
    expect(JSON.parse(opts?.body as string)).toEqual({ name: 'nightly' })
    expect(opts?.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('updateBackupConfig PUTs to the id path', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 2 })
    const cfg = { name: 'renamed' } as unknown as Parameters<typeof updateBackupConfig>[1]
    await updateBackupConfig(2, cfg)
    const [url, opts] = call()
    expect(url).toBe('/backup/configs/2')
    expect(opts?.method).toBe('PUT')
  })

  it('deleteBackupConfig DELETEs the id path', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    await deleteBackupConfig(2)
    expect(call()[0]).toBe('/backup/configs/2')
    expect(call()[1]?.method).toBe('DELETE')
  })

  it('triggerBackup and triggerQuickBackup POST to their run endpoints', async () => {
    mockedRequest.mockResolvedValue({ id: 1 })
    await triggerBackup(5)
    await triggerQuickBackup()
    expect(call(0)[0]).toBe('/backup/configs/5/trigger')
    expect(call(0)[1]?.method).toBe('POST')
    expect(call(1)[0]).toBe('/backup/quick')
    expect(call(1)[1]?.method).toBe('POST')
  })

  it('getBackupRuns paginates with default and explicit limit/offset', async () => {
    mockedRequest.mockResolvedValue([])
    await getBackupRuns()
    expect(call(0)[0]).toBe('/backup/runs?limit=50&offset=0')
    await getBackupRuns(10, 20)
    expect(call(1)[0]).toBe('/backup/runs?limit=10&offset=20')
  })

  it('getBackupRun reads a single run', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 9 })
    await getBackupRun(9)
    expect(call()[0]).toBe('/backup/runs/9')
  })

  it('verifyBackup POSTs to the verify sub-route and previewRestore GETs the preview', async () => {
    mockedRequest.mockResolvedValueOnce({ verified: true })
    await verifyBackup(5)
    expect(call(0)[0]).toBe('/backup/runs/5/verify')
    expect(call(0)[1]?.method).toBe('POST')

    mockedRequest.mockResolvedValueOnce({ tables: [], metadata: {}, checksum_verified: true })
    await previewRestore(5)
    expect(call(1)[0]).toBe('/backup/runs/5/preview')
    expect(call(1)[1]).toBeUndefined()
  })

  it('downloadBackup opens the fully-qualified download URL in a new tab (no request())', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    try {
      downloadBackup(5)
      expect(openSpy).toHaveBeenCalledTimes(1)
      expect(openSpy).toHaveBeenCalledWith(apiUrl('/backup/runs/5/download'), '_blank')
      expect(mockedRequest).not.toHaveBeenCalled()
    } finally {
      openSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// API keys — create returns the one-time secret; delete vs revoke differ
// ---------------------------------------------------------------------------

describe('API keys', () => {
  it('createAPIKey POSTs name + permissions and surfaces the one-time key', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 1, name: 'ci', key: 'sk_live_123' })
    const created = await createAPIKey({ name: 'ci', permissions: 'read' })
    const [url, opts] = call()
    expect(url).toBe('/api-keys')
    expect(opts?.method).toBe('POST')
    expect(JSON.parse(opts?.body as string)).toEqual({ name: 'ci', permissions: 'read' })
    expect(created.key).toBe('sk_live_123')
  })

  it('deleteAPIKey DELETEs while revokeAPIKey POSTs to /revoke — distinct verbs, distinct routes', async () => {
    mockedRequest.mockResolvedValue(undefined)
    await deleteAPIKey(3)
    await revokeAPIKey(3)
    expect(call(0)[0]).toBe('/api-keys/3')
    expect(call(0)[1]?.method).toBe('DELETE')
    expect(call(1)[0]).toBe('/api-keys/3/revoke')
    expect(call(1)[1]?.method).toBe('POST')
  })
})

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

describe('getAuditLogs', () => {
  it('defaults the limit to 50 and honours an override', async () => {
    mockedRequest.mockResolvedValue([])
    await getAuditLogs()
    expect(call(0)[0]).toBe('/system/audit?limit=50')
    await getAuditLogs(5)
    expect(call(1)[0]).toBe('/system/audit?limit=5')
  })
})

// ---------------------------------------------------------------------------
// Export / import jobs
// ---------------------------------------------------------------------------

describe('export jobs', () => {
  it('submitExportJob POSTs the request spec as JSON', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 'j1', type: 'drives', format: 'csv', status: 'queued', message: '' })
    await submitExportJob({ type: 'drives', format: 'csv' })
    const [url, opts] = call()
    expect(url).toBe('/export/jobs')
    expect(opts?.method).toBe('POST')
    expect(JSON.parse(opts?.body as string)).toEqual({ type: 'drives', format: 'csv' })
  })

  it('getExportJobs paginates with defaults and explicit values', async () => {
    mockedRequest.mockResolvedValue([])
    await getExportJobs()
    expect(call(0)[0]).toBe('/export/jobs?limit=50&offset=0')
    await getExportJobs(10, 5)
    expect(call(1)[0]).toBe('/export/jobs?limit=10&offset=5')
  })

  it('getExportJob reads a single job by id', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 'abc' })
    await getExportJob('abc')
    expect(call()[0]).toBe('/export/jobs/abc')
  })

  it('getExportJobDownloadUrl builds a fully-qualified URL without touching request()', () => {
    const url = getExportJobDownloadUrl('job-9')
    expect(url).toBe(apiUrl('/export/jobs/job-9/download'))
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// submitImportJob is the multipart-upload regression suite: it MUST bypass
// request() and post raw FormData so the browser owns the Content-Type
// boundary. We stub the global fetch to observe the raw request.
describe('submitImportJob (multipart upload)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const makeFile = () => new File(['id,vin\n1,ABC'], 'drives.csv', { type: 'text/csv' })

  it('POSTs raw FormData via fetch — never through the JSON request() client', async () => {
    const payload = { id: 'job-1', type: 'import_drives', format: 'csv', status: 'queued', message: 'ok' }
    fetchMock.mockResolvedValueOnce({ ok: true, status: 202, json: async () => payload })

    const res = await submitImportJob('import_drives', makeFile())

    expect(mockedRequest).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(apiUrl('/export/jobs/import'))
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    // Critical: NO Content-Type header — the browser must set the multipart
    // boundary itself. A forced application/json here breaks server parsing.
    expect(init.headers).toBeUndefined()
    const form = init.body as FormData
    expect(form.get('type')).toBe('import_drives')
    expect(form.get('file')).toBeInstanceOf(File)
    expect(res).toEqual(payload)
  })

  it('throws an ApiError carrying the server status + code on a failed upload', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 413,
      statusText: 'Payload Too Large',
      json: async () => ({ error: 'file too big', code: 'TOO_LARGE' }),
    })

    const err = await submitImportJob('import_charging', makeFile()).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(413)
    expect((err as ApiError).message).toBe('file too big')
    expect((err as ApiError).code).toBe('TOO_LARGE')
  })

  it('falls back to statusText when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json')
      },
    })

    const err = await submitImportJob('import_drives', makeFile()).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(500)
    expect((err as ApiError).message).toBe('Internal Server Error')
  })
})

// ---------------------------------------------------------------------------
// Chatbot — body shape, session-id encoding, and AbortSignal threading
// ---------------------------------------------------------------------------

describe('chatbot', () => {
  it('sendChatMessage POSTs message + session_id when a session is supplied', async () => {
    mockedRequest.mockResolvedValueOnce({ response: 'hi', session_id: 's9' })
    await sendChatMessage('hello', 's9')
    const [url, opts] = call()
    expect(url).toBe('/chatbot')
    expect(opts?.method).toBe('POST')
    expect(JSON.parse(opts?.body as string)).toEqual({ message: 'hello', session_id: 's9' })
  })

  it('sendChatMessage omits session_id from the body when none is supplied', async () => {
    mockedRequest.mockResolvedValueOnce({ response: 'hi', session_id: 's_new' })
    await sendChatMessage('hello')
    const body = JSON.parse(call()[1]?.body as string)
    expect(body).toEqual({ message: 'hello' })
    expect(body).not.toHaveProperty('session_id')
  })

  it('getChatHistory URL-encodes the session id and threads the abort signal', async () => {
    mockedRequest.mockResolvedValue([])
    const controller = new AbortController()
    await getChatHistory('s 1/2', { signal: controller.signal })
    const [url, opts] = call()
    // Space -> %20, slash -> %2F: encodeURIComponent guards a malformed query.
    expect(url).toBe('/chatbot/history?session_id=s%201%2F2')
    expect(opts?.signal).toBe(controller.signal)
  })

  it('getChatHistory leaves a plain id untouched (encode is a no-op for safe chars)', async () => {
    mockedRequest.mockResolvedValueOnce([])
    await getChatHistory('s_1')
    expect(call()[0]).toBe('/chatbot/history?session_id=s_1')
  })

  it('getChatSessions GETs the sessions list and threads the abort signal', async () => {
    mockedRequest.mockResolvedValueOnce([])
    const controller = new AbortController()
    await getChatSessions({ signal: controller.signal })
    const [url, opts] = call()
    expect(url).toBe('/chatbot/sessions')
    expect(opts?.signal).toBe(controller.signal)
  })

  it('renameChatSession PATCHes the encoded session path with the new title', async () => {
    mockedRequest.mockResolvedValueOnce({ id: 'a/b', title: 'New' })
    await renameChatSession('a/b', 'New')
    const [url, opts] = call()
    expect(url).toBe('/chatbot/sessions/a%2Fb')
    expect(opts?.method).toBe('PATCH')
    expect(JSON.parse(opts?.body as string)).toEqual({ title: 'New' })
  })

  it('deleteChatSession DELETEs the encoded session path', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    await deleteChatSession('a/b')
    const [url, opts] = call()
    expect(url).toBe('/chatbot/sessions/a%2Fb')
    expect(opts?.method).toBe('DELETE')
  })
})
