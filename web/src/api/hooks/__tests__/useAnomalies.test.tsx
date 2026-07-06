// useAnomalies hook + window-clamp helper tests.
//
// Covers every export of api/hooks/useAnomalies:
//   - clampAnomalyDays: the [1,30] normaliser (default/negative/NaN/Infinity,
//     over-max clamp, in-range pass-through + fractional truncation).
//   - ANOMALY_{MIN,MAX,DEFAULT}_DAYS: the backend-mirrored window bounds.
//   - useAnomalies: hits GET /analytics/anomalies with snake_case params and
//     no /api/v1 prefix, threads the AbortSignal, returns the raw payload,
//     stays disabled for null / empty / whitespace ids (the 400 guard), clamps
//     an out-of-range window into both the URL and the query key, and surfaces
//     the error state on a rejected request.
//
// Network is mocked at the api/client boundary (the repo convention) so the
// test never touches fetch. Keep it beside the hook so path-scoped checks
// match `api/hooks/useAnomalies` contiguously.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const requestMock = vi.fn()
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

import {
  useAnomalies,
  clampAnomalyDays,
  ANOMALY_MIN_DAYS,
  ANOMALY_MAX_DAYS,
  ANOMALY_DEFAULT_DAYS,
  type AnomalyData,
} from '../useAnomalies'

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** A fully-populated, realistic payload matching the Go anomalyResponse shape. */
function samplePayload(overrides: Partial<AnomalyData> = {}): AnomalyData {
  return {
    anomalies: [
      {
        signal: 'TpmsPressureFl',
        type: 'range',
        severity: 'critical',
        value: 1.4,
        baseline: 2.75,
        z_score: 0,
        detected_at: '2026-07-01T12:00:00Z',
        message: 'Tire Pressure (Front-Left) value 1.40 is below safe minimum (2.0)',
      },
      {
        signal: 'BatteryLevel',
        type: 'trend',
        severity: 'warning',
        value: 41.2,
        baseline: 63.8,
        z_score: 2.7,
        detected_at: '2026-07-01T09:00:00Z',
        message: 'Battery Level decreased 35% in last 24h vs 7-day average',
      },
    ],
    health_summary: {
      battery: 'warning',
      tires: 'critical',
      motors: 'normal',
      hvac: 'normal',
      charging: 'normal',
    },
    signals_monitored: 42,
    anomalies_last_7d: 2,
    anomalies_last_24h: 1,
    ...overrides,
  }
}

beforeEach(() => {
  requestMock.mockReset()
})

describe('clampAnomalyDays', () => {
  it('falls back to the 7-day default for non-positive or non-finite input', () => {
    expect(clampAnomalyDays(0)).toBe(ANOMALY_DEFAULT_DAYS)
    expect(clampAnomalyDays(-5)).toBe(ANOMALY_DEFAULT_DAYS)
    expect(clampAnomalyDays(Number.NaN)).toBe(ANOMALY_DEFAULT_DAYS)
    expect(clampAnomalyDays(Number.POSITIVE_INFINITY)).toBe(ANOMALY_DEFAULT_DAYS)
    expect(clampAnomalyDays(Number.NEGATIVE_INFINITY)).toBe(ANOMALY_DEFAULT_DAYS)
  })

  it('clamps windows above the 30-day maximum down to the ceiling', () => {
    expect(clampAnomalyDays(31)).toBe(ANOMALY_MAX_DAYS)
    expect(clampAnomalyDays(100)).toBe(30)
  })

  it('passes valid in-range windows through and truncates fractions', () => {
    expect(clampAnomalyDays(1)).toBe(ANOMALY_MIN_DAYS)
    expect(clampAnomalyDays(7)).toBe(7)
    expect(clampAnomalyDays(30)).toBe(30)
    expect(clampAnomalyDays(7.9)).toBe(7)
    // A sub-1-day fraction truncates to 0 then clamps up to the floor.
    expect(clampAnomalyDays(0.5)).toBe(ANOMALY_MIN_DAYS)
  })
})

describe('anomaly window bounds', () => {
  it('exposes the backend-accepted window with the default inside it', () => {
    expect(ANOMALY_MIN_DAYS).toBe(1)
    expect(ANOMALY_MAX_DAYS).toBe(30)
    expect(ANOMALY_DEFAULT_DAYS).toBe(7)
    expect(ANOMALY_DEFAULT_DAYS).toBeGreaterThanOrEqual(ANOMALY_MIN_DAYS)
    expect(ANOMALY_DEFAULT_DAYS).toBeLessThanOrEqual(ANOMALY_MAX_DAYS)
  })
})

describe('useAnomalies', () => {
  it('requests the snake_case endpoint (no /api/v1 prefix) and returns the payload', async () => {
    const payload = samplePayload()
    requestMock.mockResolvedValueOnce(payload)

    const { result } = renderHook(() => useAnomalies('5'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(requestMock).toHaveBeenCalledWith(
      '/analytics/anomalies?vehicle_id=5&days=7',
      expect.objectContaining({ signal: expect.anything() }),
    )
    const url = requestMock.mock.calls[0][0] as string
    expect(url).not.toContain('/api/v1')
    expect(url).toContain('vehicle_id=')
    expect(url).not.toContain('vehicleId=')

    expect(result.current.data).toEqual(payload)
    expect(result.current.data?.anomalies).toHaveLength(2)
    expect(result.current.data?.anomalies[0].severity).toBe('critical')
    expect(result.current.data?.signals_monitored).toBe(42)
    expect(result.current.data?.health_summary.tires).toBe('critical')
  })

  it('stays disabled while no vehicle is selected (null id)', () => {
    const { result } = renderHook(() => useAnomalies(null), { wrapper: makeWrapper() })

    expect(requestMock).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isFetching).toBe(false)
    expect(result.current.data).toBeUndefined()
  })

  it('stays disabled for empty or whitespace-only ids (guards the backend 400)', () => {
    const emptyWrapper = makeWrapper()
    const { result: emptyResult } = renderHook(() => useAnomalies(''), { wrapper: emptyWrapper })
    expect(emptyResult.current.fetchStatus).toBe('idle')

    const { result: wsResult } = renderHook(() => useAnomalies('   '), { wrapper: makeWrapper() })
    expect(wsResult.current.fetchStatus).toBe('idle')

    expect(requestMock).not.toHaveBeenCalled()
  })

  it('clamps an out-of-range window into both the request URL and the query key', async () => {
    requestMock.mockResolvedValueOnce(samplePayload({ anomalies: [], anomalies_last_7d: 0, anomalies_last_24h: 0 }))

    const { result } = renderHook(() => useAnomalies('9', 100), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const url = requestMock.mock.calls[0][0] as string
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('vehicle_id')).toBe('9')
    expect(params.get('days')).toBe('30')
    expect(url).not.toContain('days=100')
    expect(result.current.data?.anomalies).toEqual([])
  })

  it('surfaces the error state when the request rejects', async () => {
    requestMock.mockRejectedValueOnce(new Error('boom: anomaly query failed'))

    const { result } = renderHook(() => useAnomalies('5'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(requestMock).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeInstanceOf(Error)
    expect(String(result.current.error)).toContain('boom: anomaly query failed')
  })
})
