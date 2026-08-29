import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useAvailableSignals,
  useLiveSignals,
  useSignalHistory,
  useTransportAgreement,
  normalizeSignalKind,
  normalizeUnitKind,
  normalizeEnvelope,
} from '../useSignals'

const requestMock = vi.fn()
vi.mock('../../client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}))

function makeWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('normalizeSignalKind', () => {
  it('maps long-form ValueKind strings into the compact union', () => {
    expect(normalizeSignalKind('ValueKindFloat')).toBe('float')
    expect(normalizeSignalKind('ValueKindDouble')).toBe('float')
    expect(normalizeSignalKind('ValueKindInt32')).toBe('int')
    expect(normalizeSignalKind('ValueKindInt64')).toBe('int')
    expect(normalizeSignalKind('ValueKindEnum')).toBe('int')
    expect(normalizeSignalKind('ValueKindBool')).toBe('bool')
    expect(normalizeSignalKind('ValueKindString')).toBe('string')
    expect(normalizeSignalKind('ValueKindTime')).toBe('time')
    expect(normalizeSignalKind('ValueKindUnknown')).toBe('unknown')
  })

  it('maps the SSE wire-format integers into the same compact union', () => {
    expect(normalizeSignalKind(5)).toBe('float')   // ValueKindFloat iota
    expect(normalizeSignalKind(2)).toBe('bool')
    expect(normalizeSignalKind(3)).toBe('int')
    expect(normalizeSignalKind(9)).toBe('time')
    expect(normalizeSignalKind(0)).toBe('unknown') // ValueKindUnknown
  })

  it('passes already-normalized compact tokens through unchanged', () => {
    expect(normalizeSignalKind('float')).toBe('float')
    expect(normalizeSignalKind('bool')).toBe('bool')
  })

  it('falls back to "unknown" for garbage', () => {
    expect(normalizeSignalKind(undefined)).toBe('unknown')
    expect(normalizeSignalKind(null)).toBe('unknown')
    expect(normalizeSignalKind('not-a-kind')).toBe('unknown')
  })
})

describe('normalizeUnitKind', () => {
  it('maps long-form UnitKind strings into the compact union', () => {
    expect(normalizeUnitKind('UnitKindNone')).toBe('none')
    expect(normalizeUnitKind('UnitKindDistance')).toBe('distance')
    expect(normalizeUnitKind('UnitKindTemperature')).toBe('temperature')
    expect(normalizeUnitKind('UnitKindPressure')).toBe('pressure')
    expect(normalizeUnitKind('UnitKindCharge')).toBe('charge')
  })

  it('falls back to "none" for unknown values', () => {
    expect(normalizeUnitKind(42)).toBe('none')
    expect(normalizeUnitKind('UnitKindMystery')).toBe('none')
  })
})

describe('normalizeEnvelope', () => {
  it('preserves the typed primitive matching kind', () => {
    expect(normalizeEnvelope({ kind: 'ValueKindFloat', value: 27.7, ts: 'T' }))
      .toEqual({ kind: 'float', value: 27.7, ts: 'T' })
    expect(normalizeEnvelope({ kind: 'ValueKindBool', value: true, ts: 'T' }))
      .toEqual({ kind: 'bool', value: true, ts: 'T' })
    expect(normalizeEnvelope({ kind: 'ValueKindString', value: 'P', ts: 'T' }))
      .toEqual({ kind: 'string', value: 'P', ts: 'T' })
  })

  it('returns a sentinel envelope for null input', () => {
    expect(normalizeEnvelope(null)).toEqual({ kind: 'unknown', value: null, ts: '' })
    expect(normalizeEnvelope(undefined)).toEqual({ kind: 'unknown', value: null, ts: '' })
  })

  it('coerces numeric strings into typed numbers when kind is float/int', () => {
    expect(normalizeEnvelope({ kind: 'ValueKindFloat', value: '27.7', ts: 'T' }).value).toBe(27.7)
    expect(normalizeEnvelope({ kind: 'ValueKindInt32', value: '5', ts: 'T' }).value).toBe(5)
  })

  it('returns null when a numeric kind cannot be coerced from a string', () => {
    expect(normalizeEnvelope({ kind: 'ValueKindFloat', value: 'NaNish', ts: 'T' }).value).toBeNull()
  })
})

describe('useAvailableSignals', () => {
  beforeEach(() => requestMock.mockReset())

  it('hits /signals/{vid}/available without the /api/v1 prefix', async () => {
    requestMock.mockResolvedValue({
      vehicle_id: 7,
      count: 1,
      source: 'protomodel',
      signals: [
        {
          name: 'VehicleSpeed',
          category: 'driving',
          value_kind: 'ValueKindFloat',
          unit_kind: 'UnitKindDistance',
          is_compound: false,
          is_setting_unit: false,
        },
      ],
    })
    const { result } = renderHook(() => useAvailableSignals(7), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith('/signals/7/available', expect.anything())
    const desc = result.current.data?.signals?.[0]
    expect(desc?.value_kind).toBe('float')
    expect(desc?.unit_kind).toBe('distance')
    expect(desc?.is_setting_unit).toBe(false)
  })

  it('skips the request when vehicleId is invalid', () => {
    renderHook(() => useAvailableSignals(0), { wrapper: makeWrapper() })
    expect(requestMock).not.toHaveBeenCalled()
  })
})

describe('useLiveSignals', () => {
  beforeEach(() => requestMock.mockReset())

  it('returns typed primitives keyed by field name', async () => {
    requestMock.mockResolvedValue({
      vehicle_id: 7,
      count: 2,
      at: '2026-01-01T00:00:00Z',
      signals: {
        VehicleSpeed: { kind: 'ValueKindFloat', value: 27.7, ts: '2026-01-01T00:00:00Z' },
        Locked: { kind: 'ValueKindBool', value: true, ts: '2026-01-01T00:00:00Z' },
      },
    })
    const { result } = renderHook(() => useLiveSignals(7), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(requestMock).toHaveBeenCalledWith('/signals/7/live', expect.anything())
    const speed = result.current.data?.signals.VehicleSpeed
    expect(typeof speed?.value).toBe('number')
    expect(speed?.value).toBe(27.7)
    expect(speed?.kind).toBe('float')
    const locked = result.current.data?.signals.Locked
    expect(typeof locked?.value).toBe('boolean')
    expect(locked?.kind).toBe('bool')
  })
})

describe('useSignalHistory', () => {
  beforeEach(() => requestMock.mockReset())

  it('serialises hours as a snake_case query param', async () => {
    requestMock.mockResolvedValue({
      vehicle_id: 7,
      signal: 'VehicleSpeed',
      expected_kind: 'ValueKindFloat',
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-02T00:00:00Z',
      count: 1,
      data: [{
        kind: 'ValueKindFloat',
        value: 27.7,
        ts: '2026-01-01T00:00:00Z',
        ingest_origin: 'fleet_telemetry_mqtt',
        source_emitted_at: null,
        received_at: '2026-01-01T00:00:01Z',
        normalization_version: 1,
      }],
    })
    const { result } = renderHook(
      () => useSignalHistory(7, 'VehicleSpeed', { hours: 24 }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = requestMock.mock.calls[0]?.[0] as string
    expect(url.startsWith('/signals/7/VehicleSpeed/history?')).toBe(true)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('hours')).toBe('24')
    const point = result.current.data?.data?.[0]
    expect(point?.kind).toBe('float')
    expect(point?.value).toBe(27.7)
    expect(point?.ingest_origin).toBe('fleet_telemetry_mqtt')
    expect(point?.source_emitted_at).toBeNull()
    expect(point?.normalization_version).toBe(1)
  })

  it('prefers explicit from/to when both are supplied', async () => {
    requestMock.mockResolvedValue({
      vehicle_id: 7,
      signal: 'VehicleSpeed',
      expected_kind: 'ValueKindFloat',
      from: 'A',
      to: 'B',
      count: 0,
      data: [],
    })
    const { result } = renderHook(
      () => useSignalHistory(7, 'VehicleSpeed', { from: 'A', to: 'B', limit: 100 }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = requestMock.mock.calls[0]?.[0] as string
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('from')).toBe('A')
    expect(params.get('to')).toBe('B')
    expect(params.get('limit')).toBe('100')
    expect(params.has('hours')).toBe(false)
  })

  it('skips the request when signal name is empty', () => {
    renderHook(() => useSignalHistory(7, ''), { wrapper: makeWrapper() })
    expect(requestMock).not.toHaveBeenCalled()
  })
})

describe('useTransportAgreement', () => {
  beforeEach(() => requestMock.mockReset())

  it('uses the static route with encoded source-time parameters', async () => {
    requestMock.mockResolvedValue({
      vehicle_id: 7,
      from: '2026-08-27T00:00:00Z',
      to: '2026-08-28T00:00:00Z',
      pair_tolerance_ms: 2000,
      row_limit: 10000,
      truncated: false,
      source_time_only: true,
      generated_at: '2026-08-28T00:00:01Z',
      status: 'insufficient_overlap',
      agreement_pct: null,
      scanned_rows: 1,
      invalid_value_rows: 0,
      http_evidence_rows: 0,
      mqtt_evidence_rows: 1,
      comparable_pairs: 0,
      agreeing_pairs: 0,
      disagreeing_pairs: 0,
      fields: [],
    })
    const { result } = renderHook(
      () => useTransportAgreement(7, {
        from: '2026-08-27T00:00:00Z',
        to: '2026-08-28T00:00:00Z',
      }),
      { wrapper: makeWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const url = requestMock.mock.calls[0]?.[0] as string
    expect(url.startsWith('/signals/7/transport-agreement?')).toBe(true)
    expect(url).not.toContain('/api/v1')
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('from')).toBe('2026-08-27T00:00:00Z')
    expect(params.get('to')).toBe('2026-08-28T00:00:00Z')
    expect(params.has('hours')).toBe(false)
  })

  it('does not request without a valid vehicle', () => {
    renderHook(() => useTransportAgreement(0), { wrapper: makeWrapper() })
    expect(requestMock).not.toHaveBeenCalled()
  })
})
