/**
 * Tests for the typed SSE consumer
 * (`web/src/api/sseClient.ts`). Verifies:
 *
 *   - parseEnvelope happy paths for number / string / bool variants
 *   - parseEnvelope returns (does NOT throw) Error for malformed JSON
 *   - parseEnvelope returns Error for unknown kinds and missing fields
 *   - subscribeSignals composes the URL correctly (default + override)
 *   - subscribeSignals client-side filters by vehicleId and fields
 *   - subscribeSignals propagates parse errors to onError
 *   - subscribeSignals cleanup closes the EventSource and removes listeners
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  parseEnvelope,
  subscribeSignals,
  type SignalEnvelope,
} from '../sseClient'

interface FakeListenerEntry {
  type: string
  listener: EventListener
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  readyState: number = 1
  closed = false
  listeners: FakeListenerEntry[] = []

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.push({ type, listener })
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners = this.listeners.filter(
      (entry) => !(entry.type === type && entry.listener === listener),
    )
  }

  close(): void {
    this.readyState = 2
    this.closed = true
  }

  dispatch(type: string, data: string): void {
    const ev = new MessageEvent(type, { data })
    for (const entry of this.listeners) {
      if (entry.type === type) entry.listener(ev)
    }
  }

  dispatchError(): void {
    const ev = new Event('error')
    for (const entry of this.listeners) {
      if (entry.type === 'error') entry.listener(ev)
    }
  }
}

// ---------------------------------------------------------------------------
// parseEnvelope
// ---------------------------------------------------------------------------

describe('parseEnvelope', () => {
  it('returns a typed envelope for a float value (compact kind)', () => {
    const out = parseEnvelope(
      JSON.stringify({
        stream_id: 'stream-a',
        sequence: 41,
        vehicle_id: 7,
        field: 'VehicleSpeed',
        kind: 'float',
        value: 27.7,
        ts: '2026-01-01T00:00:00Z',
      }),
    )
    expect(out).not.toBeInstanceOf(Error)
    const env = out as SignalEnvelope
    expect(env.vehicle_id).toBe(7)
    expect(env.stream_id).toBe('stream-a')
    expect(env.sequence).toBe(41)
    expect(env.field).toBe('VehicleSpeed')
    expect(env.kind).toBe('float')
    expect(env.value.kind).toBe('number')
    if (env.value.kind === 'number') {
      expect(env.value.value).toBeCloseTo(27.7)
    }
    expect(env.ts).toBe('2026-01-01T00:00:00Z')
  })

  it('returns a typed envelope for a string value', () => {
    const out = parseEnvelope(
      JSON.stringify({
        vehicle_id: 7,
        field: 'Gear',
        kind: 'string',
        value: 'D',
        ts: '2026-01-01T00:00:00Z',
      }),
    )
    expect(out).not.toBeInstanceOf(Error)
    const env = out as SignalEnvelope
    expect(env.kind).toBe('string')
    expect(env.value).toEqual({ kind: 'string', value: 'D' })
  })

  it('returns a typed envelope for a bool value', () => {
    const out = parseEnvelope(
      JSON.stringify({
        vehicle_id: 7,
        field: 'Locked',
        kind: 'bool',
        value: true,
        ts: '2026-01-01T00:00:00Z',
      }),
    )
    expect(out).not.toBeInstanceOf(Error)
    const env = out as SignalEnvelope
    expect(env.kind).toBe('bool')
    expect(env.value).toEqual({ kind: 'bool', value: true })
  })

  it('normalizes the long-form ValueKind string into the compact union', () => {
    const out = parseEnvelope(
      JSON.stringify({
        vehicle_id: 7,
        field: 'BatteryLevel',
        kind: 'ValueKindFloat',
        value: 80.5,
        ts: 'T',
      }),
    )
    expect(out).not.toBeInstanceOf(Error)
    expect((out as SignalEnvelope).kind).toBe('float')
  })

  it('normalizes the SSE wire-format integer kind into the compact union', () => {
    const out = parseEnvelope(
      JSON.stringify({
        vehicle_id: 7,
        field: 'Locked',
        kind: 2, // ValueKindBool iota
        value: true,
        ts: 'T',
      }),
    )
    expect(out).not.toBeInstanceOf(Error)
    expect((out as SignalEnvelope).kind).toBe('bool')
  })

  it('returns an Error (does not throw) on malformed JSON', () => {
    const out = parseEnvelope('{not json')
    expect(out).toBeInstanceOf(Error)
    expect((out as Error).message).toMatch(/malformed JSON/i)
  })

  it('returns an Error for an unknown kind', () => {
    const out = parseEnvelope(
      JSON.stringify({
        vehicle_id: 7,
        field: 'X',
        kind: 'frobnicated',
        value: 1,
        ts: 'T',
      }),
    )
    expect(out).toBeInstanceOf(Error)
    expect((out as Error).message).toMatch(/unknown kind/i)
  })

  it('returns an Error when payload is not an object', () => {
    expect(parseEnvelope('null')).toBeInstanceOf(Error)
    expect(parseEnvelope('"a string"')).toBeInstanceOf(Error)
    expect(parseEnvelope('[1, 2, 3]')).toBeInstanceOf(Error)
  })

  it('returns an Error when field or vehicle_id is missing', () => {
    const noField = parseEnvelope(
      JSON.stringify({ vehicle_id: 7, kind: 'float', value: 1, ts: 'T' }),
    )
    expect(noField).toBeInstanceOf(Error)
    const noVid = parseEnvelope(
      JSON.stringify({ field: 'X', kind: 'float', value: 1, ts: 'T' }),
    )
    expect(noVid).toBeInstanceOf(Error)
  })

  it('coerces null typed value into the SIValue null variant', () => {
    const out = parseEnvelope(
      JSON.stringify({
        vehicle_id: 7,
        field: 'X',
        kind: 'float',
        value: null,
        ts: 'T',
      }),
    )
    expect(out).not.toBeInstanceOf(Error)
    expect((out as SignalEnvelope).value).toEqual({ kind: 'null', value: null })
  })
})

// ---------------------------------------------------------------------------
// subscribeSignals
// ---------------------------------------------------------------------------

describe('subscribeSignals', () => {
  let originalEventSource: typeof EventSource | undefined

  beforeEach(() => {
    FakeEventSource.instances.length = 0
    originalEventSource = (globalThis as { EventSource?: typeof EventSource }).EventSource
    ;(globalThis as { EventSource: unknown }).EventSource = FakeEventSource
  })

  afterEach(() => {
    if (originalEventSource) {
      (globalThis as { EventSource: unknown }).EventSource = originalEventSource
    } else {
      delete (globalThis as { EventSource?: unknown }).EventSource
    }
  })

  it('opens an EventSource on the default /api/v1/events endpoint', () => {
    const cleanup = subscribeSignals(7, [], vi.fn(), vi.fn())
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0].url).toBe('/api/v1/events')
    cleanup()
  })

  it('respects the endpoint override option', () => {
    const cleanup = subscribeSignals(7, ['VehicleSpeed'], vi.fn(), vi.fn(), {
      endpoint: '/api/v1/signals/7/stream?fields=VehicleSpeed',
    })
    expect(FakeEventSource.instances[0].url).toBe(
      '/api/v1/signals/7/stream?fields=VehicleSpeed',
    )
    cleanup()
  })

  it('forwards parsed signal_change events to onEnvelope', () => {
    const onEnvelope = vi.fn()
    const onError = vi.fn()
    const cleanup = subscribeSignals(0, [], onEnvelope, onError)
    FakeEventSource.instances[0].dispatch(
      'signal_change',
      JSON.stringify({
        vehicle_id: 7,
        field: 'VehicleSpeed',
        kind: 'float',
        value: 27.7,
        ts: 'T',
      }),
    )
    expect(onEnvelope).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
    const env = onEnvelope.mock.calls[0][0] as SignalEnvelope
    expect(env.field).toBe('VehicleSpeed')
    expect(env.kind).toBe('float')
    cleanup()
  })

  it('client-side filters by vehicleId when vehicleId > 0', () => {
    const onEnvelope = vi.fn()
    const cleanup = subscribeSignals(7, [], onEnvelope, vi.fn())
    const source = FakeEventSource.instances[0]
    source.dispatch(
      'signal_change',
      JSON.stringify({
        vehicle_id: 9,
        field: 'X',
        kind: 'bool',
        value: true,
        ts: 'T',
      }),
    )
    expect(onEnvelope).not.toHaveBeenCalled()
    source.dispatch(
      'signal_change',
      JSON.stringify({
        vehicle_id: 7,
        field: 'X',
        kind: 'bool',
        value: true,
        ts: 'T',
      }),
    )
    expect(onEnvelope).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('client-side filters by fields when the set is non-empty', () => {
    const onEnvelope = vi.fn()
    const cleanup = subscribeSignals(0, ['VehicleSpeed'], onEnvelope, vi.fn())
    const source = FakeEventSource.instances[0]
    source.dispatch(
      'signal_change',
      JSON.stringify({
        vehicle_id: 7,
        field: 'BatteryLevel',
        kind: 'float',
        value: 80,
        ts: 'T',
      }),
    )
    expect(onEnvelope).not.toHaveBeenCalled()
    source.dispatch(
      'signal_change',
      JSON.stringify({
        vehicle_id: 7,
        field: 'VehicleSpeed',
        kind: 'float',
        value: 27,
        ts: 'T',
      }),
    )
    expect(onEnvelope).toHaveBeenCalledTimes(1)
    cleanup()
  })

  it('passes the raw payload to onError on parse failure', () => {
    const onEnvelope = vi.fn()
    const onError = vi.fn()
    const cleanup = subscribeSignals(0, [], onEnvelope, onError)
    FakeEventSource.instances[0].dispatch('signal_change', '{not json')
    expect(onEnvelope).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const [err, raw] = onError.mock.calls[0]
    expect(err).toBeInstanceOf(Error)
    expect(raw).toBe('{not json')
    cleanup()
  })

  it('invokes onError when the underlying EventSource emits an error', () => {
    const onError = vi.fn()
    const cleanup = subscribeSignals(0, [], vi.fn(), onError)
    FakeEventSource.instances[0].dispatchError()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
    cleanup()
  })

  it('cleanup closes the EventSource and removes listeners', () => {
    const cleanup = subscribeSignals(0, [], vi.fn(), vi.fn())
    const source = FakeEventSource.instances[0]
    expect(source.listeners.length).toBeGreaterThan(0)
    cleanup()
    expect(source.closed).toBe(true)
    expect(source.readyState).toBe(2)
    expect(source.listeners).toHaveLength(0)
  })

  it('does not expose the raw EventSource — only returns a cleanup fn', () => {
    const ret = subscribeSignals(0, [], vi.fn(), vi.fn())
    expect(typeof ret).toBe('function')
    // The return value MUST NOT be the EventSource itself nor expose it.
    expect(ret).not.toBeInstanceOf(FakeEventSource)
    ret()
  })
})
