/**
 * Fleet Setup hooks — normalizers + subscribe mutation contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}))
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}))

const { invalidateAndBroadcast } = vi.hoisted(() => ({
  invalidateAndBroadcast: vi.fn(),
}))
vi.mock('@/lib/queryBroadcast', () => ({ invalidateAndBroadcast }))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, request: vi.fn() }
})

import { request } from '../client'
import { deriveDataState, type DataStateSource } from '../dataState'
import { normalizeOnboardingStatus } from './useOnboarding'
import {
  fleetSetupKeys,
  normalizeFleetApiInfo,
  normalizePublicKeyStatus,
  telemetryConfigSummary,
  telemetryErrorsFrom,
  useFleetApiInfo,
  usePublicKeyStatus,
  useFleetTelemetryConfig,
  useFleetTelemetryErrors,
  useSubscribeFleetTelemetry,
  useUnsubscribeFleetTelemetry,
} from './useFleetSetup'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { Wrapper, qc }
}

beforeEach(() => {
  mockedRequest.mockReset()
  successToast.mockReset()
  errorToast.mockReset()
  invalidateAndBroadcast.mockReset()
})

describe('normalizeFleetApiInfo', () => {
  it('reads snake_case first and falls back to camelCase aliases', () => {
    expect(
      normalizeFleetApiInfo({
        baseUrl: 'https://fleet-api.example',
        client_id: 'abc',
        hasValidToken: true,
        publicKeyUrl: 'https://example/.well-known/key.pem',
      }),
    ).toEqual({
      base_url: 'https://fleet-api.example',
      client_id: 'abc',
      has_valid_token: true,
      public_key_url: 'https://example/.well-known/key.pem',
      hostname: undefined,
    })
  })

  it('treats authenticated as a token alias used by older payloads', () => {
    expect(normalizeFleetApiInfo({ authenticated: true }).has_valid_token).toBe(true)
  })

  it('preserves authoritative false ahead of aliases', () => {
    expect(normalizeFleetApiInfo({ has_valid_token: false, hasValidToken: true }).has_valid_token).toBe(false)
  })

  it.each([null, {}, [], { has_valid_token: 'false' }, { response: { has_valid_token: true } }])(
    'rejects unsupported Fleet API info instead of confirming an invalid token: %j', (raw) => {
      expect(() => normalizeFleetApiInfo(raw)).toThrow('Invalid Fleet API info response')
    },
  )
})

describe('normalizePublicKeyStatus', () => {
  it('preserves the supported minimal authoritative false response', () => {
    expect(normalizePublicKeyStatus({ configured: false })).toEqual({
      configured: false,
      fingerprint: '',
      well_known_path: '',
      created_at: null,
    })
  })

  it('preserves populated camelCase metadata', () => {
    expect(normalizePublicKeyStatus({
      configured: true, fingerprint: 'fingerprint', wellKnownPath: '/key.pem', createdAt: '2026-04-01',
    })).toEqual({
      configured: true, fingerprint: 'fingerprint', well_known_path: '/key.pem', created_at: '2026-04-01',
    })
  })

  it.each([null, {}, [], { configured: 0 }, { response: { configured: false } }])(
    'rejects unsupported public key status: %j', (raw) => {
      expect(() => normalizePublicKeyStatus(raw)).toThrow('Invalid public key status response')
    },
  )
})

describe('telemetryConfigSummary', () => {
  it('reads nested Tesla response.config.hostname', () => {
    expect(
      telemetryConfigSummary({
        response: { config: { hostname: 'telemetry.example.com', port: 4443, fields: { Soc: {} } } },
      }),
    ).toEqual({ hostname: 'telemetry.example.com', port: 4443, field_count: 1 })
  })

  it.each([{ config: {} }, { config: null }, { response: { config: {} } }, { response: { config: null } }])(
    'recognizes an explicit empty config: %j', (raw) => {
      expect(telemetryConfigSummary(raw)).toEqual({ hostname: '', port: null, field_count: 0 })
    },
  )

  it.each([null, {}, { error: 'not found' }, { response: {} }, { config: [] }, { config: { hostname: false } }])(
    'does not turn an unavailable parse into an authoritative empty config: %j', (raw) => {
      expect(telemetryConfigSummary(raw)).toEqual({ hostname: null, port: null, field_count: null })
    },
  )

  it.each([
    { config: { hostname: 'telemetry.example.com', port: 4443, fields: ['Soc'] } },
    { hostname: 'telemetry.example.com', port: 4443, fields: { Soc: {} } },
  ])('preserves root config and flat config envelopes: %j', (raw) => {
    expect(telemetryConfigSummary(raw)).toEqual({ hostname: 'telemetry.example.com', port: 4443, field_count: 1 })
  })

})

interface SetupQuery extends DataStateSource<unknown> {
  isSuccess: boolean
  isError: boolean
  refetch: () => Promise<unknown>
}

const readCases: {
  name: string
  hook: () => SetupQuery
  key: readonly string[]
  populated: unknown
  empty: unknown
}[] = [
  { name: 'Fleet API info', hook: useFleetApiInfo, key: fleetSetupKeys.apiInfo,
    populated: { has_valid_token: true }, empty: { has_valid_token: false } },
  { name: 'public key', hook: usePublicKeyStatus, key: fleetSetupKeys.publicKey,
    populated: { configured: true, fingerprint: 'key' }, empty: { configured: false } },
  { name: 'telemetry config', hook: function useTelemetryConfig() { return useFleetTelemetryConfig(' VIN '); }, key: fleetSetupKeys.telemetryConfig('VIN'),
    populated: { response: { config: { hostname: 'telemetry.example.com', fields: { Soc: {} } } } },
    empty: { response: { config: null } } },
  { name: 'telemetry errors', hook: function useTelemetryErrors() { return useFleetTelemetryErrors(' VIN '); }, key: fleetSetupKeys.telemetryErrors('VIN'),
    populated: { response: { errors: [{ code: 'tls_error', message: 'certificate failed' }] } },
    empty: { response: { errors: [] } } },
]

describe.each(readCases)('$name query trust', ({ hook, key, populated, empty }) => {
  it('reports malformed initial responses through the existing fatal-error API', async () => {
    mockedRequest.mockResolvedValue({})
    const { Wrapper, qc } = makeWrapper()
    const { result } = renderHook(hook, { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const state = deriveDataState(result.current)
    expect(state.status).toBe('initialFailure')
    expect(state.hasData).toBe(false)
    expect(state.fatalError).toBeInstanceOf(Error)
    expect(qc.getQueryData(key)).toBeUndefined()
  })

  it('retains populated data and last success on parse failure, then accepts an authoritative false/empty', async () => {
    mockedRequest.mockResolvedValueOnce(populated)
    const { Wrapper, qc } = makeWrapper()
    const { result } = renderHook(hook, { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const retained = result.current.data
    const updatedAt = result.current.dataUpdatedAt
    expect(qc.getQueryData(key)).toEqual(populated)
    mockedRequest.mockResolvedValueOnce({})
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const state = deriveDataState(result.current)
    expect(state.status).toBe('stale')
    expect(state.data).toEqual(retained)
    expect(state.updatedAt).toBe(updatedAt)
    expect(state.refreshError).toBeInstanceOf(Error)
    expect(state.fatalError).toBeNull()
    expect(qc.getQueryData(key)).toEqual(populated)
    mockedRequest.mockResolvedValueOnce(empty)
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(deriveDataState(result.current).refreshError).toBeNull()
    expect(qc.getQueryData(key)).toEqual(empty)
    expect(result.current.data).not.toEqual(retained)
  })
})

it('keeps onboarding gate pessimism separate from setup read parsing', () => {
  expect(normalizeOnboardingStatus(null).setup_required).toBe(true)
  expect(normalizeOnboardingStatus({}).setup_complete).toBe(false)
})

describe('useFleetApiInfo', () => {
  it('GETs /dev-tools/fleet-api-info without an /api/v1 prefix', async () => {
    mockedRequest.mockResolvedValue({
      base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
      client_id: 'cid',
      has_valid_token: true,
      public_key_url: 'https://example/.well-known/appspecific/com.tesla.3p.public-key.pem',
    })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useFleetApiInfo(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest).toHaveBeenCalledWith(
      '/dev-tools/fleet-api-info',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.data?.has_valid_token).toBe(true)
  })
})

describe('useSubscribeFleetTelemetry', () => {
  it('POSTs vins only when host/port/ca are blank so the server fills defaults', async () => {
    mockedRequest.mockResolvedValue({ status: 'ok' })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSubscribeFleetTelemetry(), { wrapper: Wrapper })
    result.current.mutate({ vins: ['5YJ3E1EA7KF000001'] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest).toHaveBeenCalledWith(
      '/dev-tools/fleet-telemetry-subscribe',
      expect.objectContaining({
        method: 'POST',
        requiresLiveMode: true,
        body: JSON.stringify({ vins: ['5YJ3E1EA7KF000001'] }),
      }),
    )
    expect(invalidateAndBroadcast).toHaveBeenCalledWith(
      expect.anything(),
      { queryKey: fleetSetupKeys.telemetryConfig('5YJ3E1EA7KF000001') },
    )
    expect(successToast).toHaveBeenCalled()
  })

  it('POSTs fields and field_intervals when the picker supplies them', async () => {
    mockedRequest.mockResolvedValue({ status: 'ok' })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useSubscribeFleetTelemetry(), { wrapper: Wrapper })
    result.current.mutate({
      vins: ['5YJ3E1EA7KF000001'],
      fields: ['Soc', 'VehicleSpeed'],
      interval_seconds: 10,
      field_intervals: { VehicleSpeed: 1 },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest).toHaveBeenCalledWith(
      '/dev-tools/fleet-telemetry-subscribe',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          vins: ['5YJ3E1EA7KF000001'],
          fields: ['Soc', 'VehicleSpeed'],
          interval_seconds: 10,
          field_intervals: { VehicleSpeed: 1 },
        }),
      }),
    )
  })
})

describe('telemetryErrorsFrom', () => {
  it('reads Tesla response.errors envelopes', () => {
    expect(
      telemetryErrorsFrom({
        response: {
          errors: [
            { error_code: 'tls_error', error_message: 'certificate verify failed', reported_at: '2026-04-01T00:00:00Z' },
          ],
        },
      }),
    ).toEqual([
      {
        code: 'tls_error',
        message: 'certificate verify failed',
        timestamp: '2026-04-01T00:00:00Z',
      },
    ])
  })

  it('returns [] when Tesla reports no errors', () => {
    expect(telemetryErrorsFrom({ response: { errors: [] } })).toEqual([])
  })

  it.each([[], { errors: [] }, { response: [] }])('pins supported empty array envelopes: %j', (raw) => {
    expect(telemetryErrorsFrom(raw)).toEqual([])
  })

  it.each([null, {}, { response: {} }, { errors: null }, { errors: 'none' }, [null], [{}], [{ timestamp: '2026-04-01' }]])(
    'rejects unavailable errors instead of reporting a clean VIN: %j', (raw) => {
      expect(() => telemetryErrorsFrom(raw)).toThrow('Invalid telemetry errors response')
    },
  )

  it.each([
    [{ error_code: 42, error_message: 'failed', reported_at: '2026-04-01' }],
    { errors: [{ code: 42, message: 'failed', timestamp: '2026-04-01' }] },
    { response: [{ topic: 42, body: 'failed', ts: '2026-04-01' }] },
  ])('preserves populated supported envelopes and numeric codes: %j', (raw) => {
    expect(telemetryErrorsFrom(raw)).toEqual([{ code: '42', message: 'failed', timestamp: '2026-04-01' }])
  })
})

describe('useUnsubscribeFleetTelemetry', () => {
  it('DELETEs fleet-telemetry-config with snake_case vin', async () => {
    mockedRequest.mockResolvedValue({ status: 'ok' })
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUnsubscribeFleetTelemetry(), { wrapper: Wrapper })
    result.current.mutate('5YJ3E1EA7KF000001')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockedRequest).toHaveBeenCalledWith(
      '/dev-tools/fleet-telemetry-config?vin=5YJ3E1EA7KF000001',
      expect.objectContaining({
        method: 'DELETE',
        requiresLiveMode: true,
      }),
    )
  })
})
