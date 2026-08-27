import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

type Listener = (data: unknown) => void

const listeners = new Map<string, Set<Listener>>()

function emit(event: string, data?: unknown) {
  for (const fn of [...(listeners.get(event) ?? [])]) fn(data)
}

function listenerCount(event: string): number {
  return listeners.get(event)?.size ?? 0
}

vi.mock('@/lib/sseManager', () => ({
  sseManager: {
    subscribe: (event: string, fn: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    unsubscribe: (event: string, fn: Listener) => {
      listeners.get(event)?.delete(fn)
    },
    getState: () => 'connected' as const,
    getLastMessageAt: () => Date.now(),
    hasEverConnected: () => true,
    connect: () => {},
    disconnect: () => {},
  },
}))

import {
  MAX_TELEMETRY_CLOCK_SKEW_MS,
  __resetTelemetryFreshnessForTests,
  extractTelemetryTimestamp,
  useFleetLastTelemetryAt,
  useFleetLastTelemetryAtIso,
} from '../useTelemetryFreshness'

const NOW = 1_700_000_000_000

describe('extractTelemetryTimestamp', () => {
  it('prefers the payload ts so queueing / cross-pod delay stays visible', () => {
    const payloadTs = new Date(NOW - 30_000).toISOString()
    expect(extractTelemetryTimestamp({ vehicle_id: 1, ts: payloadTs }, NOW)).toBe(NOW - 30_000)
  })

  it('accepts the alternative timestamp key names the backend has used', () => {
    for (const key of ['ts', 'timestamp', 'updated_at', 'last_updated']) {
      expect(
        extractTelemetryTimestamp({ [key]: new Date(NOW - 5_000).toISOString() }, NOW),
      ).toBe(NOW - 5_000)
    }
  })

  it('accepts a numeric epoch-ms timestamp', () => {
    expect(extractTelemetryTimestamp({ ts: NOW - 1_000 }, NOW)).toBe(NOW - 1_000)
  })

  it('falls back to receipt time when the payload carries no timestamp', () => {
    expect(extractTelemetryTimestamp({ vehicle_id: 1, signals: {} }, NOW)).toBe(NOW)
  })

  it('falls back to receipt time for an unparseable timestamp', () => {
    expect(extractTelemetryTimestamp({ ts: 'not-a-date' }, NOW)).toBe(NOW)
    expect(extractTelemetryTimestamp({ ts: '' }, NOW)).toBe(NOW)
    expect(extractTelemetryTimestamp({ ts: Number.NaN }, NOW)).toBe(NOW)
    expect(extractTelemetryTimestamp({ ts: {} }, NOW)).toBe(NOW)
  })

  it('rejects an implausibly old timestamp instead of reporting decades of staleness', () => {
    // Epoch seconds mistakenly serialised as ms, or a zero-value time.Time.
    expect(extractTelemetryTimestamp({ ts: 0 }, NOW)).toBe(NOW)
    expect(extractTelemetryTimestamp({ ts: 1_700_000 }, NOW)).toBe(NOW)
    expect(extractTelemetryTimestamp({ ts: '0001-01-01T00:00:00Z' }, NOW)).toBe(NOW)
  })

  it('rejects a future timestamp beyond the skew allowance', () => {
    expect(extractTelemetryTimestamp({ ts: NOW + MAX_TELEMETRY_CLOCK_SKEW_MS + 1 }, NOW)).toBe(NOW)
    // Inside the allowance it is trusted (minor clock drift is normal).
    expect(extractTelemetryTimestamp({ ts: NOW + 1_000 }, NOW)).toBe(NOW + 1_000)
  })

  it('falls back to receipt time for a non-object payload', () => {
    expect(extractTelemetryTimestamp(null, NOW)).toBe(NOW)
    expect(extractTelemetryTimestamp('nope', NOW)).toBe(NOW)
    expect(extractTelemetryTimestamp([{ ts: NOW }], NOW)).toBe(NOW)
  })
})

describe('useFleetLastTelemetryAt — heartbeats must never count as telemetry', () => {
  beforeEach(() => {
    __resetTelemetryFreshnessForTests()
    listeners.clear()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    __resetTelemetryFreshnessForTests()
    vi.useRealTimers()
  })

  it('starts unknown rather than claiming freshness at first paint', () => {
    const { result } = renderHook(() => useFleetLastTelemetryAt())
    expect(result.current).toBeNull()
  })

  it('advances on a vehicle_update', () => {
    const { result } = renderHook(() => useFleetLastTelemetryAt())
    act(() => { emit('vehicle_update', { vehicle_id: 1, ts: new Date(NOW - 2_000).toISOString() }) })
    expect(result.current).toBe(NOW - 2_000)
  })

  it('does NOT advance on heartbeat / connected / alert frames', () => {
    // This is the review finding: sseManager stamps lastMessageAt for all of
    // these, so sourcing freshness from it reported a silent fleet as fresh.
    const { result } = renderHook(() => useFleetLastTelemetryAt())

    act(() => {
      emit('heartbeat', {})
      emit('connected', {})
      emit('alert', { id: 1 })
      emit('export_status', { id: 2 })
      emit('achievement_unlocked', { id: 3 })
    })

    expect(result.current).toBeNull()
  })

  it('keeps reporting the last vehicle_update instant while heartbeats continue', () => {
    const { result } = renderHook(() => useFleetLastTelemetryAt())

    act(() => { emit('vehicle_update', { ts: new Date(NOW - 600_000).toISOString() }) })
    expect(result.current).toBe(NOW - 600_000)

    // Ten minutes of heartbeats later, telemetry is still ten minutes old.
    act(() => {
      emit('heartbeat', {})
      emit('heartbeat', {})
      emit('heartbeat', {})
    })
    expect(result.current).toBe(NOW - 600_000)
  })

  it('subscribes exactly once for many consumers and unsubscribes on last unmount', () => {
    const a = renderHook(() => useFleetLastTelemetryAt())
    const b = renderHook(() => useFleetLastTelemetryAt())
    expect(listenerCount('vehicle_update')).toBe(1)

    a.unmount()
    expect(listenerCount('vehicle_update')).toBe(1)
    b.unmount()
    expect(listenerCount('vehicle_update')).toBe(0)
  })

  it('exposes an ISO form for rendering', () => {
    const { result } = renderHook(() => useFleetLastTelemetryAtIso())
    expect(result.current).toBeNull()
    act(() => { emit('vehicle_update', { ts: new Date(NOW - 1_000).toISOString() }) })
    expect(result.current).toBe(new Date(NOW - 1_000).toISOString())
  })
})

describe('useFleetLastTelemetryAt — monotonic high-water mark across vehicles', () => {
  beforeEach(() => {
    __resetTelemetryFreshnessForTests()
    listeners.clear()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    __resetTelemetryFreshnessForTests()
    vi.useRealTimers()
  })

  it('does not regress when a queued OLDER frame for another vehicle arrives late', () => {
    // Redis fan-out, per-vehicle MQTT queue depth and multi-pod publishing all
    // reorder freely. Storing last-seen would flip a fresh fleet to stale
    // purely because a lagging car caught up.
    const { result } = renderHook(() => useFleetLastTelemetryAt())

    act(() => { emit('vehicle_update', { vehicle_id: 1, ts: new Date(NOW - 5_000).toISOString() }) })
    expect(result.current).toBe(NOW - 5_000)

    act(() => { emit('vehicle_update', { vehicle_id: 2, ts: new Date(NOW - 90_000).toISOString() }) })
    expect(result.current).toBe(NOW - 5_000)
  })

  it('advances when the late frame is genuinely newer', () => {
    const { result } = renderHook(() => useFleetLastTelemetryAt())

    act(() => { emit('vehicle_update', { vehicle_id: 1, ts: new Date(NOW - 90_000).toISOString() }) })
    act(() => { emit('vehicle_update', { vehicle_id: 2, ts: new Date(NOW - 5_000).toISOString() }) })
    expect(result.current).toBe(NOW - 5_000)
  })

  it('survives an arbitrarily shuffled multi-vehicle burst', () => {
    const { result } = renderHook(() => useFleetLastTelemetryAt())
    const offsets = [40_000, 5_000, 120_000, 1_000, 60_000, 300_000, 2_500]

    act(() => {
      for (const [i, offset] of offsets.entries()) {
        emit('vehicle_update', {
          vehicle_id: (i % 3) + 1,
          ts: new Date(NOW - offset).toISOString(),
        })
      }
    })

    // The newest instant in the burst wins regardless of arrival order.
    expect(result.current).toBe(NOW - 1_000)
  })

  it('never notifies subscribers for a non-advancing frame', () => {
    // A no-op re-notify would churn every consumer of the connection model.
    let renders = 0
    renderHook(() => {
      renders += 1
      return useFleetLastTelemetryAt()
    })
    const baseline = renders

    act(() => { emit('vehicle_update', { vehicle_id: 1, ts: new Date(NOW - 5_000).toISOString() }) })
    const afterAdvance = renders
    expect(afterAdvance).toBeGreaterThan(baseline)

    act(() => {
      emit('vehicle_update', { vehicle_id: 2, ts: new Date(NOW - 90_000).toISOString() })
      emit('vehicle_update', { vehicle_id: 3, ts: new Date(NOW - 5_000).toISOString() })
    })
    expect(renders).toBe(afterAdvance)
  })

  it('treats an equal-instant duplicate frame as non-advancing', () => {
    const { result } = renderHook(() => useFleetLastTelemetryAt())
    const ts = new Date(NOW - 5_000).toISOString()
    act(() => { emit('vehicle_update', { vehicle_id: 1, ts }) })
    act(() => { emit('vehicle_update', { vehicle_id: 1, ts }) })
    expect(result.current).toBe(NOW - 5_000)
  })

  it('still advances on a timestamp-less frame that arrives after an older stamped one', () => {
    // No payload ts → receipt time (NOW), which is newer than the stamped one.
    const { result } = renderHook(() => useFleetLastTelemetryAt())
    act(() => { emit('vehicle_update', { vehicle_id: 1, ts: new Date(NOW - 90_000).toISOString() }) })
    act(() => { emit('vehicle_update', { vehicle_id: 2, signals: {} }) })
    expect(result.current).toBe(NOW)
  })
})
