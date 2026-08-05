// ---------------------------------------------------------------------------
// useTelemetry.ts — full-surface hook contract coverage.
//
// Every runtime export of the module is exercised here: the `telemetryKeys`
// factory, the imperative `getVehicleLiveSignals` helper, all query hooks,
// and both refresh mutations (including their toast + cache-invalidation
// side-effects).
//
// The headline regression pinned below is the AbortSignal-shadowing bug in
// useSignalHistory / useSignalLog / useSignalDiff: the queryFn destructured
// `{ signal }` (the React Query AbortSignal) which shadowed the outer
// `signal` NAME parameter, so the request URL became
// `/signals/1/[object AbortSignal]/history` and the signal name was lost.
// LiveSignalSparklinesWidget consumed useSignalHistory, so every dashboard
// sparkline silently fetched the wrong (non-existent) endpoint.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

// Toast is provided via a hoisted spy object so the refresh mutations can be
// asserted without mounting the real <ToastProvider> (which pulls in
// framer-motion / react-router). vi.hoisted guarantees the spies exist
// before the mock factory runs.
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  toast: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock('@/components/feedback/Toast', () => ({
  useToast: () => toast,
}))

import { request } from '@/api/client'
import {
  telemetryKeys,
  getVehicleLiveSignals,
  useSignals,
  useVehicleLiveSignals,
  useSignalStats,
  useSignalHistory,
  useSignalAnalysisHistory,
  useSignalLog,
  useSignalDiff,
  useSignalSnapshot,
  useSignalDiffServer,
  useSignalGaps,
  useMQTTStatus,
  useSignalCatalog,
  useSignalObservations,
  useFleetTelemetryErrorVINs,
  useFleetTelemetryErrors,
  useRefreshFleetTelemetryErrorVINs,
  useRefreshFleetTelemetryErrors,
  type VehicleLiveSignal,
  type VehicleLiveSignalsResponse,
  type SignalSnapshotResponse,
  type SignalDiffRow,
  type SignalDiffServerResponse,
  type SignalSourceLayer,
  type FleetTelemetryError,
  type FleetTelemetryErrorVIN,
} from '../useTelemetry'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function makeWrapper(client: QueryClient = makeClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const tick = () => new Promise((r) => setTimeout(r, 15))

beforeEach(() => {
  mockedRequest.mockReset()
  toast.success.mockReset()
  toast.error.mockReset()
})

// ── Typed fixtures (also assert every exported type still exists) ─────────────

const liveResponse: VehicleLiveSignalsResponse = {
  vehicle_id: 9,
  count: 1,
  at: 'now',
  signals: {
    BatteryLevel: {
      value: 42,
      timestamp: 't',
      kind: 'ValueKindFloat',
      source: 'l1',
      age_ms: 10,
    } satisfies VehicleLiveSignal,
  },
}

const snapshotResponse: SignalSnapshotResponse = {
  vehicle_id: 1,
  at: 'X',
  count: 1,
  signals: { A: { value: 1, source: 'l1' as SignalSourceLayer, age_ms: 5 } },
}

const diffRow: SignalDiffRow = {
  name: 'A',
  value_a: 1,
  value_b: 2,
  source_a: 'l1',
  source_b: 'log',
  changed: true,
}

const diffServerResponse: SignalDiffServerResponse = {
  vehicle_id: 1,
  at_a: 'A',
  at_b: 'B',
  count: 1,
  data: [diffRow],
}

const errorVins: FleetTelemetryErrorVIN[] = [
  { id: 1, vin: 'VINA', active: true, first_seen_at: '', last_seen_at: '', resolved_at: null },
]

const errors: FleetTelemetryError[] = [
  {
    id: 1,
    vin: 'VINA',
    error_code: 'STREAM_DOWN',
    error_message: 'boom',
    reported_at: null,
    tesla_updated_at: null,
    fetched_at: '2026-01-01T00:00:00Z',
  },
]

// ─── telemetryKeys ────────────────────────────────────────────────────────────

describe('telemetryKeys', () => {
  it('builds stable, domain-scoped query keys', () => {
    expect(telemetryKeys.signals(1)).toEqual(['signals', 1])
    expect(telemetryKeys.liveSignals(2)).toEqual(['live-signals', 2])
    expect(telemetryKeys.liveSignals()).toEqual(['live-signals', undefined])
    expect(telemetryKeys.signalStats(3)).toEqual(['signal-stats', 3])
    expect(telemetryKeys.signalHistory(1, 'Speed', 24)).toEqual(['signal-history', 1, 'Speed', 24])
    expect(telemetryKeys.signalAnalysisHistory(1, 'Speed', 24, 10_000)).toEqual([
      'signal-analysis-history',
      1,
      'Speed',
      24,
      10_000,
    ])
    expect(telemetryKeys.signalLog(1, 'Speed', 24, 2)).toEqual(['signal-log', 1, 'Speed', 24, 2])
    expect(telemetryKeys.signalDiff(1, 'Speed', 'a', 'b')).toEqual(['signal-diff', 1, 'Speed', 'a', 'b'])
    expect(telemetryKeys.signalDiffServer(1, 'a', 'b', 'x,y')).toEqual([
      'signal-diff-server', 1, 'a', 'b', 'x,y',
    ])
    expect(telemetryKeys.signalSnapshot(1, 'a', 'x,y')).toEqual(['signal-snapshot', 1, 'a', 'x,y'])
    expect(telemetryKeys.signalGaps(1)).toEqual(['signal-gaps', 1])
    expect(telemetryKeys.mqttStatus).toEqual(['mqtt-status'])
  })

  it('produces distinct keys for distinct signals/hours (cache isolation)', () => {
    expect(telemetryKeys.signalHistory(1, 'A', 24)).not.toEqual(telemetryKeys.signalHistory(1, 'B', 24))
    expect(telemetryKeys.signalHistory(1, 'A', 1)).not.toEqual(telemetryKeys.signalHistory(1, 'A', 24))
  })
})

// ─── getVehicleLiveSignals (imperative helper) ────────────────────────────────

describe('getVehicleLiveSignals', () => {
  it('GETs /signals/{id}/live and threads the abort signal through', async () => {
    mockedRequest.mockResolvedValueOnce(liveResponse)
    const ac = new AbortController()
    const res = await getVehicleLiveSignals(9, { signal: ac.signal })
    expect(mockedRequest).toHaveBeenCalledWith('/signals/9/live', { signal: ac.signal })
    expect(res.count).toBe(1)
  })

  it('passes signal: undefined when opts are omitted', async () => {
    mockedRequest.mockResolvedValueOnce({ signals: {} })
    await getVehicleLiveSignals(5)
    expect(mockedRequest).toHaveBeenCalledWith('/signals/5/live', { signal: undefined })
  })
})

// ─── useSignals (name-only catalog) ───────────────────────────────────────────

describe('useSignals', () => {
  it('extracts names from the rich post-Phase-42 catalog shape', async () => {
    mockedRequest.mockResolvedValueOnce({
      vehicle_id: 1,
      count: 2,
      signals: [
        { name: 'BatteryLevel', value_kind: 'ValueKindFloat' },
        { name: 'VehicleSpeed', value_kind: 'ValueKindFloat' },
      ],
    })
    const { result } = renderHook(() => useSignals(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(['BatteryLevel', 'VehicleSpeed'])
    expect(mockedRequest.mock.calls[0][0]).toBe('/signals/1/available')
  })

  it('accepts the legacy bare string[] shape and drops malformed entries', async () => {
    mockedRequest.mockResolvedValueOnce(['Alpha', { name: 'Beta' }, { name: 123 }, null, { name: '' }])
    const { result } = renderHook(() => useSignals(2), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(['Alpha', 'Beta'])
  })

  it('returns [] when the signals key is missing', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 1, count: 0 })
    const { result } = renderHook(() => useSignals(3), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
  })

  it('is disabled for vehicleId 0', async () => {
    renderHook(() => useSignals(0), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useVehicleLiveSignals ────────────────────────────────────────────────────

describe('useVehicleLiveSignals', () => {
  it('fetches the live snapshot for a vehicle', async () => {
    mockedRequest.mockResolvedValueOnce(liveResponse)
    const { result } = renderHook(() => useVehicleLiveSignals(9), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/signals/9/live')
    expect(result.current.data?.count).toBe(1)
  })

  it('does not fetch when vehicleId is undefined', async () => {
    renderHook(() => useVehicleLiveSignals(undefined), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('does not fetch when explicitly disabled', async () => {
    renderHook(() => useVehicleLiveSignals(3, { enabled: false }), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useSignalStats ───────────────────────────────────────────────────────────

describe('useSignalStats', () => {
  it('hits /signals/{id}/stats', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicleId: 1, count: 5, oldest: null, newest: null })
    const { result } = renderHook(() => useSignalStats(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/signals/1/stats')
    expect(result.current.data?.count).toBe(5)
  })

  it('is disabled for vehicleId 0', async () => {
    renderHook(() => useSignalStats(0), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useSignalHistory (AbortSignal-shadowing regression) ──────────────────────

describe('useSignalHistory', () => {
  it('puts the signal NAME — not the AbortSignal — in the history URL', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicleId: 1, signal: 'BatteryLevel', from: '', to: '', count: 0, data: [] })
    const { result } = renderHook(() => useSignalHistory(1, 'BatteryLevel', 24), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toBe('/signals/1/BatteryLevel/history?hours=24')
    // The shadowing bug produced this exact corrupted segment.
    expect(url).not.toContain('[object AbortSignal]')
    // The AbortSignal must still be threaded through for cancellation.
    expect(mockedRequest.mock.calls[0][1]).toHaveProperty('signal')
  })

  it('is disabled when the signal name is empty', async () => {
    renderHook(() => useSignalHistory(1, '', 24), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('is disabled when vehicleId is 0', async () => {
    renderHook(() => useSignalHistory(0, 'BatteryLevel', 24), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

describe('useSignalAnalysisHistory', () => {
  it('requests the maximum analytical limit and encodes the signal name', async () => {
    mockedRequest.mockResolvedValueOnce({ data: [], count: 0 })
    const { result } = renderHook(
      () => useSignalAnalysisHistory(1, 'Battery Level', 168),
      { wrapper: makeWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(
      '/signals/1/Battery%20Level/history?hours=168&limit=10000',
    )
    expect(mockedRequest.mock.calls[0]?.[1]).toHaveProperty('signal')
  })

  it('bounds custom hours and limits and stays disabled without a signal', async () => {
    mockedRequest.mockResolvedValueOnce({ data: [], count: 0 })
    const first = renderHook(
      () => useSignalAnalysisHistory(1, 'Speed', 99_999, 99_999),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0]?.[0]).toBe(
      '/signals/1/Speed/history?hours=8760&limit=10000',
    )

    mockedRequest.mockReset()
    renderHook(() => useSignalAnalysisHistory(1, '', 24), { wrapper: makeWrapper() })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useSignalLog (AbortSignal-shadowing regression + pagination) ─────────────

describe('useSignalLog', () => {
  it('includes the signal name, page and page_size in the URL', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicleId: 1, signal: 'Gear', from: '', to: '', count: 0, data: [] })
    const { result } = renderHook(() => useSignalLog(1, 'Gear', 6, 2, 50), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toBe('/signals/1/Gear/history?hours=6&page=2&page_size=50')
    expect(url).not.toContain('[object AbortSignal]')
  })

  it('is disabled without a signal name', async () => {
    renderHook(() => useSignalLog(1, '', 6, 1, 25), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useSignalDiff (AbortSignal-shadowing regression + from/to) ───────────────

describe('useSignalDiff', () => {
  it('includes the signal name and the from/to window in the URL', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicleId: 1, signal: 'Odometer', from: 'A', to: 'B', count: 0, data: [] })
    const { result } = renderHook(
      () => useSignalDiff(1, 'Odometer', '2026-01-01', '2026-01-02'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toBe('/signals/1/Odometer/history?from=2026-01-01&to=2026-01-02')
    expect(url).not.toContain('[object AbortSignal]')
  })

  it('stays disabled until both from and to are supplied', async () => {
    renderHook(() => useSignalDiff(1, 'Odometer', '', ''), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useSignalSnapshot ────────────────────────────────────────────────────────

describe('useSignalSnapshot', () => {
  it('builds the snapshot URL with url-encoded at + signals params', async () => {
    mockedRequest.mockResolvedValueOnce(snapshotResponse)
    const { result } = renderHook(
      () => useSignalSnapshot(1, '2026-01-01T00:00:00Z', 'A,B'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toContain('/signals/1/snapshot?')
    expect(url).toContain('at=2026-01-01T00%3A00%3A00Z')
    expect(url).toContain('signals=A%2CB')
    expect(result.current.data?.signals.A.value).toBe(1)
  })

  it('omits the query string entirely for a live snapshot (empty at, no csv)', async () => {
    mockedRequest.mockResolvedValueOnce({ vehicle_id: 1, count: 0, signals: {} })
    renderHook(() => useSignalSnapshot(1, ''), { wrapper: makeWrapper() })
    await waitFor(() => expect(mockedRequest).toHaveBeenCalled())
    expect(mockedRequest.mock.calls[0][0]).toBe('/signals/1/snapshot')
  })

  it('respects the enabled:false option', async () => {
    renderHook(() => useSignalSnapshot(1, '', '', { enabled: false }), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useSignalDiffServer ──────────────────────────────────────────────────────

describe('useSignalDiffServer', () => {
  it('builds the server-diff URL with at_a, at_b and signals', async () => {
    mockedRequest.mockResolvedValueOnce(diffServerResponse)
    const { result } = renderHook(
      () => useSignalDiffServer(1, 'A', 'B', 'X'),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toContain('/signals/1/diff?')
    expect(url).toContain('at_a=A')
    expect(url).toContain('at_b=B')
    expect(url).toContain('signals=X')
    expect(result.current.data?.data[0].changed).toBe(true)
  })

  it('is disabled until both endpoints are provided', async () => {
    renderHook(() => useSignalDiffServer(1, '', 'B'), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── useSignalGaps ────────────────────────────────────────────────────────────

describe('useSignalGaps', () => {
  it('unwraps the live signals map from /signals/{id}/live', async () => {
    mockedRequest.mockResolvedValueOnce({ signals: { Foo: { value: 1, timestamp: 't' } } })
    const { result } = renderHook(() => useSignalGaps(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/signals/1/live')
    expect(result.current.data).toEqual({ Foo: { value: 1, timestamp: 't' } })
  })

  it('defaults to an empty object when signals is absent', async () => {
    mockedRequest.mockResolvedValueOnce({})
    const { result } = renderHook(() => useSignalGaps(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({})
  })
})

// ─── useMQTTStatus (Record<vin,state> → array normalization) ──────────────────

describe('useMQTTStatus', () => {
  it('normalizes a Record<vin, state> into a vehicles array with camelCase counts', async () => {
    mockedRequest.mockResolvedValueOnce({
      connected: true,
      uptime_seconds: 42,
      vehicles: {
        '5YJVIN': { signal_count: 10, batch_count: 2, signals_per_second: 3, last_received: 'now' },
      },
    })
    const { result } = renderHook(() => useMQTTStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/telemetry')
    const vehicles = result.current.data!.vehicles
    expect(vehicles).toHaveLength(1)
    expect(vehicles[0].vin).toBe('5YJVIN')
    expect(vehicles[0].signalCount).toBe(10)
    expect(vehicles[0].batchCount).toBe(2)
    expect(result.current.data!.uptimeSeconds).toBe(42)
  })

  it('passes an already-array vehicles payload through unchanged', async () => {
    mockedRequest.mockResolvedValueOnce({
      connected: true,
      vehicles: [{ vin: 'A', signalCount: 1, batchCount: 1 }],
    })
    const { result } = renderHook(() => useMQTTStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.vehicles[0].vin).toBe('A')
  })

  it('falls back to streaming_vehicles and defaults missing counts to 0', async () => {
    mockedRequest.mockResolvedValueOnce({
      connected: false,
      streaming_vehicles: { VIN2: { state: 'online' } },
    })
    const { result } = renderHook(() => useMQTTStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const vehicles = result.current.data!.vehicles
    expect(vehicles[0].vin).toBe('VIN2')
    expect(vehicles[0].signalCount).toBe(0)
    expect(vehicles[0].batchCount).toBe(0)
  })

  it('yields an empty vehicles array when none are present', async () => {
    mockedRequest.mockResolvedValueOnce({ connected: false })
    const { result } = renderHook(() => useMQTTStatus(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.vehicles).toEqual([])
  })
})

// ─── useSignalCatalog (deprecated 404 endpoint) ───────────────────────────────

describe('useSignalCatalog', () => {
  it('requests the deprecated /signals/catalog route', async () => {
    mockedRequest.mockResolvedValueOnce([{ name: 'X' }])
    const { result } = renderHook(() => useSignalCatalog(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/signals/catalog')
  })

  it('surfaces the 404 the deprecated endpoint reliably returns as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('404 not found'))
    const { result } = renderHook(() => useSignalCatalog(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

// ─── useSignalObservations (contract-drift adapter) ───────────────────────────

describe('useSignalObservations', () => {
  it('sends field= (never signal_name=) on the wire', async () => {
    mockedRequest.mockResolvedValueOnce({ count: 0, total: 0, observations: [] })
    const { result } = renderHook(
      () => useSignalObservations(1, { signal_name: 'CruiseSetSpeed', limit: 1 }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toContain('field=CruiseSetSpeed')
    expect(url).not.toContain('signal_name=')
    expect(url).toContain('vehicle_id=1')
  })

  it('unwraps the envelope and routes ValueKinds into legacy columns', async () => {
    mockedRequest.mockResolvedValueOnce({
      count: 3,
      total: 3,
      observations: [
        { vehicle_id: 1, ts: 't0', field: 'A', value_kind: 'ValueKindDouble', value: 11.5 },
        { vehicle_id: 1, ts: 't1', field: 'B', value_kind: 'ValueKindEnum', value: 'FollowDistance7' },
        { vehicleId: 1, ts: 't2', field: 'C', valueKind: 'ValueKindBool', value: true },
      ],
    })
    const { result } = renderHook(() => useSignalObservations(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const rows = result.current.data!
    expect(rows[0].value_numeric).toBe(11.5)
    expect(rows[1].value_text).toBe('FollowDistance7')
    expect(rows[2].value_bool).toBe(true)
    expect(rows[2].vehicle_id).toBe(1)
  })

  it('coerces a null numeric to null (never 0) and defaults source', async () => {
    mockedRequest.mockResolvedValueOnce({
      observations: [{ vehicle_id: 1, ts: 't0', field: 'A', value_kind: 'ValueKindFloat', value: null }],
    })
    const { result } = renderHook(() => useSignalObservations(1), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data![0].value_numeric).toBeNull()
    expect(result.current.data![0].source).toBe('fleet_telemetry')
  })

  it('does not query when vehicleId is undefined', async () => {
    renderHook(() => useSignalObservations(undefined, { signal_name: 'X' }), { wrapper: makeWrapper() })
    await tick()
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

// ─── Fleet Telemetry error hooks ──────────────────────────────────────────────

describe('useFleetTelemetryErrorVINs', () => {
  it('lists error VINs from /tesla/fleet-telemetry/error-vins', async () => {
    mockedRequest.mockResolvedValueOnce(errorVins)
    const { result } = renderHook(() => useFleetTelemetryErrorVINs(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/tesla/fleet-telemetry/error-vins')
    expect(result.current.data?.[0].vin).toBe('VINA')
  })
})

describe('useFleetTelemetryErrors', () => {
  it('lists all errors when no vin filter is given', async () => {
    mockedRequest.mockResolvedValueOnce(errors)
    const { result } = renderHook(() => useFleetTelemetryErrors(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/tesla/fleet-telemetry/errors')
    expect(result.current.data?.[0].error_code).toBe('STREAM_DOWN')
  })

  it('appends the vin query param when filtering', async () => {
    mockedRequest.mockResolvedValueOnce([])
    const { result } = renderHook(() => useFleetTelemetryErrors('5YJ3'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest.mock.calls[0][0]).toBe('/tesla/fleet-telemetry/errors?vin=5YJ3')
  })
})

// ─── Refresh mutations (POST + invalidation + toast side-effects) ─────────────

describe('useRefreshFleetTelemetryErrorVINs', () => {
  it('POSTs the refresh endpoint, invalidates the list, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    const client = makeClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRefreshFleetTelemetryErrorVINs(), {
      wrapper: makeWrapper(client),
    })
    await result.current.mutateAsync()
    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/tesla/fleet-telemetry/error-vins/refresh')
    expect((opts as { method?: string }).method).toBe('POST')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fleet-telemetry-error-vins'] })
    expect(toast.success).toHaveBeenCalledWith('Telemetry error VINs refreshed')
  })

  it('toasts a contextual error message on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('nope'))
    const { result } = renderHook(() => useRefreshFleetTelemetryErrorVINs(), {
      wrapper: makeWrapper(),
    })
    await expect(result.current.mutateAsync()).rejects.toThrow('nope')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to refresh error VINs: nope'),
    )
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('useRefreshFleetTelemetryErrors', () => {
  it('POSTs the errors refresh endpoint, invalidates, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    const client = makeClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRefreshFleetTelemetryErrors(), {
      wrapper: makeWrapper(client),
    })
    await result.current.mutateAsync()
    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/tesla/fleet-telemetry/errors/refresh')
    expect((opts as { method?: string }).method).toBe('POST')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['fleet-telemetry-errors'] })
    expect(toast.success).toHaveBeenCalledWith('Telemetry errors refreshed')
  })

  it('toasts a contextual error message on failure', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('down'))
    const { result } = renderHook(() => useRefreshFleetTelemetryErrors(), {
      wrapper: makeWrapper(),
    })
    await expect(result.current.mutateAsync()).rejects.toThrow('down')
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to refresh telemetry errors: down'),
    )
  })
})
