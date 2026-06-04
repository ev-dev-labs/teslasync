/**
 * useSignalObservations contract-drift adapter regression.
 *
 * Regression guarded here:
 *   The hook sent `signal_name=Foo` (silently ignored by the modern
 *   backend, which expects `field=Foo`) and consumed the response as a
 *   bare `SignalObservation[]` array — but the backend now wraps it in
 *   `{count, total, observations: [...]}` and emits a single `value`
 *   column with a `value_kind` discriminator (`ValueKindFloat`,
 *   `ValueKindEnum`, …) instead of separate `value_numeric` /
 *   `value_text` / `value_bool` columns. Net effect: every caller saw
 *   undefined (because `data?.[0]` on the envelope object was
 *   undefined) AND the few that didn't crash got the wrong signal's
 *   value (because the backend ignored the filter).
 *
 * Post-fix:
 *   `field=` is sent on the wire; the envelope is unwrapped; each
 *   `ValueKind` is dispatched into its legacy column so callers'
 *   `latestNumeric` / `latestText` / `latestBool` extractors keep
 *   working unchanged.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

import { request } from '@/api/client'
import { useSignalObservations } from '../useTelemetry'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('useSignalObservations', () => {
  it('sends field= (not signal_name=) on the wire', async () => {
    mockedRequest.mockResolvedValueOnce({
      count: 0,
      total: 0,
      observations: [],
    })
    const { result } = renderHook(
      () => useSignalObservations(1, { signal_name: 'CruiseSetSpeed', limit: 1 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The frontend-facing opts key is still `signal_name` (callers do
    // not need to change), but the wire param MUST be `field=` to match the modern
    // backend handler. If the rename ever regresses, every caller's
    // panel will silently render the WRONG signal's value because the
    // backend ignores unknown query params.
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringContaining('field=CruiseSetSpeed'),
      expect.any(Object),
    )
    expect(mockedRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('signal_name='),
      expect.any(Object),
    )
  })

  it('unwraps {count,total,observations} envelope into SignalObservation[]', async () => {
    mockedRequest.mockResolvedValueOnce({
      count: 1,
      total: 44,
      observations: [
        {
          vehicle_id: 1,
          ts: '2026-04-25T03:02:47.971048Z',
          field: 'CruiseSetSpeed',
          value_kind: 'ValueKindDouble',
          value: 11.176,
        },
      ],
    })
    const { result } = renderHook(
      () => useSignalObservations(1, { signal_name: 'CruiseSetSpeed', limit: 1 }),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    const row = result.current.data![0]
    expect(row.signal_name).toBe('CruiseSetSpeed')
    expect(row.value_numeric).toBe(11.176)
    expect(row.value_text).toBeNull()
    expect(row.value_bool).toBeNull()
  })

  it('routes each ValueKind into its legacy column', async () => {
    mockedRequest.mockResolvedValueOnce({
      observations: [
        // ValueKindFloat → value_numeric
        { vehicle_id: 1, ts: 't0', field: 'A', value_kind: 'ValueKindFloat', value: 1.5 },
        // ValueKindDouble → value_numeric
        { vehicle_id: 1, ts: 't1', field: 'B', value_kind: 'ValueKindDouble', value: 2.5 },
        // ValueKindInt32 → value_numeric
        { vehicle_id: 1, ts: 't2', field: 'C', value_kind: 'ValueKindInt32', value: 7 },
        // ValueKindInt64 → value_numeric (numeric strings tolerated for large 64-bit values)
        { vehicle_id: 1, ts: 't3', field: 'D', value_kind: 'ValueKindInt64', value: '9007199254740993' },
        // ValueKindString → value_text
        { vehicle_id: 1, ts: 't4', field: 'E', value_kind: 'ValueKindString', value: 'hello' },
        // ValueKindEnum → value_text (e.g., proto-prefixed enum names)
        { vehicle_id: 1, ts: 't5', field: 'F', value_kind: 'ValueKindEnum', value: 'FollowDistance7' },
        // ValueKindBool → value_bool
        { vehicle_id: 1, ts: 't6', field: 'G', value_kind: 'ValueKindBool', value: true },
        // Unknown / compound kind → all-null fallthrough (no crash)
        { vehicle_id: 1, ts: 't7', field: 'H', value_kind: 'CompoundLocation', value: { lat: 1, lon: 2 } },
      ],
    })
    const { result } = renderHook(() => useSignalObservations(1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const rows = result.current.data!
    expect(rows[0].value_numeric).toBe(1.5)
    expect(rows[1].value_numeric).toBe(2.5)
    expect(rows[2].value_numeric).toBe(7)
    expect(rows[3].value_numeric).toBe(9007199254740992) // numeric coercion (precision loss expected for >2^53)
    expect(rows[4].value_text).toBe('hello')
    expect(rows[5].value_text).toBe('FollowDistance7')
    expect(rows[6].value_bool).toBe(true)
    // Compound / unknown kinds: all three legacy columns must be null
    // so consumers see "missing" rather than a coerced 0 / 'NaN' /
    // false. Critical for the AutopilotSection's `latestNumeric ??
    // null` semantics — a numeric coercion of `{lat,lon}` would
    // produce NaN which then breaks downstream chart aggregations.
    expect(rows[7].value_numeric).toBeNull()
    expect(rows[7].value_text).toBeNull()
    expect(rows[7].value_bool).toBeNull()
  })

  it('coerces non-finite numerics to null, not NaN', async () => {
    mockedRequest.mockResolvedValueOnce({
      observations: [
        // value=null on a numeric kind: must yield value_numeric=null,
        // NOT 0. Substituting 0 for missing telemetry corrupts every
        // downstream aggregation that uses latestNumeric (e.g., motor
        // power averages — see helpers.ts:computeMotorStats).
        { vehicle_id: 1, ts: 't0', field: 'A', value_kind: 'ValueKindFloat', value: null },
        // Object on a numeric kind: Number({}) = NaN; must be null.
        { vehicle_id: 1, ts: 't1', field: 'B', value_kind: 'ValueKindFloat', value: { not: 'a number' } },
      ],
    })
    const { result } = renderHook(() => useSignalObservations(1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const rows = result.current.data!
    expect(rows[0].value_numeric).toBeNull()
    expect(rows[1].value_numeric).toBeNull()
  })

  it('tolerates camelCased response keys (valueKind / vehicleId)', async () => {
    // Some `request` middlewares in the codebase camelCase response
    // keys before they reach the queryFn. The adapter must accept
    // BOTH casings so a future middleware swap doesn't silently break
    // every signal-reading panel.
    mockedRequest.mockResolvedValueOnce({
      observations: [
        { vehicleId: 1, ts: 't0', field: 'A', valueKind: 'ValueKindFloat', value: 3.14 },
      ],
    })
    const { result } = renderHook(() => useSignalObservations(1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data![0].value_numeric).toBe(3.14)
    expect(result.current.data![0].vehicle_id).toBe(1)
  })

  it('returns empty array when envelope has no observations', async () => {
    mockedRequest.mockResolvedValueOnce({ count: 0, total: 0, observations: [] })
    const { result } = renderHook(() => useSignalObservations(1), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })

  it('does not query when vehicleId is undefined', () => {
    const { result } = renderHook(
      () => useSignalObservations(undefined, { signal_name: 'CruiseSetSpeed' }),
      { wrapper },
    )
    expect(result.current.isFetching).toBe(false)
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})
