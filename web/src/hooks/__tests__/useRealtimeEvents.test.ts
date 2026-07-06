import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRealtimeEvents } from '../useRealtimeEvents'

// Controllable fake of the singleton sseManager. Each test resets the internal
// listener registry + connection state so behaviour is deterministic.
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

const ALL_EVENTS = [
  'vehicle_update',
  'alert',
  'export_status',
  'achievement_unlocked',
  'connected',
  'disconnected',
] as const

function fire(event: string, data?: unknown) {
  const subs = listeners.get(event)
  if (!subs) return
  // Copy to an array so a listener that mutates the set can't disturb iteration.
  for (const fn of [...subs]) fn(data)
}

describe('useRealtimeEvents', () => {
  beforeEach(() => {
    listeners.clear()
    mockState = 'reconnecting'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('subscribes to all six channels on mount and tears them down on unmount', () => {
    const { unmount } = renderHook(() => useRealtimeEvents())
    for (const evt of ALL_EVENTS) {
      expect(listeners.get(evt)?.size).toBe(1)
    }
    unmount()
    for (const evt of ALL_EVENTS) {
      expect(listeners.get(evt)?.size ?? 0).toBe(0)
    }
  })

  it('derives the initial connection state from the shared singleton', () => {
    mockState = 'connected'
    const { result } = renderHook(() => useRealtimeEvents())
    expect(result.current.connected).toBe(true)
    expect(result.current.state).toBe('connected')
    expect(result.current.diagnostics.connected).toBe(true)
  })

  it('reports a disconnected singleton as not connected', () => {
    mockState = 'reconnecting'
    const { result } = renderHook(() => useRealtimeEvents())
    expect(result.current.connected).toBe(false)
    expect(result.current.state).toBe('reconnecting')
  })

  it('flips to connected, records lastConnected, and forwards the client id on a connected event', () => {
    const onConnected = vi.fn()
    const { result } = renderHook(() => useRealtimeEvents({ onConnected }))
    expect(result.current.diagnostics.lastConnected).toBeNull()

    act(() => {
      mockState = 'connected'
      fire('connected', { client_id: 'sse-42' })
    })

    expect(result.current.connected).toBe(true)
    expect(result.current.state).toBe('connected')
    expect(onConnected).toHaveBeenCalledWith('sse-42')
    expect(result.current.diagnostics.lastConnected).toBeInstanceOf(Date)
  })

  it('forwards an empty string when the connected payload omits a client id', () => {
    const onConnected = vi.fn()
    renderHook(() => useRealtimeEvents({ onConnected }))
    act(() => {
      fire('connected', {})
    })
    expect(onConnected).toHaveBeenCalledWith('')
  })

  it('does not throw and forwards an empty client id when the connected payload is null', () => {
    const onConnected = vi.fn()
    renderHook(() => useRealtimeEvents({ onConnected }))
    expect(() => {
      act(() => {
        fire('connected', null)
      })
    }).not.toThrow()
    expect(onConnected).toHaveBeenCalledWith('')
  })

  it('forwards payloads for each data channel to its handler', () => {
    const onVehicleUpdate = vi.fn()
    const onAlert = vi.fn()
    const onExportStatus = vi.fn()
    const onAchievementUnlocked = vi.fn()
    renderHook(() =>
      useRealtimeEvents({ onVehicleUpdate, onAlert, onExportStatus, onAchievementUnlocked }),
    )

    const vehicle = { id: 7, speed_mps: 12 }
    const alert = { severity: 'critical' }
    const exportStatus = { job_id: 'e1', status: 'done' }
    const achievement = { key: 'first_drive' }

    act(() => {
      fire('vehicle_update', vehicle)
      fire('alert', alert)
      fire('export_status', exportStatus)
      fire('achievement_unlocked', achievement)
    })

    expect(onVehicleUpdate).toHaveBeenCalledWith(vehicle)
    expect(onAlert).toHaveBeenCalledWith(alert)
    expect(onExportStatus).toHaveBeenCalledWith(exportStatus)
    expect(onAchievementUnlocked).toHaveBeenCalledWith(achievement)
  })

  it('falls back to polling when a disconnect leaves the singleton reconnecting', () => {
    const onDisconnected = vi.fn()
    const onFallbackToPolling = vi.fn()
    const { result } = renderHook(() =>
      useRealtimeEvents({ onDisconnected, onFallbackToPolling }),
    )

    act(() => {
      mockState = 'connected'
      fire('connected', { client_id: 'a' })
    })
    expect(result.current.connected).toBe(true)

    act(() => {
      mockState = 'reconnecting'
      fire('disconnected')
    })

    expect(result.current.connected).toBe(false)
    expect(result.current.state).toBe('reconnecting')
    expect(onDisconnected).toHaveBeenCalledTimes(1)
    expect(onFallbackToPolling).toHaveBeenCalledTimes(1)
  })

  it('does not fall back to polling when the singleton is still connected after a disconnect event', () => {
    const onDisconnected = vi.fn()
    const onFallbackToPolling = vi.fn()
    renderHook(() => useRealtimeEvents({ onDisconnected, onFallbackToPolling }))

    act(() => {
      // Singleton reports it is already reconnected by the time we react.
      mockState = 'connected'
      fire('disconnected')
    })

    expect(onDisconnected).toHaveBeenCalledTimes(1)
    expect(onFallbackToPolling).not.toHaveBeenCalled()
  })

  it('does not subscribe when disabled', () => {
    renderHook(() => useRealtimeEvents({ enabled: false }))
    for (const evt of ALL_EVENTS) {
      expect(listeners.get(evt)?.size ?? 0).toBe(0)
    }
  })

  it('re-syncs state from the singleton when enabled flips from false to true', () => {
    mockState = 'reconnecting'
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRealtimeEvents({ enabled }),
      { initialProps: { enabled: false } },
    )
    expect(result.current.connected).toBe(false)
    expect(listeners.get('connected')?.size ?? 0).toBe(0)

    act(() => {
      // The shared connection came up while this consumer was disabled; no fresh
      // `connected` event will fire, so the hook must re-read the singleton.
      mockState = 'connected'
      rerender({ enabled: true })
    })

    expect(result.current.connected).toBe(true)
    expect(listeners.get('connected')?.size).toBe(1)
  })

  it('invokes the latest callback identity without re-subscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ onAlert }: { onAlert: Listener }) => useRealtimeEvents({ onAlert }),
      { initialProps: { onAlert: first } },
    )

    rerender({ onAlert: second })
    // Same subscription is reused — the channel still has exactly one listener.
    expect(listeners.get('alert')?.size).toBe(1)

    act(() => {
      fire('alert', { severity: 'warning' })
    })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ severity: 'warning' })
  })

  it('exposes a stable diagnostics shape', () => {
    mockState = 'connected'
    const { result } = renderHook(() => useRealtimeEvents())
    const { diagnostics } = result.current
    expect(diagnostics.endpoint).toBe('/api/v1/events')
    expect(diagnostics.failCount).toBe(0)
    expect(diagnostics.nextRetryIn).toBeNull()
    expect(diagnostics.state).toBe('connected')
    expect(diagnostics.connected).toBe(true)
  })

  it('keeps the returned object referentially stable across renders when nothing changed', () => {
    const { result, rerender } = renderHook(
      ({ onAlert }: { onAlert: Listener }) => useRealtimeEvents({ onAlert }),
      { initialProps: { onAlert: vi.fn() } },
    )
    const beforeReturn = result.current
    const beforeDiagnostics = result.current.diagnostics

    // A new options object each render must NOT churn memoised derived values.
    rerender({ onAlert: vi.fn() })

    expect(result.current).toBe(beforeReturn)
    expect(result.current.diagnostics).toBe(beforeDiagnostics)
  })

  it('does not throw when events fire with no handlers supplied', () => {
    renderHook(() => useRealtimeEvents())
    expect(() => {
      act(() => {
        fire('vehicle_update', { id: 1 })
        fire('alert', {})
        fire('export_status', {})
        fire('achievement_unlocked', {})
        fire('connected', { client_id: 'x' })
        fire('disconnected')
      })
    }).not.toThrow()
  })
})
