// Behavioural tests for the admin impersonation hooks.
//
// Covers every runtime export of `./useImpersonation`:
//   - impersonationKeys          — stable, distinct query-key tuples.
//   - isImpersonationOpenMode    — open-mode discriminated-union predicate.
//   - isImpersonationActive      — active-mode discriminated-union predicate.
//   - useImpersonationStatus     — GET /admin/impersonate: active reshape +
//     null-coalesce, inactive fallthrough, 204/empty-body hardening, the
//     501 AUTH_MODE_OPEN → { mode: 'open' } normalisation, real-error
//     re-throw, threaded AbortSignal, and the `enabled` guard.
//   - useImpersonationCandidates — GET /admin/impersonate/candidates:
//     default-disabled opt-in, list passthrough + null coalesce, empty-body
//     hardening, AUTH_MODE_OPEN normalisation, error re-throw.
//   - useStartImpersonation      — POST /admin/impersonate: body shape, status
//     cache priming, blanket invalidation, success + error toasts.
//   - useEndImpersonation        — POST /admin/impersonate/end: reset-to-
//     inactive, blanket invalidation, success + error toasts.
//
// Network is mocked at the `../client` boundary (the repo convention) while
// the real ApiError / isApiError are preserved via vi.importActual so the
// hooks' AUTH_MODE_OPEN discrimination runs against genuine error instances.
// The toast bridge is stubbed via vi.hoisted so success/error emission is
// asserted without mounting a ToastProvider.

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

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, request: vi.fn() }
})

import { request, ApiError } from '../client'
import {
  impersonationKeys,
  isImpersonationActive,
  isImpersonationOpenMode,
  useImpersonationStatus,
  useImpersonationCandidates,
  useStartImpersonation,
  useEndImpersonation,
} from './useImpersonation'
import type { ImpersonationStatus } from '@/api/types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

// A genuine 501 AUTH_MODE_OPEN error — the sentinel both query hooks must
// translate into the { mode: 'open' } placeholder instead of surfacing as an
// error. Built from the real ApiError so isApiError() narrows correctly.
const authModeOpenError = new ApiError(
  'impersonation requires forward-auth mode',
  501,
  'AUTH_MODE_OPEN',
)

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

beforeEach(() => {
  mockedRequest.mockReset()
  successToast.mockReset()
  errorToast.mockReset()
})

// ---------------------------------------------------------------------------
// impersonationKeys — query-key factory
// ---------------------------------------------------------------------------

describe('impersonationKeys', () => {
  it('exposes stable, domain-prefixed tuples', () => {
    expect(impersonationKeys.status).toEqual(['impersonation', 'status'])
    expect(impersonationKeys.candidates).toEqual(['impersonation', 'candidates'])
  })

  it('keeps the status and candidates keys distinct so invalidation never collides', () => {
    expect(impersonationKeys.status).not.toEqual(impersonationKeys.candidates)
  })
})

// ---------------------------------------------------------------------------
// isImpersonationOpenMode / isImpersonationActive — pure predicates
// ---------------------------------------------------------------------------

describe('isImpersonationOpenMode', () => {
  it('is true only for the open-mode placeholder', () => {
    expect(isImpersonationOpenMode({ mode: 'open' })).toBe(true)
  })

  it('is false for inactive, active, and undefined status', () => {
    expect(isImpersonationOpenMode({ mode: 'inactive' })).toBe(false)
    expect(
      isImpersonationOpenMode({
        mode: 'active',
        original_admin: 'admin',
        target: 'user',
        expires_at: '2025-01-01T00:00:00Z',
      }),
    ).toBe(false)
    expect(isImpersonationOpenMode(undefined)).toBe(false)
  })
})

describe('isImpersonationActive', () => {
  it('is true only for the active status', () => {
    expect(
      isImpersonationActive({
        mode: 'active',
        original_admin: 'admin',
        target: 'user',
        expires_at: '2025-01-01T00:00:00Z',
      }),
    ).toBe(true)
  })

  it('is false for open, inactive, and undefined status', () => {
    expect(isImpersonationActive({ mode: 'open' })).toBe(false)
    expect(isImpersonationActive({ mode: 'inactive' })).toBe(false)
    expect(isImpersonationActive(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// useImpersonationStatus
// ---------------------------------------------------------------------------

describe('useImpersonationStatus', () => {
  it('GETs /admin/impersonate, threads the AbortSignal, and reshapes an active payload', async () => {
    mockedRequest.mockResolvedValueOnce({
      mode: 'active',
      original_admin: 'admin@corp',
      target: 'subject-7',
      expires_at: '2025-06-01T12:15:00Z',
    })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      mode: 'active',
      original_admin: 'admin@corp',
      target: 'subject-7',
      expires_at: '2025-06-01T12:15:00Z',
    })

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    const [url, opts] = mockedRequest.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/admin/impersonate')
    // Cancellation support: TanStack Query's signal must reach the client.
    expect(opts).toHaveProperty('signal')
  })

  it('null-coalesces missing active fields to empty strings', async () => {
    mockedRequest.mockResolvedValueOnce({ mode: 'active' })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      mode: 'active',
      original_admin: '',
      target: '',
      expires_at: '',
    })
  })

  it('maps a non-active payload to the inactive placeholder', async () => {
    mockedRequest.mockResolvedValueOnce({ mode: 'inactive' })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ mode: 'inactive' })
  })

  it('treats a 204/empty body as inactive instead of throwing', async () => {
    // request() resolves undefined for a 204; dereferencing payload.mode
    // would throw and surface a spurious query error in the banner.
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isError).toBe(false)
    expect(result.current.data).toEqual({ mode: 'inactive' })
  })

  it('normalises the 501 AUTH_MODE_OPEN error into the open placeholder (not an error)', async () => {
    mockedRequest.mockRejectedValueOnce(authModeOpenError)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isError).toBe(false)
    expect(result.current.data).toEqual({ mode: 'open' })
  })

  it('re-throws a non-AUTH_MODE_OPEN ApiError so isError is driven', async () => {
    mockedRequest.mockRejectedValue(new ApiError('boom', 500, 'internal'))

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper: Wrapper })

    // The hook sets retry: 1, so allow for the initial attempt + one delayed
    // retry (~1s default backoff) before the query settles into its error.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 })
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.status).toBe(500)
  })

  it('is disabled (no fetch) when enabled is false', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationStatus({ enabled: false }), {
      wrapper: Wrapper,
    })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.isPending).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// useImpersonationCandidates
// ---------------------------------------------------------------------------

describe('useImpersonationCandidates', () => {
  it('is disabled by default so it does not fire on every page render', async () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationCandidates(), { wrapper: Wrapper })

    await new Promise((r) => setTimeout(r, 10))
    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('GETs the candidates endpoint and passes the session list through when enabled', async () => {
    mockedRequest.mockResolvedValueOnce({
      mode: 'session',
      candidates: [{ subject: 'alice' }, { subject: 'bob' }],
    })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationCandidates({ enabled: true }), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({
      mode: 'session',
      candidates: [{ subject: 'alice' }, { subject: 'bob' }],
    })

    const [url, opts] = mockedRequest.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/admin/impersonate/candidates')
    expect(opts).toHaveProperty('signal')
  })

  it('coerces a missing candidate list to an empty array', async () => {
    mockedRequest.mockResolvedValueOnce({ mode: 'session' })

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationCandidates({ enabled: true }), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ mode: 'session', candidates: [] })
  })

  it('treats a 204/empty body as an empty session list instead of throwing', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationCandidates({ enabled: true }), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isError).toBe(false)
    expect(result.current.data).toEqual({ mode: 'session', candidates: [] })
  })

  it('normalises AUTH_MODE_OPEN into the open placeholder', async () => {
    mockedRequest.mockRejectedValueOnce(authModeOpenError)

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationCandidates({ enabled: true }), {
      wrapper: Wrapper,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ mode: 'open' })
  })

  it('re-throws a non-AUTH_MODE_OPEN error', async () => {
    mockedRequest.mockRejectedValue(new ApiError('nope', 403, 'forbidden'))

    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useImpersonationCandidates({ enabled: true }), {
      wrapper: Wrapper,
    })

    // retry: 1 on this hook too — give the delayed retry room to settle.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 4000 })
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// useStartImpersonation
// ---------------------------------------------------------------------------

describe('useStartImpersonation', () => {
  const activeResult: ImpersonationStatus = {
    mode: 'active',
    original_admin: 'admin@corp',
    target: 'subject-7',
    expires_at: '2025-06-01T12:15:00Z',
  }

  it('POSTs the subject body, primes the status cache, invalidates every query, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(activeResult)

    const { Wrapper, qc } = makeWrapper()
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useStartImpersonation(), { wrapper: Wrapper })

    const returned = await result.current.mutateAsync({ subject: 'subject-7' })
    expect(returned).toEqual(activeResult)

    const [url, opts] = mockedRequest.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/admin/impersonate')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ subject: 'subject-7' })

    // The banner appears without an inactive flash because the status cache
    // is primed with the mutation result.
    expect(qc.getQueryData(impersonationKeys.status)).toEqual(activeResult)
    // Blanket invalidation refetches every endpoint as the new principal.
    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith()

    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith(
        'impersonation.toast.started',
        'Impersonation started',
      ),
    )
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('surfaces a start failure through the error toast and never primes the cache', async () => {
    const failure = new ApiError('target not a known active session', 400, 'invalid_target')
    mockedRequest.mockRejectedValue(failure)

    const { Wrapper, qc } = makeWrapper()
    const { result } = renderHook(() => useStartImpersonation(), { wrapper: Wrapper })

    await expect(result.current.mutateAsync({ subject: 'ghost' })).rejects.toThrow(
      /known active session/,
    )

    expect(qc.getQueryData(impersonationKeys.status)).toBeUndefined()
    expect(successToast).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        failure,
        'impersonation.toast.startFailed',
        'Failed to start impersonation',
      ),
    )
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ---------------------------------------------------------------------------
// useEndImpersonation
// ---------------------------------------------------------------------------

describe('useEndImpersonation', () => {
  it('POSTs /admin/impersonate/end, resets status to inactive, invalidates all, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)

    const { Wrapper, qc } = makeWrapper()
    // Seed an active status so we can prove the mutation resets it.
    qc.setQueryData<ImpersonationStatus>(impersonationKeys.status, {
      mode: 'active',
      original_admin: 'admin@corp',
      target: 'subject-7',
      expires_at: '2025-06-01T12:15:00Z',
    })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useEndImpersonation(), { wrapper: Wrapper })

    await result.current.mutateAsync()

    const [url, opts] = mockedRequest.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/admin/impersonate/end')
    expect(opts.method).toBe('POST')

    // Banner disappears immediately without waiting for the next poll.
    expect(qc.getQueryData(impersonationKeys.status)).toEqual({ mode: 'inactive' })
    expect(invalidateSpy).toHaveBeenCalledTimes(1)

    await waitFor(() =>
      expect(successToast).toHaveBeenCalledWith(
        'impersonation.toast.ended',
        'Impersonation ended',
      ),
    )
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('surfaces an end failure through the error toast without resetting the cache', async () => {
    const failure = new ApiError('server exploded', 500, 'internal')
    mockedRequest.mockRejectedValue(failure)

    const { Wrapper, qc } = makeWrapper()
    const seeded: ImpersonationStatus = {
      mode: 'active',
      original_admin: 'admin@corp',
      target: 'subject-7',
      expires_at: '2025-06-01T12:15:00Z',
    }
    qc.setQueryData<ImpersonationStatus>(impersonationKeys.status, seeded)
    const { result } = renderHook(() => useEndImpersonation(), { wrapper: Wrapper })

    await expect(result.current.mutateAsync()).rejects.toThrow(/server exploded/)

    // Failure must not optimistically clear the impersonation context.
    expect(qc.getQueryData(impersonationKeys.status)).toEqual(seeded)
    expect(successToast).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(errorToast).toHaveBeenCalledWith(
        failure,
        'impersonation.toast.endFailed',
        'Failed to end impersonation',
      ),
    )
  })
})
