// useVehicleSettings hook-suite tests.
//
// Covers EVERY export of useVehicleSettings.ts:
//   - vehicleSettingsKeys        — stable, per-vehicle query-key factory.
//   - useVehicleSettings         — GET /vehicles/{id}/settings, AbortSignal
//     threading, no /api/v1 double-prefix, the enabled-gate (0 / NaN / negative
//     ids and options.enabled=false never fetch), the `select` normalisation
//     that folds a null / non-array envelope down to { settings: [] }, and an
//     error path.
//   - useUpsertVehicleSetting    — PUT with { value } body, key URL-encoding,
//     verbatim value forwarding (string | number | boolean), dual-cache
//     invalidation (per-vehicle settings AND parent vehicle detail), and the
//     success/error toast wiring.
//   - useResetVehicleSetting     — DELETE, key URL-encoding, idempotent 204,
//     dual-cache invalidation, success/error toast wiring.
//   - findEffectiveSetting       — selector: match (incl. `source`), absent key,
//     undefined payload, and the hardened non-array / null-entry guards.
//   - EffectiveSetting / VehicleSettingValue / VehicleSettingsResponse —
//     imported straight from the hook module to prove the type re-export.
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so each handler's exact i18n key + English fallback is
// asserted without mounting a ToastProvider / i18n instance. The real
// invalidateAndBroadcast runs against the test QueryClient (spied) and its
// coalesced cross-tab timer is drained in afterEach.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { successToast, errorToast } = vi.hoisted(() => ({
  successToast: vi.fn(),
  errorToast: vi.fn(),
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

// Replace the toast bridge with spies so onSuccess/onError assertions are exact
// and no ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}))

import { ApiError, request } from '@/api/client'
import { __flushQueryBroadcastForTests } from '@/lib/queryBroadcast'
import { vehicleKeys } from './useVehicles'
import {
  vehicleSettingsKeys,
  useVehicleSettings,
  useUpsertVehicleSetting,
  useResetVehicleSetting,
  findEffectiveSetting,
  type EffectiveSetting,
  type VehicleSettingValue,
  type VehicleSettingsResponse,
} from './useVehicleSettings'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { Wrapper, qc }
}

function makeSetting(overrides: Partial<EffectiveSetting> = {}): EffectiveSetting {
  return {
    key: 'nickname',
    value: 'Batmobile',
    source: 'override',
    ...overrides,
  }
}

beforeEach(() => {
  mockedRequest.mockReset()
  successToast.mockReset()
  errorToast.mockReset()
})

afterEach(() => {
  // Drain the coalesced cross-tab broadcast timer scheduled by
  // invalidateAndBroadcast so it can't fire after the env tears down.
  __flushQueryBroadcastForTests()
})

// ---------------------------------------------------------------------------
// Key factory
// ---------------------------------------------------------------------------

describe('vehicleSettingsKeys', () => {
  it('exposes a stable namespace root and a per-vehicle detail tuple', () => {
    expect(vehicleSettingsKeys.all).toEqual(['vehicle-settings'])
    expect(vehicleSettingsKeys.detail(7)).toEqual(['vehicle-settings', 7])
  })

  it('scopes distinct vehicles into non-colliding cache keys', () => {
    expect(vehicleSettingsKeys.detail(7)).not.toEqual(vehicleSettingsKeys.detail(8))
  })
})

// ---------------------------------------------------------------------------
// useVehicleSettings (query)
// ---------------------------------------------------------------------------

describe('useVehicleSettings', () => {
  it('GETs /vehicles/{id}/settings, threads the abort signal, and returns the payload', async () => {
    const payload: VehicleSettingsResponse = {
      settings: [makeSetting({ key: 'nickname' }), makeSetting({ key: 'mute_until', source: 'user' })],
    }
    mockedRequest.mockResolvedValueOnce(payload)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useVehicleSettings(7), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(payload)
    expect(result.current.data?.settings).toHaveLength(2)

    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/vehicles/7/settings')
    // No double-prefix — the request() client adds /api/v1 itself.
    expect(url).not.toContain('/api/v1')
    // TanStack Query hands the queryFn an AbortSignal so route changes cancel
    // the in-flight fetch; the hook must forward it to request().
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('normalises a null envelope down to { settings: [] } so consumers can iterate without a presence check', async () => {
    mockedRequest.mockResolvedValueOnce(null)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useVehicleSettings(7), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ settings: [] })
    expect(Array.isArray(result.current.data?.settings)).toBe(true)
  })

  it('coerces a malformed non-array `settings` to [] via the select guard', async () => {
    mockedRequest.mockResolvedValueOnce({ settings: { nope: true } })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useVehicleSettings(7), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ settings: [] })
  })

  it('passes a well-formed settings array through select untouched', async () => {
    const rows = [makeSetting({ key: 'units_distance', value: 'km', source: 'default' })]
    mockedRequest.mockResolvedValueOnce({ settings: rows })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useVehicleSettings(7), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.settings).toEqual(rows)
  })

  it('is disabled (no fetch) when the vehicleId is 0', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useVehicleSettings(0), { wrapper: Wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.isPending).toBe(true)
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('is disabled when the vehicleId is NaN or negative', async () => {
    const { Wrapper } = makeWrapper()
    renderHook(() => useVehicleSettings(Number.NaN), { wrapper: Wrapper })
    renderHook(() => useVehicleSettings(-1), { wrapper: Wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('honours an explicit options.enabled=false even for a valid id', async () => {
    const { Wrapper } = makeWrapper()
    renderHook(() => useVehicleSettings(7, { enabled: false }), { wrapper: Wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('surfaces a request rejection as isError without leaking stale data', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('settings 500', 500))

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useVehicleSettings(7), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeInstanceOf(ApiError)
  })
})

// ---------------------------------------------------------------------------
// useUpsertVehicleSetting (mutation)
// ---------------------------------------------------------------------------

describe('useUpsertVehicleSetting', () => {
  it('PUTs { value } to /vehicles/{id}/settings/{key}, invalidates both caches, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper, qc } = makeWrapper()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpsertVehicleSetting(7), { wrapper: Wrapper })

    await result.current.mutateAsync({ key: 'nickname', value: 'Batmobile' })

    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/vehicles/7/settings/nickname')
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body as string)).toEqual({ value: 'Batmobile' })

    // Both the per-vehicle settings query AND the parent vehicle detail (the
    // nickname feeds the page title) must be invalidated.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: vehicleSettingsKeys.detail(7) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: vehicleKeys.detail('7') })

    expect(successToast).toHaveBeenCalledWith('vehicleSettings.toasts.saved', 'Setting saved.')
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('URL-encodes the key so reserved characters stay a single path segment', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpsertVehicleSetting(7), { wrapper: Wrapper })

    await result.current.mutateAsync({ key: 'a/b c', value: 'x' })
    expect(mockedRequest.mock.calls[0][0]).toBe('/vehicles/7/settings/a%2Fb%20c')
  })

  it('forwards number and boolean values verbatim in the request body', async () => {
    mockedRequest.mockResolvedValue(undefined)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpsertVehicleSetting(7), { wrapper: Wrapper })

    const numberValue: VehicleSettingValue = 42
    const boolValue: VehicleSettingValue = true
    await result.current.mutateAsync({ key: 'k1', value: numberValue })
    await result.current.mutateAsync({ key: 'k2', value: boolValue })

    expect(JSON.parse(mockedRequest.mock.calls[0][1].body as string)).toEqual({ value: 42 })
    expect(JSON.parse(mockedRequest.mock.calls[1][1].body as string)).toEqual({ value: true })
  })

  it('toasts the error and rejects (no invalidation) when the PUT fails', async () => {
    const apiErr = new ApiError('INVALID_VALUE', 400, 'INVALID_VALUE')
    mockedRequest.mockRejectedValueOnce(apiErr)

    const { Wrapper, qc } = makeWrapper()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpsertVehicleSetting(7), { wrapper: Wrapper })

    await expect(result.current.mutateAsync({ key: 'nickname', value: 'x' })).rejects.toBe(apiErr)

    expect(errorToast).toHaveBeenCalledWith(apiErr, 'vehicleSettings.errors.save', 'Failed to save setting')
    expect(successToast).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useResetVehicleSetting (mutation)
// ---------------------------------------------------------------------------

describe('useResetVehicleSetting', () => {
  it('DELETEs /vehicles/{id}/settings/{key}, invalidates both caches, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper, qc } = makeWrapper()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useResetVehicleSetting(7), { wrapper: Wrapper })

    await result.current.mutateAsync('nickname')

    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/vehicles/7/settings/nickname')
    expect(opts.method).toBe('DELETE')

    expect(invalidate).toHaveBeenCalledWith({ queryKey: vehicleSettingsKeys.detail(7) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: vehicleKeys.detail('7') })

    expect(successToast).toHaveBeenCalledWith('vehicleSettings.toasts.reset', 'Reverted to default.')
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('is idempotent — resolves when the backend returns a bodyless 204', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useResetVehicleSetting(7), { wrapper: Wrapper })

    await expect(result.current.mutateAsync('already_default')).resolves.toBeUndefined()
    expect(mockedRequest.mock.calls[0][0]).toBe('/vehicles/7/settings/already_default')
  })

  it('URL-encodes the key on the delete path', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useResetVehicleSetting(7), { wrapper: Wrapper })

    await result.current.mutateAsync('a b&c')
    expect(mockedRequest.mock.calls[0][0]).toBe('/vehicles/7/settings/a%20b%26c')
  })

  it('toasts the error and rejects (no invalidation) when the DELETE fails', async () => {
    const apiErr = new ApiError('reset boom', 500)
    mockedRequest.mockRejectedValueOnce(apiErr)

    const { Wrapper, qc } = makeWrapper()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useResetVehicleSetting(7), { wrapper: Wrapper })

    await expect(result.current.mutateAsync('nickname')).rejects.toBe(apiErr)

    expect(errorToast).toHaveBeenCalledWith(apiErr, 'vehicleSettings.errors.reset', 'Failed to reset setting')
    expect(successToast).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// findEffectiveSetting (selector)
// ---------------------------------------------------------------------------

describe('findEffectiveSetting', () => {
  it('returns the matching row including its source discriminator', () => {
    const payload: VehicleSettingsResponse = {
      settings: [
        makeSetting({ key: 'nickname', value: 'Batmobile', source: 'override' }),
        makeSetting({ key: 'units_distance', value: 'km', source: 'user' }),
      ],
    }

    const row = findEffectiveSetting(payload, 'units_distance')
    expect(row).toEqual({ key: 'units_distance', value: 'km', source: 'user' })
    expect(row?.source).toBe('user')
  })

  it('returns undefined when the key is absent or the payload is undefined', () => {
    const payload: VehicleSettingsResponse = { settings: [makeSetting({ key: 'nickname' })] }
    expect(findEffectiveSetting(payload, 'does_not_exist')).toBeUndefined()
    expect(findEffectiveSetting(undefined, 'nickname')).toBeUndefined()
  })

  it('does not throw when `settings` is null or a non-array shape', () => {
    // A malformed envelope must yield undefined, never a TypeError from
    // calling .find on a non-array.
    const nullSettings = { settings: null } as unknown as VehicleSettingsResponse
    const objSettings = { settings: { bogus: 1 } } as unknown as VehicleSettingsResponse

    expect(() => findEffectiveSetting(nullSettings, 'nickname')).not.toThrow()
    expect(findEffectiveSetting(nullSettings, 'nickname')).toBeUndefined()
    expect(findEffectiveSetting(objSettings, 'nickname')).toBeUndefined()
  })

  it('skips null entries without throwing and still finds a later valid row', () => {
    const payload = {
      settings: [null, makeSetting({ key: 'mute_until', source: 'user' })],
    } as unknown as VehicleSettingsResponse

    const row = findEffectiveSetting(payload, 'mute_until')
    expect(row?.key).toBe('mute_until')
    expect(row?.source).toBe('user')
  })
})
