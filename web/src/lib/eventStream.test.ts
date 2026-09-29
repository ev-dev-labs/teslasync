import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventStream } from './eventStream'
import { setServerConnection } from './serverConnection'

class StubEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  url: string
  init: unknown
  constructor(url: string, init?: unknown) {
    this.url = url
    this.init = init
  }
}

function sseResponse(frames: string, status = 200): Response {
  return new Response(new TextEncoder().encode(frames), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.stubGlobal('EventSource', StubEventSource)
})

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createEventStream', () => {
  it('uses native EventSource with the relative URL in same-origin mode', () => {
    const source = createEventStream('/api/v1/events')
    expect(source).toBeInstanceOf(StubEventSource)
    expect((source as unknown as StubEventSource).url).toBe('/api/v1/events')
  })

  it('uses native EventSource with an absolute URL when a server is saved without token', () => {
    setServerConnection('https://srv.example.com', null)
    const source = createEventStream('/api/v1/events', { withCredentials: true })
    expect(source).toBeInstanceOf(StubEventSource)
    expect((source as unknown as StubEventSource).url).toBe('https://srv.example.com/api/v1/events')
  })

  it('dispatches named events over fetch when a token is stored', async () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse(':welcome\n\nevent: signal_change\ndata: {"vehicle_id":7}\n\n'),
    )
    vi.stubGlobal('fetch', fetchMock)

    const source = createEventStream('/api/v1/events')
    const seen: Array<{ type: string; data: string }> = []
    source.addEventListener('signal_change', (ev) => {
      seen.push({ type: 'signal_change', data: (ev as MessageEvent).data })
    })
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({ type: 'signal_change', data: '{"vehicle_id":7}' })
    source.close()

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://srv.example.com/api/v1/events')
    expect(init.credentials).toBe('omit')
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer ts_test_secret')
    expect(headers.get('Accept')).toBe('text/event-stream')
  })

  it('joins multi-line data frames', async () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      sseResponse('event: note\ndata: line1\ndata: line2\n\n'),
    ))
    const source = createEventStream('/api/v1/events')
    const seen: string[] = []
    source.addEventListener('note', (ev) => seen.push((ev as MessageEvent).data))
    await vi.waitFor(() => expect(seen).toEqual(['line1\nline2']))
    source.close()
  })

  it('fires error without reconnecting on 401', async () => {
    setServerConnection('https://srv.example.com', 'ts_test_bad')
    const fetchMock = vi.fn().mockResolvedValue(sseResponse('', 401))
    vi.stubGlobal('fetch', fetchMock)
    const source = createEventStream('/api/v1/events')
    const errors: Event[] = []
    source.addEventListener('error', (ev) => errors.push(ev as Event))
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    await tick()
    expect(fetchMock).toHaveBeenCalledOnce()
    source.close()
  })

  it('close() aborts the stream', async () => {
    setServerConnection('https://srv.example.com', 'ts_test_secret')
    let aborted = false
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        aborted = true
      })
      return new Promise(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)
    const source = createEventStream('/api/v1/events')
    await tick()
    source.close()
    expect(aborted).toBe(true)
  })
})
