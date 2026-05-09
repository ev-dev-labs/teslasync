import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const requestMock = vi.fn()
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import { useSignals } from '../useTelemetry'

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

// ---------------------------------------------------------------------------
// useTelemetry::useSignals — name-only catalog hook
//
// Pinned regression tests for the per-field MQTT cutover bug where
// /signals/{vid}/available started returning the rich AvailableSignal[]
// object array, but this hook still claimed `string[]` and rendered each
// option directly into JSX, crashing the Signal Log Viewer with React
// error #31 ("Objects are not valid as a React child").
// ---------------------------------------------------------------------------

describe('useTelemetry.useSignals', () => {
  beforeEach(() => requestMock.mockReset())

  it('extracts names from the post-Phase-42 rich catalog response shape', async () => {
    requestMock.mockResolvedValue({
      vehicle_id: 1,
      count: 3,
      source: 'protomodel',
      signals: [
        { name: 'BatteryLevel', category: 'state', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindCharge', is_compound: false, is_setting_unit: false },
        { name: 'VehicleSpeed', category: 'driving', value_kind: 'ValueKindFloat', unit_kind: 'UnitKindDistance', is_compound: false, is_setting_unit: false },
        { name: 'Gear', category: 'driving', value_kind: 'ValueKindString', unit_kind: 'UnitKindNone', is_compound: false, is_setting_unit: false },
      ],
    })

    const { result } = renderHook(() => useSignals(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(['BatteryLevel', 'VehicleSpeed', 'Gear'])
    // Every entry must be a string — never an object — so consumers can
    // safely render `<span>{s}</span>` and call `array.join(',')`.
    for (const entry of result.current.data ?? []) {
      expect(typeof entry).toBe('string')
    }
  })

  it('still accepts the legacy {signals: string[]} shape', async () => {
    requestMock.mockResolvedValue({ signals: ['Foo', 'Bar'] })
    const { result } = renderHook(() => useSignals(2), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(['Foo', 'Bar'])
  })

  it('still accepts the legacy bare string[] shape', async () => {
    requestMock.mockResolvedValue(['Alpha', 'Beta'])
    const { result } = renderHook(() => useSignals(3), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(['Alpha', 'Beta'])
  })

  it('drops malformed entries (missing name, non-string name, empty string)', async () => {
    requestMock.mockResolvedValue({
      signals: [
        { name: 'Good' },
        { name: 123 },           // non-string -> drop
        { category: 'orphan' },  // missing name -> drop
        { name: '' },            // empty -> drop
        null,                    // null -> drop
        'BareString',            // pre-Phase-42 string element survives
        'AnotherGood',
      ],
    })
    const { result } = renderHook(() => useSignals(4), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(['Good', 'BareString', 'AnotherGood'])
  })

  it('returns empty array when signals key is missing or null', async () => {
    requestMock.mockResolvedValue({ vehicle_id: 1, count: 0, source: 'protomodel' })
    const { result } = renderHook(() => useSignals(5), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })

  it('skips the request when vehicleId is 0', () => {
    renderHook(() => useSignals(0), { wrapper: makeWrapper() })
    expect(requestMock).not.toHaveBeenCalled()
  })
})
