import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { camelCaseKeys } from '@/lib/resilience'
import type { FleetTelemetryCoverageResponse } from '../types'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('../client', () => ({ request: requestMock }))
import { fleetTelemetryKeys, useFleetTelemetryCoverage } from './useFleetTelemetry'

const populated: FleetTelemetryCoverageResponse = {
  categories: [{
    category: 'driving',
    total_fields: 3,
    destinations: { signal_log: 2, tesla_drive_state: 1, redis: 3 },
    fields: [{
      field: 'VehicleSpeed',
      destination: 'tesla_drive_state',
      column: 'speed_mps',
      also_signal_log: true,
      subscribed: true,
    }],
  }],
  destination_totals: { signal_log: 2, tesla_drive_state: 1, redis: 3 },
  orphan_fields: ['UnroutedField'],
}

let client: QueryClient

beforeEach(() => {
  requestMock.mockReset()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  cleanup()
  client.clear()
})

function coverageHook() {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return renderHook(() => useFleetTelemetryCoverage(), { wrapper })
}

describe('Fleet Telemetry coverage destination dictionaries', () => {
  it('enumerates each original destination once after client alias expansion', async () => {
    const expanded = camelCaseKeys(populated)
    requestMock.mockResolvedValue(expanded)
    const { result } = coverageHook()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.destination_totals).toEqual(populated.destination_totals)
    expect(result.current.data?.categories[0].destinations).toEqual(populated.categories[0].destinations)
    expect(Object.values(result.current.data?.destination_totals ?? {}).reduce((sum, n) => sum + n, 0))
      .toBe(6)
    expect(client.getQueryData(fleetTelemetryKeys.coverage)).toEqual(result.current.data)
    expect(expanded).toHaveProperty('destination_totals.signalLog', 2)
    expect(requestMock).toHaveBeenCalledWith(
      '/tesla/fleet-telemetry/coverage', { signal: expect.any(AbortSignal) },
    )
    expect(result.current.data?.categories[0].fields).toEqual(camelCaseKeys(populated.categories[0].fields))
    expect(result.current.data?.orphan_fields).toEqual(populated.orphan_fields)
  })

  it('preserves populated raw data and distinct standalone destination identifiers', async () => {
    const destinations = { ...populated.destination_totals, customDestination: 4, 'sink-v2': 0 }
    const raw = {
      ...populated,
      destination_totals: destinations,
      categories: [{ ...populated.categories[0], destinations }],
    }
    requestMock.mockResolvedValue(raw)
    const { result } = coverageHook()
    await waitFor(() => expect(result.current.data).toEqual(raw))
  })

  it('does not remove a similarly named destination with a different count', async () => {
    const destinations = { signal_log: 2, signalLog: 5 }
    requestMock.mockResolvedValue({
      ...populated, destination_totals: destinations,
      categories: [{ ...populated.categories[0], destinations }],
    })
    const { result } = coverageHook()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.destination_totals).toEqual(destinations)
    expect(result.current.data?.categories[0].destinations).toEqual(destinations)
  })

  it('keeps empty collections iterable', async () => {
    requestMock.mockResolvedValue({ categories: null, destination_totals: null, orphan_fields: null })
    const { result } = coverageHook()
    await waitFor(() => expect(result.current.data).toEqual({
      categories: [], destination_totals: {}, orphan_fields: [],
    }))
  })

  it('surfaces request failures rather than returning empty coverage', async () => {
    const error = new Error('Coverage unavailable')
    requestMock.mockRejectedValue(error)
    const { result } = coverageHook()
    await waitFor(() => expect(result.current.error).toBe(error))
    expect(result.current.data).toBeUndefined()
  })
})
