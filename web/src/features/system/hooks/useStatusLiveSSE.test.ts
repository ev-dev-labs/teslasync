/**
 * Unit tests for useStatusLiveSSE + parseStatusSnapshot.
 *
 * Covers every runtime export of the module:
 *   - parseStatusSnapshot — the pure guard that turns a raw `status` frame
 *     body into a snapshot (or null) and, critically, refuses to let a
 *     valid-JSON-but-non-object frame (`null`, a number, an array) blank the
 *     last good snapshot.
 *   - useStatusLiveSSE — the full connection lifecycle: connect/credentials,
 *     custom endpoint, disabled short-circuit, open/status/heartbeat/error
 *     transitions, exponential backoff with the 30s cap, manual reconnect,
 *     unmount cleanup, and visibility-driven recovery after a construction
 *     failure.
 *
 * The EventSource transport is faked with a real EventTarget subclass so the
 * hook's `addEventListener('status'|'open'|'heartbeat'|'error', …)` wiring is
 * exercised end-to-end. No real network is opened.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import {
  useStatusLiveSSE,
  parseStatusSnapshot,
  type StatusV1Snapshot,
} from './useStatusLiveSSE'

// --- Controllable EventSource fake ------------------------------------------
class FakeEventSource extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  static instances: FakeEventSource[] = []
  /** When set, the next construction throws (simulates a blocked connect). */
  static failNextConstruction = false

  url: string
  withCredentials: boolean
  readyState: number = FakeEventSource.CONNECTING

  constructor(url: string, init?: EventSourceInit) {
    super()
    this.url = url
    this.withCredentials = init?.withCredentials ?? false
    if (FakeEventSource.failNextConstruction) {
      FakeEventSource.failNextConstruction = false
      throw new Error('EventSource construction blocked by test')
    }
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }

  // ---- test drivers ----
  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN
    this.dispatchEvent(new Event('open'))
  }

  emitStatus(data: string): void {
    this.dispatchEvent(new MessageEvent('status', { data }))
  }

  emitHeartbeat(): void {
    this.dispatchEvent(new Event('heartbeat'))
  }

  emitError(readyState: number = FakeEventSource.CLOSED): void {
    this.readyState = readyState
    this.dispatchEvent(new Event('error'))
  }
}

function latest(): FakeEventSource {
  const arr = FakeEventSource.instances
  const last = arr[arr.length - 1]
  if (!last) throw new Error('no EventSource instance was created')
  return last
}

const SNAPSHOT: StatusV1Snapshot = {
  status: 'operational',
  generated_at: '2026-07-06T00:00:00Z',
  version: { build: 'abc123', go_version: 'go1.25', started_at: '2026-07-05T00:00:00Z' },
  components: [
    { name: 'database', status: 'healthy', consecutive_failures: 0, last_check_at: '2026-07-06T00:00:00Z' },
  ],
  resources: { goroutines: 42, uptime_seconds: 3600, go_version: 'go1.25' },
  counts: { components_total: 1, components_healthy: 1, components_degraded: 0, components_unhealthy: 0 },
}

beforeEach(() => {
  FakeEventSource.instances = []
  FakeEventSource.failNextConstruction = false
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
describe('parseStatusSnapshot', () => {
  it('parses a well-formed snapshot frame into an object', () => {
    const out = parseStatusSnapshot(JSON.stringify(SNAPSHOT))
    expect(out).toEqual(SNAPSHOT)
    expect(out?.status).toBe('operational')
  })

  it('returns null for malformed (non-JSON) input rather than throwing', () => {
    expect(parseStatusSnapshot('not-json{{')).toBeNull()
    expect(parseStatusSnapshot('')).toBeNull()
  })

  it('returns null for valid JSON that is not a snapshot object', () => {
    // `JSON.parse` does NOT throw for any of these — the guard must.
    expect(parseStatusSnapshot('null')).toBeNull()
    expect(parseStatusSnapshot('42')).toBeNull()
    expect(parseStatusSnapshot('"a string"')).toBeNull()
    expect(parseStatusSnapshot('[1, 2, 3]')).toBeNull()
    expect(parseStatusSnapshot('true')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
describe('useStatusLiveSSE', () => {
  it('opens a credentialed SSE connection to the default endpoint on mount', () => {
    const { result } = renderHook(() => useStatusLiveSSE())

    expect(FakeEventSource.instances).toHaveLength(1)
    expect(latest().url).toBe('/api/v1/status/live')
    expect(latest().withCredentials).toBe(true)
    // Nothing has opened yet, so the pump reports the interim state.
    expect(result.current.state).toBe('reconnecting')
    expect(result.current.snapshot).toBeNull()
    expect(result.current.lastUpdateAt).toBeNull()
  })

  it('honours a custom endpoint option', () => {
    renderHook(() => useStatusLiveSSE({ endpoint: '/internal/status/live' }))
    expect(latest().url).toBe('/internal/status/live')
  })

  it('does not open a connection and reports offline when disabled', () => {
    const { result } = renderHook(() => useStatusLiveSSE({ enabled: false }))
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(result.current.state).toBe('offline')
  })

  it('transitions to live when the stream opens', () => {
    const { result } = renderHook(() => useStatusLiveSSE())
    act(() => latest().emitOpen())
    expect(result.current.state).toBe('live')
  })

  it('parses a status frame into a snapshot and stamps lastUpdateAt', () => {
    const { result } = renderHook(() => useStatusLiveSSE())

    act(() => latest().emitStatus(JSON.stringify(SNAPSHOT)))

    expect(result.current.snapshot).toEqual(SNAPSHOT)
    expect(result.current.state).toBe('live')
    expect(typeof result.current.lastUpdateAt).toBe('number')
    expect(result.current.lastUpdateAt).not.toBeNull()
  })

  it('keeps the prior snapshot when a malformed (non-JSON) frame arrives', () => {
    const { result } = renderHook(() => useStatusLiveSSE())

    act(() => latest().emitStatus(JSON.stringify(SNAPSHOT)))
    expect(result.current.snapshot).toEqual(SNAPSHOT)

    act(() => latest().emitStatus('this is not json'))
    // Snapshot is untouched and the pump stays live.
    expect(result.current.snapshot).toEqual(SNAPSHOT)
    expect(result.current.state).toBe('live')
  })

  it('ignores a valid-JSON-but-non-object frame instead of blanking the snapshot', () => {
    const { result } = renderHook(() => useStatusLiveSSE())

    act(() => latest().emitStatus(JSON.stringify(SNAPSHOT)))
    expect(result.current.snapshot).toEqual(SNAPSHOT)

    // A stray `data: null` (or number/array) frame must NOT overwrite the
    // last good snapshot — this is the regression the guard protects against.
    act(() => {
      latest().emitStatus('null')
      latest().emitStatus('123')
      latest().emitStatus('[]')
    })

    expect(result.current.snapshot).toEqual(SNAPSHOT)
    expect(result.current.snapshot).not.toBeNull()
  })

  it('treats a heartbeat frame as proof the stream is live', () => {
    const { result } = renderHook(() => useStatusLiveSSE())
    expect(result.current.state).toBe('reconnecting')

    act(() => latest().emitHeartbeat())
    expect(result.current.state).toBe('live')
  })

  it('shows reconnecting on a transient error that leaves the socket open', () => {
    const { result } = renderHook(() => useStatusLiveSSE())
    act(() => latest().emitOpen())
    expect(result.current.state).toBe('live')

    // Browser is auto-retrying (readyState CONNECTING, not CLOSED): the hook
    // must not schedule its own reconnect.
    act(() => latest().emitError(FakeEventSource.CONNECTING))
    expect(result.current.state).toBe('reconnecting')

    act(() => vi.advanceTimersByTime(60_000))
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('goes offline and reconnects after the socket closes', () => {
    const { result } = renderHook(() => useStatusLiveSSE())

    act(() => latest().emitError(FakeEventSource.CLOSED))
    expect(result.current.state).toBe('offline')

    // Backoff base is 1s: just short of it, nothing happens.
    act(() => vi.advanceTimersByTime(999))
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => vi.advanceTimersByTime(1))
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('backs off exponentially and caps the delay at 30s', () => {
    renderHook(() => useStatusLiveSSE())

    // Consecutive closed errors with no successful open in between: the delay
    // doubles each time and saturates at 30s (would be 32s uncapped on #6).
    const delays = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000]
    for (const delay of delays) {
      act(() => latest().emitError(FakeEventSource.CLOSED))
      const before = FakeEventSource.instances.length

      act(() => vi.advanceTimersByTime(delay - 1))
      expect(FakeEventSource.instances).toHaveLength(before)

      act(() => vi.advanceTimersByTime(1))
      expect(FakeEventSource.instances).toHaveLength(before + 1)
    }
  })

  it('reconnect() cancels the pending backoff and resets the delay', () => {
    const { result } = renderHook(() => useStatusLiveSSE())

    act(() => latest().emitError(FakeEventSource.CLOSED))
    expect(FakeEventSource.instances).toHaveLength(1)

    // Immediate reconnect — a fresh source without advancing the clock.
    act(() => result.current.reconnect())
    expect(FakeEventSource.instances).toHaveLength(2)

    // The originally-scheduled 1s backoff timer was cleared, so time passing
    // does not spawn an extra connection.
    act(() => vi.advanceTimersByTime(30_000))
    expect(FakeEventSource.instances).toHaveLength(2)

    // Retry counter was reset: the next closed error backs off from 1s again.
    act(() => latest().emitError(FakeEventSource.CLOSED))
    act(() => vi.advanceTimersByTime(999))
    expect(FakeEventSource.instances).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1))
    expect(FakeEventSource.instances).toHaveLength(3)
  })

  it('closes the active EventSource on unmount', () => {
    const { unmount } = renderHook(() => useStatusLiveSSE())
    const source = latest()

    act(() => source.emitOpen())
    expect(source.readyState).toBe(FakeEventSource.OPEN)

    unmount()
    expect(source.readyState).toBe(FakeEventSource.CLOSED)
  })

  it('cancels a pending reconnect on unmount', () => {
    const { unmount } = renderHook(() => useStatusLiveSSE())

    // A closed error schedules a reconnect timer.
    act(() => latest().emitError(FakeEventSource.CLOSED))
    expect(FakeEventSource.instances).toHaveLength(1)

    unmount()

    // The scheduled reconnect must not fire after teardown.
    act(() => vi.advanceTimersByTime(60_000))
    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it('recovers via visibilitychange when the initial connection cannot be constructed', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })

    FakeEventSource.failNextConstruction = true
    const { result } = renderHook(() => useStatusLiveSSE())

    // Construction threw, so no source exists and the pump is offline.
    expect(FakeEventSource.instances).toHaveLength(0)
    expect(result.current.state).toBe('offline')

    // Returning to the foreground triggers a fresh connect.
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => latest().emitOpen())
    expect(result.current.state).toBe('live')
  })

  it('returns a referentially stable reconnect callback across re-renders', () => {
    const { result, rerender } = renderHook(() => useStatusLiveSSE())
    const first = result.current.reconnect

    rerender()
    expect(result.current.reconnect).toBe(first)
  })
})
