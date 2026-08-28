import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { SignalChangeEvent } from '@/api/types'
import { parseSignalChangeEvent, useSignalChangeStream } from './useSSE'

// ---------------------------------------------------------------------------
// Fake EventSource
// ---------------------------------------------------------------------------
// The hook talks to the DOM `EventSource` via addEventListener /
// removeEventListener / close, so extending the real `EventTarget` gives us
// faithful listener registration + dispatch semantics (rather than a hand
// rolled listener array). Each constructed instance is recorded so a test can
// assert how many connections were opened, grab the live socket to `emit`
// events into, and verify teardown.
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = []
  readonly url: string
  readyState = 1
  closed = false

  constructor(url: string) {
    super()
    this.url = url
    FakeEventSource.instances.push(this)
  }

  emit(type: string, data: string): void {
    this.dispatchEvent(new MessageEvent(type, { data }))
  }

  close(): void {
    this.readyState = 2
    this.closed = true
  }
}

const last = () => FakeEventSource.instances[FakeEventSource.instances.length - 1]

const wire = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    stream_id: 'stream-a',
    sequence: 41,
    vehicle_id: 7,
    field: 'VehicleSpeed',
    kind: 'float',
    value: 27.7,
    ts: '2026-01-01T00:00:00Z',
    ...overrides,
  })

// ---------------------------------------------------------------------------
// parseSignalChangeEvent
// ---------------------------------------------------------------------------

describe('parseSignalChangeEvent', () => {
  describe('happy-path typing per kind', () => {
    it('returns a typed float envelope for the compact wire shape', () => {
      const out = parseSignalChangeEvent({
        vehicle_id: 7,
        field: 'VehicleSpeed',
        kind: 'float',
        value: 27.7,
        ts: '2026-01-01T00:00:00Z',
      })
      expect(out).not.toBeNull()
      expect(out).toEqual<SignalChangeEvent>({
        stream_id: '',
        sequence: 0,
        vehicle_id: 7,
        field: 'VehicleSpeed',
        kind: 'float',
        value: 27.7,
        ts: '2026-01-01T00:00:00Z',
      })
    })

    it('keeps a string value as a string under kind "string"', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'Gear', kind: 'string', value: 'D' })
      expect(out?.kind).toBe('string')
      expect(out?.value).toBe('D')
    })

    it('keeps a boolean value under kind "bool"', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'Locked', kind: 'bool', value: true })
      expect(out?.kind).toBe('bool')
      expect(out?.value).toBe(true)
    })

    it('passes an integer value through under kind "int"', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'DoorState', kind: 'int', value: 3 })
      expect(out?.kind).toBe('int')
      expect(out?.value).toBe(3)
    })

    it('treats a timestamp value as a string under kind "time"', () => {
      const out = parseSignalChangeEvent({
        vehicle_id: 1,
        field: 'GpsTime',
        kind: 'time',
        value: '2026-02-03T04:05:06Z',
      })
      expect(out?.kind).toBe('time')
      expect(out?.value).toBe('2026-02-03T04:05:06Z')
    })
  })

  describe('kind normalization', () => {
    it('normalizes the long-form ValueKind string into the compact union', () => {
      const out = parseSignalChangeEvent(JSON.parse(wire({ kind: 'ValueKindFloat', value: 80.5 })))
      expect(out?.kind).toBe('float')
      expect(out?.value).toBe(80.5)
    })

    it('normalizes the SSE wire-format integer kind into the compact union', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 7, field: 'Locked', kind: 2, value: true })
      expect(out?.kind).toBe('bool')
      expect(out?.value).toBe(true)
    })

    it('maps an unrecognized kind to "unknown" and still emits primitive values', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 7, field: 'X', kind: 'frobnicated', value: 'raw' })
      expect(out?.kind).toBe('unknown')
      expect(out?.value).toBe('raw')
    })
  })

  describe('value coercion', () => {
    it('parses a numeric string into a number under kind "int"', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'int', value: '42' })
      expect(out?.value).toBe(42)
      expect(typeof out?.value).toBe('number')
    })

    it('drops a non-numeric string under kind "float"', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'float', value: 'not-a-number' })
      expect(out?.value).toBeNull()
    })

    it('stringifies a non-string value under kind "string"', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'string', value: 5 })
      expect(out?.value).toBe('5')
    })

    it('coerces a truthy/falsey value to boolean under kind "bool"', () => {
      expect(parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'bool', value: 1 })?.value).toBe(true)
      expect(parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'bool', value: 0 })?.value).toBe(false)
    })

    it('coerces a null or missing value to null', () => {
      expect(parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'float', value: null })?.value).toBeNull()
      expect(parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'float' })?.value).toBeNull()
    })

    it('rejects a non-finite number under a numeric kind (regression: NaN/Infinity must not leak)', () => {
      // A raw non-finite number is never a valid signal value — leaking it would
      // poison downstream charts/formatters. The numeric branch must reject it
      // exactly like the string branch already rejects "Infinity"/"NaN".
      expect(parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'float', value: Infinity })?.value).toBeNull()
      expect(parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'int', value: -Infinity })?.value).toBeNull()
      expect(parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'float', value: NaN })?.value).toBeNull()
    })

    it('rejects a non-finite number under the "unknown" fallback kind', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'mystery', value: Infinity })
      expect(out?.kind).toBe('unknown')
      expect(out?.value).toBeNull()
    })

    it('drops a non-primitive object value under the "unknown" fallback kind', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'mystery', value: { nested: true } })
      expect(out?.value).toBeNull()
    })

    it('defaults a missing ts to an empty string', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 1, field: 'X', kind: 'bool', value: true })
      expect(out?.ts).toBe('')
    })
  })

  describe('rejection of malformed payloads', () => {
    it('returns null for non-object primitives and arrays', () => {
      expect(parseSignalChangeEvent(null)).toBeNull()
      expect(parseSignalChangeEvent(undefined)).toBeNull()
      expect(parseSignalChangeEvent('a string')).toBeNull()
      expect(parseSignalChangeEvent(42)).toBeNull()
      expect(parseSignalChangeEvent([1, 2, 3])).toBeNull()
    })

    it('returns null when the field is missing or an empty string', () => {
      expect(parseSignalChangeEvent({ vehicle_id: 7 })).toBeNull()
      expect(parseSignalChangeEvent({ vehicle_id: 7, field: '', kind: 'float', value: 1 })).toBeNull()
    })

    it('returns null when vehicle_id is missing or not a number', () => {
      expect(parseSignalChangeEvent({ field: 'X', kind: 'float', value: 1 })).toBeNull()
      expect(parseSignalChangeEvent({ field: 'X', vehicle_id: '7', kind: 'float', value: 1 })).toBeNull()
    })

    it('accepts vehicle_id 0 as a valid numeric id', () => {
      const out = parseSignalChangeEvent({ vehicle_id: 0, field: 'X', kind: 'int', value: 5 })
      expect(out).not.toBeNull()
      expect(out?.vehicle_id).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// useSignalChangeStream
// ---------------------------------------------------------------------------

describe('useSignalChangeStream', () => {
  const globalRef = global as unknown as { EventSource: unknown }
  const RealEventSource = globalRef.EventSource

  beforeEach(() => {
    FakeEventSource.instances.length = 0
    globalRef.EventSource = FakeEventSource
  })

  afterEach(() => {
    globalRef.EventSource = RealEventSource
    vi.restoreAllMocks()
  })

  it('opens a single EventSource on the default /api/v1/events endpoint', () => {
    renderHook(() => useSignalChangeStream(vi.fn()))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(last().url).toBe('/api/v1/events')
  })

  it('honors an endpoint override', () => {
    renderHook(() => useSignalChangeStream(vi.fn(), { endpoint: '/custom/stream' }))
    expect(last().url).toBe('/custom/stream')
  })

  it('forwards parsed signal_change events to the handler as typed envelopes', () => {
    const handler = vi.fn<[SignalChangeEvent], void>()
    renderHook(() => useSignalChangeStream(handler))

    act(() => last().emit('signal_change', wire()))

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({
      stream_id: 'stream-a',
      sequence: 41,
      vehicle_id: 7,
      field: 'VehicleSpeed',
      kind: 'float',
      value: 27.7,
      ts: '2026-01-01T00:00:00Z',
    })
  })

  it('ignores events on other channels', () => {
    const handler = vi.fn()
    renderHook(() => useSignalChangeStream(handler))
    act(() => last().emit('vehicle_update', wire()))
    expect(handler).not.toHaveBeenCalled()
  })

  it('swallows malformed JSON without throwing or invoking the handler', () => {
    const handler = vi.fn()
    renderHook(() => useSignalChangeStream(handler))
    expect(() => act(() => last().emit('signal_change', '{not json'))).not.toThrow()
    expect(handler).not.toHaveBeenCalled()
  })

  it('drops well-formed JSON that fails envelope validation', () => {
    const handler = vi.fn()
    renderHook(() => useSignalChangeStream(handler))
    // Valid JSON, but no `field` — parseSignalChangeEvent returns null.
    act(() => last().emit('signal_change', JSON.stringify({ vehicle_id: 7, kind: 'float', value: 1 })))
    expect(handler).not.toHaveBeenCalled()
  })

  it('client-side filters by vehicleId when provided', () => {
    const handler = vi.fn()
    renderHook(() => useSignalChangeStream(handler, { vehicleId: 7 }))

    act(() => last().emit('signal_change', wire({ vehicle_id: 9 })))
    expect(handler).not.toHaveBeenCalled()

    act(() => last().emit('signal_change', wire({ vehicle_id: 7 })))
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('delivers every vehicle when no vehicleId filter is set', () => {
    const handler = vi.fn()
    renderHook(() => useSignalChangeStream(handler))
    act(() => last().emit('signal_change', wire({ vehicle_id: 9 })))
    act(() => last().emit('signal_change', wire({ vehicle_id: 12 })))
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('does not open a connection while disabled', () => {
    renderHook(() => useSignalChangeStream(vi.fn(), { enabled: false }))
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('opens on enable and closes on disable as the flag toggles', () => {
    const { rerender } = renderHook(({ enabled }) => useSignalChangeStream(vi.fn(), { enabled }), {
      initialProps: { enabled: false },
    })
    expect(FakeEventSource.instances).toHaveLength(0)

    rerender({ enabled: true })
    expect(FakeEventSource.instances).toHaveLength(1)
    const opened = last()
    expect(opened.closed).toBe(false)

    rerender({ enabled: false })
    expect(opened.closed).toBe(true)
  })

  it('closes the EventSource and stops delivering on unmount', () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useSignalChangeStream(handler))
    const source = last()

    unmount()
    expect(source.readyState).toBe(2)
    expect(source.closed).toBe(true)

    // Listener was removed on teardown — a late event must not reach the handler.
    act(() => source.emit('signal_change', wire()))
    expect(handler).not.toHaveBeenCalled()
  })

  it('uses the latest handler via a ref without tearing down the connection', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ h }) => useSignalChangeStream(h), {
      initialProps: { h: first },
    })
    const source = last()

    act(() => source.emit('signal_change', wire()))
    expect(first).toHaveBeenCalledTimes(1)

    rerender({ h: second })
    // Same socket — swapping the closure must NOT reconnect.
    expect(FakeEventSource.instances).toHaveLength(1)

    act(() => source.emit('signal_change', wire()))
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it('reconnects when the vehicleId filter changes, closing the previous socket', () => {
    const { rerender } = renderHook(({ v }) => useSignalChangeStream(vi.fn(), { vehicleId: v }), {
      initialProps: { v: 7 },
    })
    const firstSource = last()
    expect(FakeEventSource.instances).toHaveLength(1)

    rerender({ v: 9 })
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(firstSource.closed).toBe(true)
    expect(last().closed).toBe(false)
  })

  it('reconnects when the endpoint changes', () => {
    const { rerender } = renderHook(({ e }) => useSignalChangeStream(vi.fn(), { endpoint: e }), {
      initialProps: { e: '/api/v1/events' },
    })
    expect(last().url).toBe('/api/v1/events')

    rerender({ e: '/api/v1/events?fresh' })
    expect(FakeEventSource.instances).toHaveLength(2)
    expect(last().url).toBe('/api/v1/events?fresh')
  })
})
