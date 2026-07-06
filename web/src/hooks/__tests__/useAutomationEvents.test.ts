import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { useAutomationEvents } from '../useAutomationEvents'
import type {
  AutomationSSEEventType,
  AutomationTriggeredEvent,
  AutomationSucceededEvent,
  AutomationFailedEvent,
  AutomationSkippedEvent,
  AutomationStateChangedEvent,
} from '@/api/types'

type SSEData =
  | AutomationTriggeredEvent
  | AutomationSucceededEvent
  | AutomationFailedEvent
  | AutomationSkippedEvent
  | AutomationStateChangedEvent
type SSEListener = (type: AutomationSSEEventType, data: SSEData) => void
type ConnListener = () => void

// Controllable in-memory fake of the `automationSSE` singleton. Prefixed
// with `mock` so vitest's hoisted `vi.mock` factory may safely reference
// them. Each test resets the registries + state in `beforeEach` so the
// singleton behaves deterministically.
const mockEventListeners = new Set<SSEListener>()
const mockConnectListeners = new Set<ConnListener>()
const mockDisconnectListeners = new Set<ConnListener>()
let mockState: 'connected' | 'reconnecting' = 'reconnecting'

vi.mock('../../lib/automationSSE', () => ({
  automationSSE: {
    subscribe: (l: SSEListener) => {
      mockEventListeners.add(l)
    },
    unsubscribe: (l: SSEListener) => {
      mockEventListeners.delete(l)
    },
    onConnect: (l: ConnListener) => {
      mockConnectListeners.add(l)
    },
    offConnect: (l: ConnListener) => {
      mockConnectListeners.delete(l)
    },
    onDisconnect: (l: ConnListener) => {
      mockDisconnectListeners.add(l)
    },
    offDisconnect: (l: ConnListener) => {
      mockDisconnectListeners.delete(l)
    },
    getState: () => mockState,
  },
}))

function emit(type: AutomationSSEEventType, data: SSEData) {
  for (const fn of mockEventListeners) fn(type, data)
}
function emitConnect() {
  for (const fn of mockConnectListeners) fn()
}
function emitDisconnect() {
  for (const fn of mockDisconnectListeners) fn()
}

// ── Typed event builders ────────────────────────────────────────────────
function triggered(id: number, mode: 'live' | 'test' = 'live'): AutomationTriggeredEvent {
  return { automation_id: id, name: `A${id}`, vehicle: 'V1', trigger: 'manual', at: 'T', mode }
}
function succeeded(id: number, mode: 'live' | 'test' = 'live'): AutomationSucceededEvent {
  return { automation_id: id, name: `A${id}`, duration_ms: 12, actions: 2, mode }
}
function failed(id: number, mode: 'live' | 'test' = 'live'): AutomationFailedEvent {
  return { automation_id: id, name: `A${id}`, error: 'boom', action_index: 0, mode }
}
function skipped(id: number, mode: 'live' | 'test' = 'live'): AutomationSkippedEvent {
  return { automation_id: id, name: `A${id}`, reason: 'condition-not-met', mode }
}
function stateChanged(id: number, mode: 'live' | 'test' = 'live'): AutomationStateChangedEvent {
  return {
    automation_id: id,
    name: `A${id}`,
    from: 'idle',
    to: 'active',
    trigger: 'schedule',
    at: 'T',
    retry_count: 0,
    consecutive_failures: 0,
    mode,
  }
}

describe('useAutomationEvents', () => {
  beforeEach(() => {
    mockEventListeners.clear()
    mockConnectListeners.clear()
    mockDisconnectListeners.clear()
    mockState = 'reconnecting'
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes to the automation stream on mount and cleans up on unmount', () => {
    const { result, unmount } = renderHook(() => useAutomationEvents())

    // Every registry got exactly one listener from this hook instance.
    expect(mockEventListeners.size).toBe(1)
    expect(mockConnectListeners.size).toBe(1)
    expect(mockDisconnectListeners.size).toBe(1)

    // The returned surface is well-typed and non-null.
    expect(Array.isArray(result.current.events)).toBe(true)
    expect(result.current.firingNow).toBeInstanceOf(Set)
    expect(typeof result.current.clearEvents).toBe('function')

    unmount()
    expect(mockEventListeners.size).toBe(0)
    expect(mockConnectListeners.size).toBe(0)
    expect(mockDisconnectListeners.size).toBe(0)
  })

  it('does not subscribe to the stream when disabled', () => {
    const { result } = renderHook(() => useAutomationEvents({ enabled: false }))

    expect(mockEventListeners.size).toBe(0)
    expect(mockConnectListeners.size).toBe(0)
    expect(mockDisconnectListeners.size).toBe(0)
    expect(result.current.events).toEqual([])
    expect(result.current.firingNow.size).toBe(0)
  })

  it('accumulates events newest-first with a stable typed shape', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', triggered(1))
      emit('automation.state_changed', stateChanged(2))
    })

    expect(result.current.events).toHaveLength(2)
    // Reverse-chronological: most recent event is first.
    expect(result.current.events[0].data.automation_id).toBe(2)
    expect(result.current.events[0].type).toBe('automation.state_changed')
    expect(result.current.events[1].data.automation_id).toBe(1)
    // Each event carries a generated id + receive timestamp.
    expect(result.current.events[0].id).toMatch(/^ae-\d+$/)
    expect(result.current.events[0].receivedAt).toBeInstanceOf(Date)
  })

  it('caps retained events at maxEvents, keeping the most recent', () => {
    const { result } = renderHook(() => useAutomationEvents({ maxEvents: 2 }))

    act(() => {
      emit('automation.triggered', triggered(1))
      emit('automation.triggered', triggered(2))
      emit('automation.triggered', triggered(3))
    })

    expect(result.current.events).toHaveLength(2)
    expect(result.current.events.map((e) => e.data.automation_id)).toEqual([3, 2])
  })

  it('filters events by mode when modeFilter is set', () => {
    const { result } = renderHook(() => useAutomationEvents({ modeFilter: 'live' }))

    act(() => {
      emit('automation.triggered', triggered(1, 'test')) // filtered out
      emit('automation.triggered', triggered(2, 'live')) // kept
    })

    expect(result.current.events).toHaveLength(1)
    expect(result.current.events[0].data.automation_id).toBe(2)
    expect(result.current.firingNow.has(1)).toBe(false)
    expect(result.current.firingNow.has(2)).toBe(true)
  })

  it('passes through all modes when modeFilter is null (default)', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', triggered(1, 'test'))
      emit('automation.triggered', triggered(2, 'live'))
    })

    expect(result.current.events).toHaveLength(2)
  })

  it('marks an automation as firing on triggered and auto-clears after the TTL', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', triggered(7))
    })
    expect(result.current.firingNow.has(7)).toBe(true)
    expect(result.current.firingNow.size).toBe(1)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.firingNow.has(7)).toBe(false)
    expect(result.current.firingNow.size).toBe(0)
  })

  it('clears firing state immediately on a terminal succeeded event', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', triggered(7))
    })
    expect(result.current.firingNow.has(7)).toBe(true)

    act(() => {
      emit('automation.succeeded', succeeded(7))
    })
    expect(result.current.firingNow.has(7)).toBe(false)

    // The pending 5s timer must have been cancelled — advancing time is a
    // no-op and does not throw.
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.firingNow.size).toBe(0)
  })

  it('clears firing state on failed and skipped terminal events independently', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', triggered(1))
      emit('automation.triggered', triggered(2))
    })
    expect(result.current.firingNow.size).toBe(2)

    act(() => {
      emit('automation.failed', failed(1))
    })
    expect(result.current.firingNow.has(1)).toBe(false)
    expect(result.current.firingNow.has(2)).toBe(true)

    act(() => {
      emit('automation.skipped', skipped(2))
    })
    expect(result.current.firingNow.size).toBe(0)
  })

  it('resets the auto-clear timer when the same automation re-triggers', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', triggered(5))
    })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.firingNow.has(5)).toBe(true)

    // Re-trigger resets the TTL — 3s after the FIRST trigger it is still firing.
    act(() => {
      emit('automation.triggered', triggered(5))
    })
    act(() => {
      vi.advanceTimersByTime(3000) // 6s since first, 3s since second
    })
    expect(result.current.firingNow.has(5)).toBe(true)

    act(() => {
      vi.advanceTimersByTime(2000) // 5s since second trigger
    })
    expect(result.current.firingNow.has(5)).toBe(false)
  })

  it('ignores triggered events with a non-numeric automation_id', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', {
        ...triggered(1),
        automation_id: undefined as unknown as number,
      })
    })

    // The event is still recorded in history, but no firing indicator is set
    // and no orphan timer is registered.
    expect(result.current.events).toHaveLength(1)
    expect(result.current.firingNow.size).toBe(0)
  })

  it('initializes connectionState from the client getState', () => {
    mockState = 'connected'
    const { result } = renderHook(() => useAutomationEvents())
    expect(result.current.connectionState).toBe('connected')
  })

  it('reflects connect and disconnect transitions from the SSE client', () => {
    const { result } = renderHook(() => useAutomationEvents())
    expect(result.current.connectionState).toBe('reconnecting')

    act(() => {
      emitConnect()
    })
    expect(result.current.connectionState).toBe('connected')

    // Regression: a disconnect must flip the indicator back to reconnecting.
    act(() => {
      emitDisconnect()
    })
    expect(result.current.connectionState).toBe('reconnecting')
  })

  it('clearEvents empties the event history', () => {
    const { result } = renderHook(() => useAutomationEvents())

    act(() => {
      emit('automation.triggered', triggered(1))
    })
    expect(result.current.events).toHaveLength(1)

    act(() => {
      result.current.clearEvents()
    })
    expect(result.current.events).toHaveLength(0)
  })

  it('resets firing indicators when the modeFilter changes', () => {
    const { result, rerender } = renderHook(
      (props: { modeFilter: 'live' | 'test' | null }) => useAutomationEvents(props),
      { initialProps: { modeFilter: 'live' as 'live' | 'test' | null } },
    )

    act(() => {
      emit('automation.triggered', triggered(9, 'live'))
    })
    expect(result.current.firingNow.has(9)).toBe(true)

    // Re-subscribing under a new filter must drain the stranded indicator —
    // its auto-clear timer was disposed by the previous subscription cleanup.
    act(() => {
      rerender({ modeFilter: 'test' })
    })
    expect(result.current.firingNow.size).toBe(0)

    // The old timer is gone: advancing time neither throws nor mutates state.
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(result.current.firingNow.size).toBe(0)

    // The new filter is active — a matching test-mode event fires normally.
    act(() => {
      emit('automation.triggered', triggered(10, 'test'))
    })
    expect(result.current.firingNow.has(10)).toBe(true)
  })
})
