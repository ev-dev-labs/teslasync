import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

/**
 * useOnlineStatus contract.
 *
 * The hook is a `useSyncExternalStore` adapter over the shared
 * `lib/resilience` connection broadcaster. These tests drive a controllable
 * fake of that broadcaster so every facet is deterministic:
 *   - the initial snapshot (both online and offline),
 *   - live transitions in either direction,
 *   - fan-out to multiple mounted consumers from a single event,
 *   - subscribe-on-mount / unsubscribe-on-unmount (no listener leak),
 *   - stability across redundant same-status notifications, and
 *   - the mount-gap reconciliation that the previous useState + useEffect
 *     shape silently dropped (a flip during subscription is still observed).
 *
 * `@/lib/resilience` is partially mocked (real module spread through, only the
 * two consumed functions overridden) so the test-setup latch reset keeps
 * working against the genuine export.
 */

type Status = 'online' | 'offline'
type StatusListener = (s: Status) => void

const listeners = new Set<StatusListener>()
let currentStatus: Status = 'online'
// When set, the next `onStatusChange` call runs this hook *during* subscription
// — used to reproduce the render→commit gap where the wire flips before the
// listener is wired up.
let onSubscribe: (() => void) | null = null

const onStatusChangeSpy = vi.fn((fn: StatusListener): (() => void) => {
  listeners.add(fn)
  if (onSubscribe) {
    const run = onSubscribe
    onSubscribe = null
    run()
  }
  return () => {
    listeners.delete(fn)
  }
})

vi.mock('@/lib/resilience', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/resilience')>()
  return {
    ...actual,
    getConnectionStatus: () => currentStatus,
    onStatusChange: (fn: StatusListener) => onStatusChangeSpy(fn),
  }
})

import { useOnlineStatus } from '../useOnlineStatus'

/** Broadcast a status change exactly like the real resilience module does. */
function emit(next: Status): void {
  if (currentStatus === next) {
    // Real setStatus() early-returns on no-op; mirror that so redundant
    // notifications never fire listeners.
    return
  }
  currentStatus = next
  for (const fn of [...listeners]) fn(next)
}

/** Force-fire all listeners with the current status (a redundant broadcast). */
function reemitCurrent(): void {
  for (const fn of [...listeners]) fn(currentStatus)
}

describe('useOnlineStatus', () => {
  beforeEach(() => {
    listeners.clear()
    currentStatus = 'online'
    onSubscribe = null
    onStatusChangeSpy.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when the connection starts online', () => {
    currentStatus = 'online'
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  it('returns false when the connection starts offline', () => {
    currentStatus = 'offline'
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)
  })

  it('subscribes to the broadcaster exactly once on mount', () => {
    renderHook(() => useOnlineStatus())
    expect(onStatusChangeSpy).toHaveBeenCalledTimes(1)
    expect(listeners.size).toBe(1)
  })

  it('re-renders to false when the browser goes offline', () => {
    currentStatus = 'online'
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    act(() => {
      emit('offline')
    })
    expect(result.current).toBe(false)
  })

  it('re-renders back to true when the browser comes back online', () => {
    currentStatus = 'offline'
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)

    act(() => {
      emit('online')
    })
    expect(result.current).toBe(true)
  })

  it('tracks a full offline→online→offline cycle', () => {
    currentStatus = 'online'
    const { result } = renderHook(() => useOnlineStatus())

    act(() => emit('offline'))
    expect(result.current).toBe(false)

    act(() => emit('online'))
    expect(result.current).toBe(true)

    act(() => emit('offline'))
    expect(result.current).toBe(false)
  })

  it('fans a single status change out to every mounted consumer', () => {
    currentStatus = 'online'
    const a = renderHook(() => useOnlineStatus())
    const b = renderHook(() => useOnlineStatus())
    expect(a.result.current).toBe(true)
    expect(b.result.current).toBe(true)
    expect(listeners.size).toBe(2)

    act(() => {
      emit('offline')
    })
    expect(a.result.current).toBe(false)
    expect(b.result.current).toBe(false)
  })

  it('unsubscribes on unmount so no listener leaks', () => {
    const { unmount } = renderHook(() => useOnlineStatus())
    expect(listeners.size).toBe(1)

    unmount()
    expect(listeners.size).toBe(0)

    // A change after unmount must not throw or resurrect a stale listener.
    expect(() => emit('offline')).not.toThrow()
    expect(listeners.size).toBe(0)
  })

  it('stays stable across a redundant same-status notification', () => {
    currentStatus = 'online'
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useOnlineStatus()
    })
    const rendersAfterMount = renders
    expect(result.current).toBe(true)

    act(() => {
      // Broadcaster fires but the snapshot is unchanged — useSyncExternalStore
      // compares with Object.is and must bail out of re-rendering.
      reemitCurrent()
    })
    expect(result.current).toBe(true)
    expect(renders).toBe(rendersAfterMount)
  })

  it('reconciles a flip that happens during the render→subscribe gap', () => {
    // Snapshot read at render time sees "online"; the wire then drops in the
    // instant before the subscription is wired up. useSyncExternalStore must
    // re-read after subscribing and settle on false — the exact race the old
    // useState + useEffect implementation dropped.
    currentStatus = 'online'
    onSubscribe = () => {
      currentStatus = 'offline'
    }

    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)
  })
})
