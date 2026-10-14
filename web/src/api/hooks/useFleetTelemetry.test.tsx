import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { camelCaseKeys } from '@/lib/resilience'
import type { FleetTelemetryCoverageResponse } from '../types'
import { useFleetTelemetryCoverage } from './useFleetTelemetry'

const requestMock = vi.fn()
vi.mock('../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => requestMock.mockReset())

function populatedCoverage(destinations: Record<string, number>): FleetTelemetryCoverageResponse {
  return {
    categories: [{
      category: 'battery',
      total_fields: 3,
      destinations,
      fields: [{
        field: 'BatteryLevel',
        destination: 'signal_log',
        column: 'value',
        also_signal_log: true,
        subscribed: true,
      }],
    }],
    destination_totals: destinations,
    orphan_fields: ['UnknownField'],
  }
}

describe('fleet telemetry coverage', () => {
  it('enumerates original destinations once after the shared client adds aliases', async () => {
    const raw = populatedCoverage({ signal_log: 2, tesla_battery: 1, ignored_fields: 0 })
    const transformed = camelCaseKeys(raw)
    requestMock.mockResolvedValueOnce(transformed)

    const { result } = renderHook(() => useFleetTelemetryCoverage(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toMatchObject(raw)
    expect(result.current.data?.destination_totals).toEqual(raw.destination_totals)
    expect(result.current.data?.categories[0].destinations).toEqual(raw.categories[0].destinations)
    expect(Object.keys(result.current.data?.destination_totals ?? {})).toEqual([
      'signal_log', 'tesla_battery', 'ignored_fields',
    ])
    expect(Object.values(result.current.data?.categories[0].destinations ?? {})
      .reduce((total, count) => total + count, 0)).toBe(3)
    expect(transformed).toMatchObject({
      destination_totals: { signal_log: 2, signalLog: 2, tesla_battery: 1, teslaBattery: 1 },
    })
    expect(requestMock).toHaveBeenCalledWith('/tesla/fleet-telemetry/coverage', {
      signal: expect.any(AbortSignal),
    })
  })

  it('preserves populated fields and distinct opaque destination identifiers', async () => {
    const raw = populatedCoverage({
      signal_log: 2,
      signalLog: 7,
      customCamelCase: 3,
      'destination.with-dashes': 4,
      writer_v2: 5,
    })
    requestMock.mockResolvedValueOnce(camelCaseKeys(raw))

    const { result } = renderHook(() => useFleetTelemetryCoverage(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toMatchObject(raw)
    expect(result.current.data?.destination_totals).toEqual(raw.destination_totals)
    expect(result.current.data?.categories[0].destinations).toEqual(raw.categories[0].destinations)
  })

  it.each([null, undefined])('normalizes missing collections (%s)', async missing => {
    requestMock.mockResolvedValueOnce({
      categories: [{ category: 'battery', total_fields: 0, fields: [], destinations: missing }],
      destination_totals: missing,
      orphan_fields: missing,
    })

    const { result } = renderHook(() => useFleetTelemetryCoverage(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual({
      categories: [{ category: 'battery', total_fields: 0, fields: [], destinations: {} }],
      destination_totals: {},
      orphan_fields: [],
    })
  })

  it('normalizes an absent category list', async () => {
    requestMock.mockResolvedValueOnce({})
    const { result } = renderHook(() => useFleetTelemetryCoverage(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      categories: [], destination_totals: {}, orphan_fields: [],
    })
  })
})
