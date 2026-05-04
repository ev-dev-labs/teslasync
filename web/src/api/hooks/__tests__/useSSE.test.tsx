import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { parseSignalChangeEvent, useSignalChangeStream } from '@/hooks/useSSE'

interface MockEventSource extends EventTarget {
  url: string
  readyState: number
  close: () => void
  __dispatch: (eventType: string, data: string) => void
}

const sources: MockEventSource[] = []

class FakeEventSource extends EventTarget {
  url: string
  readyState = 1
  constructor(url: string) {
    super()
    this.url = url
    sources.push(this as unknown as MockEventSource)
    ;(this as unknown as MockEventSource).__dispatch = (type: string, data: string) => {
      const ev = new MessageEvent(type, { data })
      this.dispatchEvent(ev)
    }
  }
  close() { this.readyState = 2 }
}

describe('parseSignalChangeEvent', () => {
  it('returns the typed envelope when given the prompt-spec compact wire shape', () => {
    const out = parseSignalChangeEvent({
      vehicle_id: 7,
      field: 'VehicleSpeed',
      kind: 'float',
      value: 27.7,
      ts: '2026-01-01T00:00:00Z',
    })
    expect(out).not.toBeNull()
    expect(out!.kind).toBe('float')
    expect(typeof out!.value).toBe('number')
    expect(out!.value).toBe(27.7)
  })

  it('normalizes the long-form ValueKind string into the compact union', () => {
    const out = parseSignalChangeEvent({
      vehicle_id: 7,
      field: 'BatteryLevel',
      kind: 'ValueKindFloat',
      value: 80.5,
      ts: 'T',
    })
    expect(out!.kind).toBe('float')
    expect(out!.value).toBe(80.5)
  })

  it('normalizes the SSE wire-format integer into the compact union', () => {
    const out = parseSignalChangeEvent({
      vehicle_id: 7,
      field: 'Locked',
      kind: 2, // ValueKindBool iota
      value: true,
      ts: 'T',
    })
    expect(out!.kind).toBe('bool')
    expect(typeof out!.value).toBe('boolean')
    expect(out!.value).toBe(true)
  })

  it('rejects malformed payloads', () => {
    expect(parseSignalChangeEvent(null)).toBeNull()
    expect(parseSignalChangeEvent({ vehicle_id: 7 })).toBeNull()
    expect(parseSignalChangeEvent({ field: 'X' })).toBeNull()
  })
})

describe('useSignalChangeStream', () => {
  let originalEventSource: typeof EventSource

  beforeEach(() => {
    sources.length = 0
    originalEventSource = global.EventSource
    ;(global as { EventSource: unknown }).EventSource = FakeEventSource
  })

  afterEach(() => {
    ;(global as { EventSource: unknown }).EventSource = originalEventSource
  })

  it('subscribes to the signal_change channel and surfaces typed events', () => {
    const handler = vi.fn()
    renderHook(() => useSignalChangeStream(handler))
    expect(sources).toHaveLength(1)

    act(() => {
      sources[0].__dispatch('signal_change', JSON.stringify({
        vehicle_id: 7,
        field: 'VehicleSpeed',
        kind: 'float',
        value: 27.7,
        ts: '2026-01-01T00:00:00Z',
      }))
    })

    expect(handler).toHaveBeenCalledTimes(1)
    const event = handler.mock.calls[0][0]
    expect(event.field).toBe('VehicleSpeed')
    expect(event.kind).toBe('float')
    expect(typeof event.value).toBe('number')
    expect(event.value).toBe(27.7)
  })

  it('filters by vehicleId when supplied', () => {
    const handler = vi.fn()
    renderHook(() => useSignalChangeStream(handler, { vehicleId: 7 }))

    act(() => {
      sources[0].__dispatch('signal_change', JSON.stringify({
        vehicle_id: 9, field: 'X', kind: 'bool', value: true, ts: 'T',
      }))
    })
    expect(handler).not.toHaveBeenCalled()

    act(() => {
      sources[0].__dispatch('signal_change', JSON.stringify({
        vehicle_id: 7, field: 'X', kind: 'bool', value: true, ts: 'T',
      }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe when disabled', () => {
    renderHook(() => useSignalChangeStream(vi.fn(), { enabled: false }))
    expect(sources).toHaveLength(0)
  })

  it('closes the EventSource on unmount', () => {
    const { unmount } = renderHook(() => useSignalChangeStream(vi.fn()))
    expect(sources).toHaveLength(1)
    const source = sources[0]
    unmount()
    expect(source.readyState).toBe(2)
  })
})
