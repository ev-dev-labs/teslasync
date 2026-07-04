// Behavioural tests for the Settings → AI mutation hooks.
//
// Covers every runtime export:
//   - useSaveAiSettings — partial (top-level shallow) merge of an AI patch
//     over the cached AppSettings, full-document PUT, cache-miss fail-closed,
//     success invalidation + toast, and server-error toast paths.
//   - useValidateAiProvider — POST body shape, the 422 → typed-failure
//     discriminated union (exercising every branch of the internal
//     reasonFromCode mapper), and the non-422 / non-ApiError re-throw paths.
//
// Network is mocked at the `request` boundary (the repo convention) while the
// real ApiError / isApiError are preserved via vi.importActual so the hook's
// 422 discrimination runs against genuine error instances.

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

import { request, ApiError } from '../client'
import { settingsKeys } from './useSettings'
import type { AppSettings } from '@/api/types'
import {
  useSaveAiSettings,
  useValidateAiProvider,
  type ValidateAiProviderRequest,
  type ValidateAiProviderSuccess,
  type ValidateAiProviderFailure,
  type ValidateAiProviderReason,
} from './useAiSettings'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { Wrapper, qc }
}

// A fully-typed baseline AppSettings so cache seeds don't need `as unknown`
// casts. Only the required fields are populated; overrides layer the AI
// sub-tree the hook actually manipulates.
function makeAppSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    unit_of_length: 'mi',
    unit_of_temp: 'F',
    unit_of_pressure: 'psi',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'midnight',
    mode: 'dark',
    custom_primary: '#00e0ff',
    custom_accent: '#22d3ee',
    gas_price_per_unit: 3.5,
    gas_unit: 'gal',
    gas_efficiency_mpg: 25,
    decimal_precision: 1,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'off',
    ...overrides,
  }
}

function firstRequestBody(): AppSettings {
  const opts = mockedRequest.mock.calls[0][1] as RequestInit
  return JSON.parse(opts.body as string) as AppSettings
}

beforeEach(() => {
  mockedRequest.mockReset()
  successToast.mockReset()
  errorToast.mockReset()
  invalidateAndBroadcast.mockReset()
})

describe('useSaveAiSettings', () => {
  it('shallow-merges the AI patch over cached settings and PUTs the full document', async () => {
    const { Wrapper, qc } = makeWrapper()
    qc.setQueryData<AppSettings>(
      settingsKeys.settings,
      makeAppSettings({
        ai_mode: 'off',
        ai_features: { 'old-feature': true },
        theme: 'aurora',
      }),
    )
    mockedRequest.mockImplementation((_url: string, opts: RequestInit) =>
      Promise.resolve(JSON.parse(opts.body as string) as AppSettings),
    )

    const { result } = renderHook(() => useSaveAiSettings(), { wrapper: Wrapper })
    const saved = await result.current.mutateAsync({
      ai_mode: 'local',
      ai_features: { 'chatbot-llm': true },
    })

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    const [url, opts] = mockedRequest.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/settings')
    expect(opts.method).toBe('PUT')
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )

    const body = JSON.parse(opts.body as string) as AppSettings
    expect(body.ai_mode).toBe('local')
    // Shallow replace: the whole ai_features object is swapped in, so the
    // pre-existing key is intentionally dropped (NOT recursively merged).
    expect(body.ai_features).toEqual({ 'chatbot-llm': true })
    // Untouched top-level fields carry over from the cached document.
    expect(body.theme).toBe('aurora')
    expect(body.base_cost_per_kwh).toBe(0.12)

    expect(saved.ai_mode).toBe('local')
    await waitFor(() =>
      expect(invalidateAndBroadcast).toHaveBeenCalledWith(expect.anything(), {
        queryKey: settingsKeys.settings,
      }),
    )
    expect(successToast).toHaveBeenCalledWith(
      'toast.settings.ai.save.success',
      'AI settings saved',
    )
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('replaces ai_features with an empty map when the patch clears it (no deep-merge)', async () => {
    const { Wrapper, qc } = makeWrapper()
    qc.setQueryData<AppSettings>(
      settingsKeys.settings,
      makeAppSettings({ ai_mode: 'local', ai_features: { a: true, b: true } }),
    )
    mockedRequest.mockResolvedValue(makeAppSettings({ ai_mode: 'off' }))

    const { result } = renderHook(() => useSaveAiSettings(), { wrapper: Wrapper })
    await result.current.mutateAsync({ ai_mode: 'off', ai_features: {} })

    const body = firstRequestBody()
    expect(body.ai_features).toEqual({})
    expect(body.ai_mode).toBe('off')
  })

  it('fails closed when the settings cache is empty: throws, skips the request, toasts the error', async () => {
    const { Wrapper } = makeWrapper() // cache intentionally left unseeded
    const { result } = renderHook(() => useSaveAiSettings(), { wrapper: Wrapper })

    await expect(
      result.current.mutateAsync({ ai_mode: 'local' }),
    ).rejects.toThrow(/settings cache empty/)

    expect(mockedRequest).not.toHaveBeenCalled()
    expect(invalidateAndBroadcast).not.toHaveBeenCalled()
    expect(successToast).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        expect.any(Error),
        'toast.settings.ai.save.error',
        'Failed to save AI settings',
      ),
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
  })

  it('surfaces a server failure through the error toast and never invalidates', async () => {
    const { Wrapper, qc } = makeWrapper()
    qc.setQueryData<AppSettings>(settingsKeys.settings, makeAppSettings())
    mockedRequest.mockRejectedValue(new ApiError('boom', 500, 'internal'))

    const { result } = renderHook(() => useSaveAiSettings(), { wrapper: Wrapper })
    await expect(
      result.current.mutateAsync({ ai_mode: 'cloud' }),
    ).rejects.toThrow('boom')

    expect(invalidateAndBroadcast).not.toHaveBeenCalled()
    expect(successToast).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        expect.any(ApiError),
        'toast.settings.ai.save.error',
        'Failed to save AI settings',
      ),
    )
  })
})

describe('useValidateAiProvider', () => {
  it('POSTs the request body to /settings/ai/validate-config and returns the success variant', async () => {
    const { Wrapper } = makeWrapper()
    const success: ValidateAiProviderSuccess = {
      ok: true,
      mode: 'local',
      base_url: 'http://localhost:11434',
      pinned_ip: '127.0.0.1',
      probed_model: 'llama3',
    }
    mockedRequest.mockResolvedValue(success)

    const req: ValidateAiProviderRequest = {
      mode: 'local',
      base_url: 'http://localhost:11434',
    }
    const { result } = renderHook(() => useValidateAiProvider(), {
      wrapper: Wrapper,
    })
    const res = await result.current.mutateAsync(req)

    const [url, opts] = mockedRequest.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/settings/ai/validate-config')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual(req)

    expect(res.ok).toBe(true)
    expect(res).toEqual(success)
  })

  it('maps a 422 ApiError into the typed failure variant using the structured code', async () => {
    const { Wrapper } = makeWrapper()
    mockedRequest.mockRejectedValue(
      new ApiError('base URL resolves to a public address', 422, 'not_local'),
    )

    const { result } = renderHook(() => useValidateAiProvider(), {
      wrapper: Wrapper,
    })
    const res = (await result.current.mutateAsync({
      mode: 'local',
      base_url: 'http://8.8.8.8',
    })) as ValidateAiProviderFailure

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('not_local')
    expect(res.message).toContain('public address')
    // A validation rejection is a *resolved* outcome, not a mutation error.
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('falls back to reason "unknown" when the 422 response omits a code', async () => {
    const { Wrapper } = makeWrapper()
    mockedRequest.mockRejectedValue(new ApiError('nope', 422))

    const { result } = renderHook(() => useValidateAiProvider(), {
      wrapper: Wrapper,
    })
    const res = (await result.current.mutateAsync({
      mode: 'cloud',
    })) as ValidateAiProviderFailure

    expect(res.ok).toBe(false)
    expect(res.reason).toBe('unknown')
    expect(res.message).toBe('nope')
  })

  it('normalizes every known backend code to its matching typed reason', async () => {
    const { Wrapper } = makeWrapper()
    const knownCodes: ValidateAiProviderReason[] = [
      'not_local',
      'invalid',
      'bad_mode',
      'bad_request',
      'unknown_provider',
      'missing_api_key',
      'missing_base_url',
      'missing_deployment',
      'unauthorized',
      'not_found',
      'upstream_error',
      'timeout',
    ]

    const { result } = renderHook(() => useValidateAiProvider(), {
      wrapper: Wrapper,
    })

    for (const code of knownCodes) {
      mockedRequest.mockRejectedValueOnce(
        new ApiError(`rejected: ${code}`, 422, code),
      )
      const res = (await result.current.mutateAsync({
        mode: 'cloud',
      })) as ValidateAiProviderFailure
      expect(res.reason).toBe(code)
      expect(res.message).toBe(`rejected: ${code}`)
    }

    // An unrecognised future code degrades to 'unknown' but preserves the
    // human-readable message so the UI can still render it verbatim.
    mockedRequest.mockRejectedValueOnce(
      new ApiError('future', 422, 'brand_new_code'),
    )
    const fut = (await result.current.mutateAsync({
      mode: 'cloud',
    })) as ValidateAiProviderFailure
    expect(fut.reason).toBe('unknown')
    expect(fut.message).toBe('future')
  })

  it('re-throws non-422 ApiErrors so the mutation enters its error state', async () => {
    const { Wrapper } = makeWrapper()
    mockedRequest.mockRejectedValue(new ApiError('server exploded', 500, 'internal'))

    const { result } = renderHook(() => useValidateAiProvider(), {
      wrapper: Wrapper,
    })
    await expect(
      result.current.mutateAsync({ mode: 'cloud' }),
    ).rejects.toBeInstanceOf(ApiError)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect((result.current.error as ApiError).status).toBe(500)
  })

  it('re-throws non-ApiError failures such as a dropped network connection', async () => {
    const { Wrapper } = makeWrapper()
    mockedRequest.mockRejectedValue(new Error('Network request failed'))

    const { result } = renderHook(() => useValidateAiProvider(), {
      wrapper: Wrapper,
    })
    await expect(
      result.current.mutateAsync({ mode: 'local', base_url: 'http://localhost' }),
    ).rejects.toThrow(/Network request failed/)
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})
