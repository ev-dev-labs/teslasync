import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveConnection } from '../useLiveConnection'

// Controllable fake of the singleton sseManager. Each hook test resets the
// internal state so behavior is deterministic across tests.
type Listener = (data: unknown) => void
const listeners = new Map<string, Set<Listener>>()
let mockState: 'connected' | 'reconnecting' = 'reconnecting'
let mockLastMessageAt: number | null = null
let mockHasEverConnected = false

vi.mock('../../lib/sseManager', () => {
  return {
    sseManager: {
      subscribe: (event: string, listener: Listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(listener)
      },
      unsubscribe: (event: string, listener: Listener) => {
        listeners.get(event)?.delete(listener)
      },
      getState: () => mockState,
      getLastMessageAt: () => mockLastMessageAt,
      hasEverConnected: () => mockHasEverConnected,
      connect: () => {},
      disconnect: () => {},
    },
  }
})

function fire(event: string, data?: unknown) {
  const subs = listeners.get(event)
  if (!subs) return
  for (const fn of subs) fn(data)
}

describe('useLiveConnection', () => {
  beforeEach(() => {
    listeners.clear()
    mockState = 'reconnecting'
    mockLastMessageAt = null
    mockHasEverConnected = false
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "unknown" when no connected event has ever been observed', () => {
    const { result } = renderHook(() => useLiveConnection())
    expect(result.current.status).toBe('unknown')
    expect(result.current.channels.sse).toBe('closed')
    expect(result.current.lastMessageAt).toBeNull()
  })

  it('returns "connected" after a connected event fires', () => {
    const { result } = renderHook(() => useLiveConnection())
    act(() => {
      mockState = 'connected'
      mockLastMessageAt = Date.now()
      mockHasEverConnected = true
      fire('connected', { client_id: 'sse-1' })
    })
    expect(result.current.status).toBe('connected')
    expect(result.current.channels.sse).toBe('open')
    expect(result.current.lastMessageAt).not.toBeNull()
  })

  it('shows "reconnecting" within the grace window after disconnect', () => {
    const { result } = renderHook(() => useLiveConnection())
    // First establish a baseline connection so we are not "unknown"
    act(() => {
      mockState = 'connected'
      mockHasEverConnected = true
      mockLastMessageAt = Date.now()
      fire('connected', {})
    })
    expect(result.current.status).toBe('connected')

    // Now drop the wire — should immediately show 'reconnecting'
    act(() => {
      mockState = 'reconnecting'
      fire('disconnected')
    })
    expect(result.current.status).toBe('reconnecting')
    expect(result.current.channels.sse).toBe('closed')
  })

  it('promotes "reconnecting" to "disconnected" after the 10s grace expires', () => {
    const { result } = renderHook(() => useLiveConnection())
    act(() => {
      mockState = 'connected'
      mockHasEverConnected = true
      fire('connected', {})
    })
    act(() => {
      mockState = 'reconnecting'
      fire('disconnected')
    })
    expect(result.current.status).toBe('reconnecting')

    // Advance past the 10s grace window
    act(() => {
      vi.advanceTimersByTime(11_000)
    })
    expect(result.current.status).toBe('disconnected')
    expect(result.current.channels.sse).toBe('error')
  })

  it('returns to "connected" after successful reconnect', () => {
    const { result } = renderHook(() => useLiveConnection())
    act(() => {
      mockState = 'connected'
      mockHasEverConnected = true
      fire('connected', {})
    })
    act(() => {
      mockState = 'reconnecting'
      fire('disconnected')
    })
    act(() => {
      vi.advanceTimersByTime(11_000)
    })
    expect(result.current.status).toBe('disconnected')

    act(() => {
      mockState = 'connected'
      mockLastMessageAt = Date.now()
      fire('connected', {})
    })
    expect(result.current.status).toBe('connected')
  })

  it('updates lastMessageAt on heartbeat events', () => {
    const { result } = renderHook(() => useLiveConnection())
    act(() => {
      mockState = 'connected'
      mockHasEverConnected = true
      mockLastMessageAt = Date.now()
      fire('connected', {})
    })
    const initial = result.current.lastMessageAt

    act(() => {
      vi.advanceTimersByTime(35_000)
      mockLastMessageAt = Date.now()
      fire('heartbeat', { time: new Date().toISOString() })
    })
    expect(result.current.lastMessageAt).not.toBe(initial)
    expect(result.current.lastMessageAt).not.toBeNull()
  })

  it('subscribes on mount and unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useLiveConnection())
    expect(listeners.get('connected')?.size).toBe(1)
    expect(listeners.get('disconnected')?.size).toBe(1)
    expect(listeners.get('heartbeat')?.size).toBe(1)
    unmount()
    expect(listeners.get('connected')?.size).toBe(0)
    expect(listeners.get('disconnected')?.size).toBe(0)
    expect(listeners.get('heartbeat')?.size).toBe(0)
  })
})
