/**
 * Fleet Setup hooks — normalizers + subscribe mutation contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
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
import {
  fleetSetupKeys,
  normalizeFleetApiInfo,
  normalizePublicKeyStatus,
  telemetryConfigSummary,
  telemetryErrorsFrom,
  useFleetApiInfo,
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
})

describe('normalizePublicKeyStatus', () => {
  it('defaults missing fields without throwing', () => {
    expect(normalizePublicKeyStatus(null)).toEqual({
      configured: false,
      fingerprint: '',
      well_known_path: '',
      created_at: null,
    })
  })
})

describe('telemetryConfigSummary', () => {
  it('reads nested Tesla response.config.hostname', () => {
    expect(
      telemetryConfigSummary({
        response: { config: { hostname: 'telemetry.example.com', port: 4443, fields: { Soc: {} } } },
      }),
    ).toEqual({ hostname: 'telemetry.example.com', port: 4443, field_count: 1 })
  })

  it('returns empty hostname when Tesla has no config', () => {
    expect(telemetryConfigSummary({ error: 'not found' }).hostname).toBe('')
  })
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
