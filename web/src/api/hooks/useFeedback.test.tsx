// useFeedback hook-suite tests.
//
// Covers EVERY export of useFeedback.ts:
//   - feedbackKeys: stable "all" root key + params-scoped "list" tuple.
//   - useSubmitFeedback: POST /feedback method/headers/body, the resolved
//     entry, and success/error toast wiring (exact i18n key + fallback,
//     forwarded error object).
//   - useFeedbackList: GET /admin/feedback query-string assembly (snake_case
//     status/category/limit/offset in a stable order), empty-string filter
//     omission, the non-finite numeric guard, AbortSignal threading, and the
//     error path.
//   - useUpdateFeedback: PATCH /admin/feedback/{id} method/body, cache
//     invalidation on success, and success/error toast wiring.
//
// Network is stubbed at the request() boundary; the mutation-toast bridge is
// replaced with spies so onSuccess/onError assertions are exact and no
// ToastProvider / i18n instance is required (mirrors useCharging.test.tsx).
//
// Keep this test next to the hook — the gate's path-scoped checks match
// `api/hooks/useFeedback` as a contiguous substring.

import { describe, it, expect, beforeEach, vi } from 'vitest'
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

// Replace the toast bridge with spies so onSuccess/onError assertions are
// exact and no ToastProvider / i18n instance is required.
vi.mock('./_toastHelpers', () => ({
  useMutationToast: () => ({ success: successToast, error: errorToast }),
}))

import { request } from '@/api/client'
import {
  feedbackKeys,
  useSubmitFeedback,
  useFeedbackList,
  useUpdateFeedback,
  type FeedbackListParams,
} from './useFeedback'
import type {
  FeedbackEntry,
  FeedbackListResponse,
  FeedbackSubmitInput,
  FeedbackUpdateInput,
} from '../types'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

// A fresh QueryClient per test keeps caches isolated; `wrapper` reads the
// module-scoped `qc` that beforeEach reassigns.
let qc: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const entry: FeedbackEntry = {
  id: 42,
  created_at: '2025-06-01T10:00:00Z',
  category: 'bug',
  title: 'Battery chart blank',
  body: 'The battery chart renders empty on Safari 17.',
  page_route: '/battery',
  user_agent: 'Mozilla/5.0',
  app_version: '1.4.2',
  user_email: 'alice@example.com',
  recent_errors: null,
  console_tail: '',
  status: 'new',
  github_issue_url: '',
  submitter_subject: 'alice',
  submitter_ip: '10.0.0.7',
  triaged_at: null,
  triaged_by: '',
}

const listResponse: FeedbackListResponse = {
  items: [entry],
  total: 1,
  limit: 25,
  offset: 0,
  github_bridge_enabled: true,
  github_repo: 'ev-dev-labs/teslasync',
}

beforeEach(() => {
  mockedRequest.mockReset()
  successToast.mockReset()
  errorToast.mockReset()
  qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
})

// ---------------------------------------------------------------------------
// feedbackKeys
// ---------------------------------------------------------------------------

describe('feedbackKeys', () => {
  it('exposes a stable "all" root key', () => {
    expect(feedbackKeys.all).toEqual(['feedback'])
  })

  it('namespaces list keys under the root and embeds the params', () => {
    const params: FeedbackListParams = { status: 'new', category: 'bug', limit: 25, offset: 0 }
    expect(feedbackKeys.list(params)).toEqual(['feedback', 'list', params])
    // Distinct filters must yield distinct cache identities.
    expect(feedbackKeys.list({ status: 'closed' })).not.toEqual(
      feedbackKeys.list({ status: 'new' }),
    )
  })
})

// ---------------------------------------------------------------------------
// useSubmitFeedback
// ---------------------------------------------------------------------------

describe('useSubmitFeedback', () => {
  const input: FeedbackSubmitInput = {
    category: 'bug',
    title: 'Battery chart blank',
    body: 'The battery chart renders empty on Safari 17.',
    page_route: '/battery',
  }

  it('POSTs /feedback with a JSON body and resolves the created entry', async () => {
    mockedRequest.mockResolvedValueOnce(entry)
    const { result } = renderHook(() => useSubmitFeedback(), { wrapper })

    const created = await result.current.mutateAsync(input)
    expect(created.id).toBe(42)

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/feedback')
    expect(opts.method).toBe('POST')
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(opts.body as string)).toEqual(input)
  })

  it('emits the success toast with its i18n key + fallback on submit', async () => {
    mockedRequest.mockResolvedValueOnce(entry)
    const { result } = renderHook(() => useSubmitFeedback(), { wrapper })

    await result.current.mutateAsync(input)

    expect(successToast).toHaveBeenCalledWith(
      'toast.feedback.submit.success',
      'Thanks — feedback submitted',
    )
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('surfaces submit failures as isError and forwards the error to the toast bridge', async () => {
    const boom = new Error('HTTP 500: server on fire')
    mockedRequest.mockRejectedValueOnce(boom)
    const { result } = renderHook(() => useSubmitFeedback(), { wrapper })

    result.current.mutate(input)
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBe(boom)
    expect(errorToast).toHaveBeenCalledWith(
      boom,
      'toast.feedback.submit.error',
      'Failed to submit feedback',
    )
    expect(successToast).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// useFeedbackList
// ---------------------------------------------------------------------------

describe('useFeedbackList', () => {
  it('GETs /admin/feedback with no query string for empty params and threads the AbortSignal', async () => {
    mockedRequest.mockResolvedValueOnce(listResponse)
    const { result } = renderHook(() => useFeedbackList(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.total).toBe(1)
    expect(result.current.data?.items).toHaveLength(1)

    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/admin/feedback')
    // React Query threads its AbortSignal so navigating away cancels the fetch.
    expect(opts).toHaveProperty('signal')
  })

  it('serialises status, category, limit and offset as snake_case params in a stable order', async () => {
    mockedRequest.mockResolvedValueOnce(listResponse)
    renderHook(
      () => useFeedbackList({ status: 'triaged', category: 'feature', limit: 25, offset: 50 }),
      { wrapper },
    )

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(mockedRequest.mock.calls[0][0]).toBe(
      '/admin/feedback?status=triaged&category=feature&limit=25&offset=50',
    )
  })

  it('omits empty-string status/category filters but keeps an explicit zero offset', async () => {
    mockedRequest.mockResolvedValueOnce(listResponse)
    renderHook(() => useFeedbackList({ status: '', category: '', limit: 10, offset: 0 }), { wrapper })

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    expect(mockedRequest.mock.calls[0][0]).toBe('/admin/feedback?limit=10&offset=0')
  })

  it('drops non-finite numeric params instead of sending limit=NaN', async () => {
    mockedRequest.mockResolvedValueOnce(listResponse)
    renderHook(
      () => useFeedbackList({ limit: Number.NaN, offset: Number.POSITIVE_INFINITY }),
      { wrapper },
    )

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1))
    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toBe('/admin/feedback')
    expect(url).not.toContain('NaN')
  })

  it('surfaces list request errors as isError', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useFeedbackList({ status: 'new', limit: 1 }), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// useUpdateFeedback
// ---------------------------------------------------------------------------

describe('useUpdateFeedback', () => {
  const update: FeedbackUpdateInput = { status: 'triaged', forward_to_github: true }

  it('PATCHes /admin/feedback/{id} with the update body and resolves the row', async () => {
    mockedRequest.mockResolvedValueOnce({ ...entry, status: 'triaged' })
    const { result } = renderHook(() => useUpdateFeedback(), { wrapper })

    const row = await result.current.mutateAsync({ id: 42, update })
    expect(row.status).toBe('triaged')

    const [url, opts] = mockedRequest.mock.calls[0]
    expect(url).toBe('/admin/feedback/42')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body as string)).toEqual(update)
  })

  it('invalidates the feedback cache and emits the success toast on update', async () => {
    mockedRequest.mockResolvedValueOnce({ ...entry, status: 'closed' })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useUpdateFeedback(), { wrapper })

    await result.current.mutateAsync({ id: 42, update: { status: 'closed' } })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: feedbackKeys.all })
    expect(successToast).toHaveBeenCalledWith('toast.feedback.update.success', 'Feedback updated')
  })

  it('surfaces update failures as isError and forwards the error to the toast bridge', async () => {
    const nope = new Error('conflict')
    mockedRequest.mockRejectedValueOnce(nope)
    const { result } = renderHook(() => useUpdateFeedback(), { wrapper })

    result.current.mutate({ id: 7, update })
    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(errorToast).toHaveBeenCalledWith(
      nope,
      'toast.feedback.update.error',
      'Failed to update feedback',
    )
    expect(successToast).not.toHaveBeenCalled()
  })
})
