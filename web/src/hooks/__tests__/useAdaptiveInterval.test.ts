import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdaptiveInterval } from '../useAdaptiveInterval'

// Controllable fake of the singleton sseManager (mirrors the pattern used by
// useLiveConnection.test.tsx). Each test resets the shared listener registry
// and wire state so behaviour is deterministic and isolated.
type Listener = (data: unknown) => void
const listeners = new Map<string, Set<Listener>>()
let mockState: 'connected' | 'reconnecting' = 'reconnecting'

vi.mock('../../lib/sseManager', () => ({
  sseManager: {
    subscribe: (event: string, listener: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(listener)
    },
    unsubscribe: (event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener)
    },
    getState: () => mockState,
    getLastMessageAt: () => null,
    hasEverConnected: () => false,
    connect: () => {},
    disconnect: () => {},
  },
}))

/** Dispatch an SSE event to every registered listener, like the real manager. */
function fire(event: string, data?: unknown) {
  const subs = listeners.get(event)
  if (!subs) return
  for (const fn of subs) fn(data)
}

describe('useAdaptiveInterval', () => {
  beforeEach(() => {
    listeners.clear()
    mockState = 'reconnecting'
  })

  afterEach(() => {
    listeners.clear()
  })

  it('starts at the fast cadence while the SSE pipe is reconnecting', () => {
    mockState = 'reconnecting'
    const { result } = renderHook(() => useAdaptiveInterval())
    expect(result.current).toBe(3000)
  })

  it('starts at the slow cadence when SSE is already connected on mount', () => {
    mockState = 'connected'
    const { result } = renderHook(() => useAdaptiveInterval())
    expect(result.current).toBe(30_000)
  })

  it('slows polling to the fallback cadence when a connected event fires', () => {
    mockState = 'reconnecting'
    const { result } = renderHook(() => useAdaptiveInterval())
    expect(result.current).toBe(3000)

    act(() => {
      mockState = 'connected'
      fire('connected', { client_id: 'sse-1' })
    })
    expect(result.current).toBe(30_000)
  })

  it('speeds polling back up when a disconnected event fires', () => {
    mockState = 'connected'
    const { result } = renderHook(() => useAdaptiveInterval())
    expect(result.current).toBe(30_000)

    act(() => {
      mockState = 'reconnecting'
      fire('disconnected')
    })
    expect(result.current).toBe(3000)
  })

  it('honours custom fast/slow cadences across a full transition cycle', () => {
    mockState = 'reconnecting'
    const { result } = renderHook(() => useAdaptiveInterval(1000, 60_000))
    expect(result.current).toBe(1000)

    act(() => {
      mockState = 'connected'
      fire('connected', {})
    })
    expect(result.current).toBe(60_000)

    act(() => {
      mockState = 'reconnecting'
      fire('disconnected')
    })
    expect(result.current).toBe(1000)
  })

  it('subscribes to both lifecycle events on mount and cleans up on unmount', () => {
    const { unmount } = renderHook(() => useAdaptiveInterval())
    expect(listeners.get('connected')?.size).toBe(1)
    expect(listeners.get('disconnected')?.size).toBe(1)

    unmount()
    expect(listeners.get('connected')?.size).toBe(0)
    expect(listeners.get('disconnected')?.size).toBe(0)
  })

  it('re-syncs to the current wire state when the cadence props change', () => {
    mockState = 'connected'
    const { result, rerender } = renderHook(
      ({ fast, slow }) => useAdaptiveInterval(fast, slow),
      { initialProps: { fast: 2000, slow: 40_000 } },
    )
    expect(result.current).toBe(40_000)

    // Changing the slow cadence must re-run the effect and re-read the wire
    // state, surfacing the new value rather than a stale 40s.
    rerender({ fast: 2000, slow: 45_000 })
    expect(result.current).toBe(45_000)
  })

  it('does not react to unrelated SSE events (no cross-talk)', () => {
    mockState = 'reconnecting'
    const { result } = renderHook(() => useAdaptiveInterval())
    expect(result.current).toBe(3000)

    // Only connected/disconnected drive the cadence; a heartbeat must not.
    act(() => {
      fire('heartbeat', { time: '2026-07-05T00:00:00Z' })
    })
    expect(result.current).toBe(3000)
  })

  it('repairs a non-finite fast cadence to the safe default while reconnecting', () => {
    mockState = 'reconnecting'
    const { result } = renderHook(() => useAdaptiveInterval(NaN, 50_000))
    // NaN would otherwise be forwarded to refetchInterval and break polling.
    expect(result.current).toBe(3000)

    act(() => {
      mockState = 'connected'
      fire('connected', {})
    })
    expect(result.current).toBe(50_000)
  })

  it('repairs a non-positive slow cadence to the safe default when connected', () => {
    mockState = 'connected'
    const { result } = renderHook(() => useAdaptiveInterval(2500, 0))
    // 0 (or negatives) would disable polling entirely — fall back instead.
    expect(result.current).toBe(30_000)

    act(() => {
      mockState = 'reconnecting'
      fire('disconnected')
    })
    expect(result.current).toBe(2500)
  })

  it('repairs a non-finite (Infinity) slow cadence to the safe default', () => {
    mockState = 'connected'
    const { result } = renderHook(() =>
      useAdaptiveInterval(2500, Number.POSITIVE_INFINITY),
    )
    expect(result.current).toBe(30_000)
  })
})
