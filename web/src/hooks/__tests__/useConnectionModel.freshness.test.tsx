/**
 * `useConnectionModel` integration coverage for the ONE property that cannot
 * be proven by testing `deriveConnectionModel` in isolation: the model must
 * actually re-derive itself as time passes.
 *
 * `deriveConnectionModel` is pure and already exhaustively covered in
 * `useConnectionModel.test.ts` — feed it a `now` and it classifies correctly.
 * That says nothing about the hook, whose derivation is memoised. Freshness is
 * a function of `now`, and nothing in the SSE stream fires when a reading
 * merely *ages*: a fleet that goes quiet emits no `vehicle_update` at all.
 *
 * So the failure mode being guarded here is a green "Live / fresh" chip that
 * never turns amber, no matter how long the fleet has been silent — the memo
 * keeps returning its cached value because none of `browserOnline`,
 * `apiStatus`, `streamStatus` or `lastTelemetryAtMs` changed. SSE heartbeats
 * re-render the component, which makes the bug *look* impossible while the
 * value is in fact frozen.
 *
 * The fix is a store-owned clock in `useTelemetryFreshness` that notifies at
 * the exact stale boundary. These tests drive the REAL hook over the REAL
 * store with fake timers and emit **zero** telemetry frames after the first
 * one, so a regression to a heartbeat-driven or event-driven clock fails here.
 *
 * Only the three non-telemetry inputs are mocked (`navigator.onLine`,
 * `/healthz`, the SSE lifecycle) — the telemetry path under test is genuine.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

type Listener = (data: unknown) => void

const listeners = new Map<string, Set<Listener>>()

function emitVehicleUpdate(payload: unknown) {
  for (const fn of [...(listeners.get('vehicle_update') ?? [])]) fn(payload)
}

/** Heartbeats are delivered on their own channel and must never count. */
function emitHeartbeat() {
  for (const fn of [...(listeners.get('heartbeat') ?? [])]) fn({})
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

// The three layers that are NOT under test here. Each has its own suite;
// pinning them keeps this file about the telemetry clock alone.
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('@/api/hooks/useApiHealth', () => ({
  useApiHealth: () => ({ status: 'ok', latencyMs: 12, lastCheckedAt: null }),
}))
vi.mock('../useLiveConnection', () => ({
  useLiveConnection: () => ({ status: 'connected', lastMessageAt: Date.now() }),
}))

import { __resetTelemetryFreshnessForTests } from '../useTelemetryFreshness'
import { TELEMETRY_STALE_AFTER_MS, useConnectionModel } from '../useConnectionModel'

const NOW = 1_700_000_000_000

describe('useConnectionModel — telemetry freshness ages without any new events', () => {
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

  it('starts unknown, never optimistically fresh, before any vehicle has reported', () => {
    const { result } = renderHook(() => useConnectionModel())
    expect(result.current.telemetry.status).toBe('unknown')
    expect(result.current.telemetry.lastTelemetryAt).toBeNull()
    expect(result.current.telemetry.ageMs).toBeNull()
    // An unproven fleet is not a broken connection.
    expect(result.current.overall).toBe('live')
  })

  it('transitions fresh → stale purely on the store clock', () => {
    const { result } = renderHook(() => useConnectionModel())

    act(() => { emitVehicleUpdate({ vehicle_id: 1, ts: new Date(NOW).toISOString() }) })
    expect(result.current.telemetry.status).toBe('fresh')
    expect(result.current.telemetry.ageMs).toBe(0)

    // No telemetry frame is emitted past this point.
    act(() => { vi.advanceTimersByTime(TELEMETRY_STALE_AFTER_MS - 1) })
    expect(result.current.telemetry.status).toBe('fresh')

    act(() => { vi.advanceTimersByTime(2) })
    expect(result.current.telemetry.status).toBe('stale')
    expect(result.current.telemetry.ageMs).toBeGreaterThan(TELEMETRY_STALE_AFTER_MS)
  })

  it('goes stale even while heartbeats keep the pipe green', () => {
    // The original defect: freshness was sourced from `lastMessageAt`, which
    // every heartbeat restamps, so a fleet that had not streamed in hours
    // rendered as `fresh` indefinitely.
    const { result } = renderHook(() => useConnectionModel())
    act(() => { emitVehicleUpdate({ vehicle_id: 1, ts: new Date(NOW).toISOString() }) })

    for (let i = 0; i < 10; i += 1) {
      act(() => {
        vi.advanceTimersByTime(TELEMETRY_STALE_AFTER_MS / 4)
        emitHeartbeat()
      })
    }

    expect(result.current.telemetry.status).toBe('stale')
    // …and the connection itself is still perfectly healthy. A sleeping car
    // must never paint the connection indicator red.
    expect(result.current.overall).toBe('live')
    expect(result.current.reason).toBe('ok')
    expect(result.current.isStreaming).toBe(true)
  })

  it('keeps the reported age growing while the fleet stays silent', () => {
    const { result } = renderHook(() => useConnectionModel())
    act(() => { emitVehicleUpdate({ vehicle_id: 1, ts: new Date(NOW).toISOString() }) })

    act(() => { vi.advanceTimersByTime(TELEMETRY_STALE_AFTER_MS * 2) })
    const firstAge = result.current.telemetry.ageMs ?? 0
    act(() => { vi.advanceTimersByTime(TELEMETRY_STALE_AFTER_MS * 2) })
    const secondAge = result.current.telemetry.ageMs ?? 0

    expect(secondAge).toBeGreaterThan(firstAge)
    // The reported instant never moves — only its age does.
    expect(result.current.telemetry.lastTelemetryAt).toBe(new Date(NOW).toISOString())
  })

  it('returns to fresh on the next real frame after a long silence', () => {
    const { result } = renderHook(() => useConnectionModel())
    act(() => { emitVehicleUpdate({ vehicle_id: 1, ts: new Date(NOW).toISOString() }) })
    act(() => { vi.advanceTimersByTime(TELEMETRY_STALE_AFTER_MS * 5) })
    expect(result.current.telemetry.status).toBe('stale')

    act(() => {
      emitVehicleUpdate({ vehicle_id: 1, ts: new Date(Date.now()).toISOString() })
    })
    expect(result.current.telemetry.status).toBe('fresh')
    expect(result.current.telemetry.ageMs).toBe(0)
  })

  it('reports fleet scope so no consumer can read it as the selected vehicle', () => {
    const { result } = renderHook(() => useConnectionModel())
    act(() => { emitVehicleUpdate({ vehicle_id: 9, ts: new Date(NOW).toISOString() }) })
    expect(result.current.telemetry.scope).toBe('fleet')
  })
})
