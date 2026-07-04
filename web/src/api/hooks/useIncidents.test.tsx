// Incidents client + React Query hook coverage.
//
// Covers EVERY export of useIncidents.ts:
//   - The six client functions (listIncidents / getIncident / createIncident /
//     patchIncident / appendIncidentUpdate / deleteIncident): URL shaping,
//     query-string encoding, HTTP verb, JSON body, and AbortSignal threading.
//   - The six hooks: success/empty/error surfacing, the disabled-query guard
//     for null / non-positive ids, list null-safety normalization, and the
//     cache invalidation contract shared by all four mutations.
//
// Network is mocked at the `@/api/client` boundary (the repo convention for
// hook tests) so nothing ever hits the wire.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request } from '@/api/client'
import {
  listIncidents,
  getIncident,
  createIncident,
  patchIncident,
  appendIncidentUpdate,
  deleteIncident,
  useIncidents,
  useIncident,
  useCreateIncident,
  usePatchIncident,
  useAppendIncidentUpdate,
  useDeleteIncident,
  type Incident,
  type IncidentListResponse,
  type CreateIncidentPayload,
} from './useIncidents'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 1,
    title: 'Wall connector restart',
    description: 'MQTT drop on the edge broker',
    severity: 'major',
    status: 'investigating',
    source: 'manual',
    affected_components: ['tesla', 'telemetry'],
    updates: [
      { at: '2025-06-01T10:00:00Z', status: 'investigating', message: 'Looking into it', author: 'operator' },
    ],
    started_at: '2025-06-01T10:00:00Z',
    created_at: '2025-06-01T10:00:00Z',
    updated_at: '2025-06-01T10:05:00Z',
    ...overrides,
  }
}

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { wrapper, qc }
}

/** Reads the [url, options] of the Nth `request` call with test-friendly types. */
function callArgs(n = 0): [string, RequestInit] {
  const [url, opts] = mockedRequest.mock.calls[n]
  return [url as string, (opts ?? {}) as RequestInit]
}

beforeEach(() => {
  mockedRequest.mockReset()
})

// ── Client functions ───────────────────────────────────────────────

describe('listIncidents (URL + query-string building)', () => {
  it('requests the bare collection with no query string and threads the abort signal', async () => {
    mockedRequest.mockResolvedValueOnce({ incidents: [], count: 0 })
    const controller = new AbortController()
    await listIncidents({}, { signal: controller.signal })
    expect(mockedRequest).toHaveBeenCalledTimes(1)
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents')
    expect(opts.signal).toBe(controller.signal)
  })

  it('encodes activeOnly as ?active=1', async () => {
    mockedRequest.mockResolvedValueOnce({ incidents: [], count: 0 })
    await listIncidents({ activeOnly: true })
    expect(callArgs()[0]).toBe('/status/incidents?active=1')
  })

  it('encodes limit and joins both params with &', async () => {
    mockedRequest.mockResolvedValueOnce({ incidents: [], count: 0 })
    await listIncidents({ activeOnly: true, limit: 5 })
    expect(callArgs()[0]).toBe('/status/incidents?active=1&limit=5')
  })

  it('omits a falsy limit of 0 from the query string', async () => {
    mockedRequest.mockResolvedValueOnce({ incidents: [], count: 0 })
    await listIncidents({ limit: 0 })
    expect(callArgs()[0]).toBe('/status/incidents')
  })

  it('never double-prefixes the path with /api/v1 (the client adds it once)', async () => {
    mockedRequest.mockResolvedValueOnce({ incidents: [], count: 0 })
    await listIncidents({ activeOnly: true, limit: 3 })
    expect(callArgs()[0]).not.toContain('/api/v1')
  })
})

describe('getIncident', () => {
  it('GETs /status/incidents/{id}, returns the row, and threads the signal', async () => {
    const inc = makeIncident({ id: 42 })
    mockedRequest.mockResolvedValueOnce(inc)
    const controller = new AbortController()
    const result = await getIncident(42, { signal: controller.signal })
    expect(result).toEqual(inc)
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents/42')
    expect(opts.signal).toBe(controller.signal)
  })
})

describe('createIncident', () => {
  it('POSTs the payload as JSON with a Content-Type header', async () => {
    const payload: CreateIncidentPayload = {
      title: 'API gateway 502s',
      severity: 'critical',
      affected_components: ['api-gateway'],
    }
    mockedRequest.mockResolvedValueOnce(makeIncident({ id: 7 }))
    await createIncident(payload)
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual(payload)
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('patchIncident', () => {
  it('PATCHes /status/incidents/{id} with a JSON body', async () => {
    mockedRequest.mockResolvedValueOnce(makeIncident({ id: 9, status: 'resolved' }))
    await patchIncident(9, { resolved: true, status: 'resolved' })
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents/9')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body as string)).toEqual({ resolved: true, status: 'resolved' })
  })
})

describe('appendIncidentUpdate', () => {
  it('POSTs /status/incidents/{id}/updates with a JSON body', async () => {
    mockedRequest.mockResolvedValueOnce(makeIncident({ id: 9 }))
    await appendIncidentUpdate(9, { message: 'Mitigation applied', status: 'monitoring' })
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents/9/updates')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ message: 'Mitigation applied', status: 'monitoring' })
  })
})

describe('deleteIncident', () => {
  it('DELETEs /status/incidents/{id}', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    await deleteIncident(4)
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents/4')
    expect(opts.method).toBe('DELETE')
  })
})

// ── Query hooks ────────────────────────────────────────────────────

describe('useIncidents', () => {
  it('fetches the active list, threads the signal, and surfaces incidents + count', async () => {
    mockedRequest.mockResolvedValueOnce({ incidents: [makeIncident({ id: 3 })], count: 1 })
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIncidents({ activeOnly: true }), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents?active=1')
    expect(opts).toHaveProperty('signal')
    expect(result.current.data?.incidents).toHaveLength(1)
    expect(result.current.data?.incidents[0].id).toBe(3)
    expect(result.current.data?.count).toBe(1)
  })

  it('normalizes a null incidents payload to an empty array (never undefined)', async () => {
    mockedRequest.mockResolvedValueOnce({ incidents: null, count: 0 } as unknown as IncidentListResponse)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIncidents(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Array.isArray(result.current.data?.incidents)).toBe(true)
    expect(result.current.data?.incidents).toEqual([])
  })

  it('derives count from the array length when the server omits count', async () => {
    mockedRequest.mockResolvedValueOnce({
      incidents: [makeIncident({ id: 1 }), makeIncident({ id: 2 })],
    } as unknown as IncidentListResponse)
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIncidents(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.count).toBe(2)
  })

  it('surfaces request failures as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIncidents(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

describe('useIncident', () => {
  it('fetches a single incident by positive id', async () => {
    mockedRequest.mockResolvedValueOnce(makeIncident({ id: 8 }))
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIncident(8), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(callArgs()[0]).toBe('/status/incidents/8')
    expect(result.current.data?.id).toBe(8)
  })

  it('stays disabled and issues no request when id is null', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIncident(null), { wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
  })

  it('stays disabled for a non-positive id of 0 (the backend would reject it with 400)', async () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useIncident(0), { wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('stays disabled for a negative id', async () => {
    const { wrapper } = makeWrapper()
    renderHook(() => useIncident(-5), { wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ── Mutation hooks (write + cache-invalidation contract) ────────────

describe('useCreateIncident', () => {
  it('POSTs the payload and invalidates the status-incidents cache on success', async () => {
    mockedRequest.mockResolvedValueOnce(makeIncident({ id: 11 }))
    const { wrapper, qc } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateIncident(), { wrapper })

    const created = await result.current.mutateAsync({ title: 'Outage' })
    expect(created.id).toBe(11)
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents')
    expect(opts.method).toBe('POST')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['status-incidents'] })
  })

  it('does NOT invalidate when the request rejects', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('rate limited'))
    const { wrapper, qc } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useCreateIncident(), { wrapper })

    await expect(result.current.mutateAsync({ title: 'x' })).rejects.toThrow('rate limited')
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('usePatchIncident', () => {
  it('PATCHes /status/incidents/{id} with the payload and invalidates', async () => {
    mockedRequest.mockResolvedValueOnce(makeIncident({ id: 5, status: 'resolved' }))
    const { wrapper, qc } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => usePatchIncident(), { wrapper })

    const updated = await result.current.mutateAsync({ id: 5, payload: { resolved: true } })
    expect(updated.status).toBe('resolved')
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents/5')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body as string)).toEqual({ resolved: true })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['status-incidents'] })
  })
})

describe('useAppendIncidentUpdate', () => {
  it('POSTs to /status/incidents/{id}/updates and invalidates', async () => {
    mockedRequest.mockResolvedValueOnce(makeIncident({ id: 9 }))
    const { wrapper, qc } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useAppendIncidentUpdate(), { wrapper })

    await result.current.mutateAsync({ id: 9, payload: { message: 'Update', status: 'monitoring' } })
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents/9/updates')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ message: 'Update', status: 'monitoring' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['status-incidents'] })
  })
})

describe('useDeleteIncident', () => {
  it('DELETEs /status/incidents/{id} and invalidates', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    const { wrapper, qc } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteIncident(), { wrapper })

    await result.current.mutateAsync(4)
    const [url, opts] = callArgs()
    expect(url).toBe('/status/incidents/4')
    expect(opts.method).toBe('DELETE')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['status-incidents'] })
  })
})
