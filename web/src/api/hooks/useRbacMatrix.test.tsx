// useRbacMatrix hook-suite tests.
//
// Covers EVERY runtime export of useRbacMatrix.ts:
//   - rbacMatrixKeys        — stable, hierarchical query-key factory.
//   - useRbacMatrix         — GET /admin/rbac/matrix, AbortSignal threading,
//     the AUTH_MODE_OPEN → { mode: 'open' } sentinel swap (must resolve as
//     SUCCESS, not error), a genuine transport failure surfacing as isError,
//     and the enabled:false gate suppressing the request entirely.
//   - useUpsertRbacCells    — PUT /admin/rbac/matrix, JSON body { cells },
//     the empty-batch no-op still firing, cache invalidation of the matrix
//     key, and success/error toast wiring.
//   - isRbacOpenMode        — narrows the synthetic open envelope; false for a
//     session payload and for undefined.
//   - diffMatrices          — symmetric-difference of two snapshots incl.
//     grants, revocations, added roles/perms, defaulted-missing cells, and the
//     null/undefined tolerance that guards Object.keys.
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so each handler's exact i18n key + English fallback is
// asserted without mounting a ToastProvider / i18n instance. The real
// invalidateAndBroadcast runs against the test QueryClient (spied) and its
// coalesced cross-tab timer is drained in afterEach.
//
// Sibling-of-source location is mandatory — the gate's path-scoped checks
// match `api/hooks/useRbacMatrix` as a contiguous substring, which a
// __tests__/ subdir would interrupt.

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
import type { RbacMatrixSessionResponse, RbacUpsertCell } from '@/api/types'
import {
  rbacMatrixKeys,
  useRbacMatrix,
  useUpsertRbacCells,
  isRbacOpenMode,
  diffMatrices,
} from './useRbacMatrix'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      // retryDelay:0 keeps the hook's own `retry: 1` from adding a ~1s
      // exponential-backoff pause to the failure-path tests.
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return { Wrapper, qc }
}

const sessionPayload: RbacMatrixSessionResponse = {
  mode: 'session',
  roles: [
    { id: 'admin', name: 'admin' },
    { id: 'user', name: 'user' },
  ],
  permissions: [
    { id: 'fleet.read', name: 'Read fleet', category: 'fleet' },
    { id: 'fleet.write', name: 'Write fleet', category: 'fleet' },
  ],
  categories: ['fleet'],
  matrix: {
    admin: { 'fleet.read': true, 'fleet.write': true },
    user: { 'fleet.read': true, 'fleet.write': false },
  },
  effective_for_me: { 'fleet.read': true, 'fleet.write': true },
  my_roles: ['admin'],
  groups_header_name: 'X-Forwarded-Groups',
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

describe('rbacMatrixKeys', () => {
  it('exposes a stable hierarchical query-key factory anchored on all', () => {
    expect(rbacMatrixKeys.all).toEqual(['admin', 'rbac'])
    expect(rbacMatrixKeys.matrix()).toEqual(['admin', 'rbac', 'matrix'])
    // matrix() must be derived from all so a single-source rename can't
    // desync the query cache anchor every mutation invalidates.
    expect(rbacMatrixKeys.matrix().slice(0, 2)).toEqual(rbacMatrixKeys.all)
  })
})

// ---------------------------------------------------------------------------
// useRbacMatrix (query)
// ---------------------------------------------------------------------------

describe('useRbacMatrix', () => {
  it('GETs /admin/rbac/matrix, threads the abort signal, and returns the session payload', async () => {
    mockedRequest.mockResolvedValueOnce(sessionPayload)
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useRbacMatrix(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(sessionPayload)
    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/admin/rbac/matrix')
    // The hook must forward React Query's AbortSignal so navigating away
    // cancels the in-flight request.
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    // No /api/v1 double-prefix leaked into the hook URL.
    expect(url).not.toContain('/api/v1')
  })

  it('swaps an AUTH_MODE_OPEN ApiError for the synthetic { mode: "open" } SUCCESS envelope', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError('feature unavailable', 501, 'AUTH_MODE_OPEN'))
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useRbacMatrix(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Open mode is a resolved value, NOT a query error — the page renders a
    // forward-auth placeholder instead of a 501 toast.
    expect(result.current.isError).toBe(false)
    expect(result.current.data).toEqual({ mode: 'open' })
  })

  it('surfaces a non-open ApiError as isError without leaking stale data', async () => {
    mockedRequest.mockRejectedValue(new ApiError('boom', 500))
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useRbacMatrix(), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(result.current.error?.status).toBe(500)
  })

  it('does not fire the request when enabled is false', () => {
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useRbacMatrix({ enabled: false }), { wrapper: Wrapper })

    expect(mockedRequest).not.toHaveBeenCalled()
    expect(result.current.fetchStatus).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// useUpsertRbacCells (mutation)
// ---------------------------------------------------------------------------

describe('useUpsertRbacCells', () => {
  it('PUTs { cells } to /admin/rbac/matrix, invalidates the matrix, and toasts success', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    const { Wrapper, qc } = makeWrapper()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpsertRbacCells(), { wrapper: Wrapper })

    const cells: RbacUpsertCell[] = [
      { role_id: 'admin', permission_id: 'fleet.write', allowed: false },
    ]
    await result.current.mutateAsync(cells)

    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/admin/rbac/matrix')
    expect(opts.method).toBe('PUT')
    expect(opts.requiresLiveMode).toBe(true)
    // Body is wrapped in the { cells } envelope the handler expects.
    expect(JSON.parse(opts.body as string)).toEqual({ cells })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: rbacMatrixKeys.matrix() })
    expect(successToast).toHaveBeenCalledWith('rbac.toasts.saved', 'RBAC matrix updated.')
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('still PUTs an empty { cells: [] } batch (backend treats it as a no-op)', async () => {
    mockedRequest.mockResolvedValueOnce(undefined)
    const { Wrapper } = makeWrapper()
    const { result } = renderHook(() => useUpsertRbacCells(), { wrapper: Wrapper })

    await result.current.mutateAsync([])

    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/admin/rbac/matrix')
    expect(JSON.parse(opts.body as string)).toEqual({ cells: [] })
    expect(successToast).toHaveBeenCalledWith('rbac.toasts.saved', 'RBAC matrix updated.')
  })

  it('toasts the error and rejects (no invalidation) when the PUT fails', async () => {
    const failure = new ApiError('save rejected', 403)
    mockedRequest.mockRejectedValueOnce(failure)
    const { Wrapper, qc } = makeWrapper()
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpsertRbacCells(), { wrapper: Wrapper })

    await expect(
      result.current.mutateAsync([{ role_id: 'admin', permission_id: 'fleet.read', allowed: false }]),
    ).rejects.toThrow('save rejected')

    expect(errorToast).toHaveBeenCalledWith(failure, 'rbac.errors.save', 'Failed to save RBAC matrix')
    expect(successToast).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// isRbacOpenMode (type guard)
// ---------------------------------------------------------------------------

describe('isRbacOpenMode', () => {
  it('returns true only for the synthetic open envelope', () => {
    expect(isRbacOpenMode({ mode: 'open' })).toBe(true)
  })

  it('returns false for a session payload and for undefined', () => {
    expect(isRbacOpenMode(sessionPayload)).toBe(false)
    expect(isRbacOpenMode(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// diffMatrices (pure utility)
// ---------------------------------------------------------------------------

describe('diffMatrices', () => {
  it('returns an empty diff when both snapshots are identical', () => {
    const snap = { admin: { 'fleet.read': true, 'fleet.write': false } }
    expect(diffMatrices(snap, { admin: { 'fleet.read': true, 'fleet.write': false } })).toEqual([])
  })

  it('emits a grant and a revocation for toggled cells', () => {
    const base = { admin: { 'fleet.read': true, 'fleet.write': false } }
    const draft = { admin: { 'fleet.read': false, 'fleet.write': true } }

    const diff = diffMatrices(base, draft)

    expect(diff).toHaveLength(2)
    expect(diff).toContainEqual({ role_id: 'admin', permission_id: 'fleet.read', allowed: false })
    expect(diff).toContainEqual({ role_id: 'admin', permission_id: 'fleet.write', allowed: true })
  })

  it('emits a grant for a role/permission only present in the draft', () => {
    const diff = diffMatrices({}, { viewer: { 'fleet.read': true } })
    expect(diff).toEqual([{ role_id: 'viewer', permission_id: 'fleet.read', allowed: true }])
  })

  it('emits a revocation for a cell dropped from the draft (defaulted to false)', () => {
    // The perm existed as `true` in base but the draft row omits it entirely —
    // a missing draft cell must read as deny, producing a revocation.
    const diff = diffMatrices({ admin: { 'fleet.write': true } }, { admin: {} })
    expect(diff).toEqual([{ role_id: 'admin', permission_id: 'fleet.write', allowed: false }])
  })

  it('tolerates null/undefined snapshots instead of throwing on Object.keys', () => {
    expect(diffMatrices(undefined, undefined)).toEqual([])
    expect(diffMatrices(null, { admin: { 'fleet.read': true } })).toEqual([
      { role_id: 'admin', permission_id: 'fleet.read', allowed: true },
    ])
    expect(diffMatrices({ admin: { 'fleet.read': true } }, undefined)).toEqual([
      { role_id: 'admin', permission_id: 'fleet.read', allowed: false },
    ])
  })
})
