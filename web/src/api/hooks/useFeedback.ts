import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { request } from '../client'
import { useMutationToast } from './_toastHelpers'
import type {
  FeedbackEntry,
  FeedbackListResponse,
  FeedbackSubmitInput,
  FeedbackUpdateInput,
} from '../types'

// In-app feedback widget hooks.
//
// Three surfaces:
//  - useSubmitFeedback   — public POST /feedback (called from <FeedbackModal>)
//  - useFeedbackList     — admin GET /admin/feedback (queue page)
//  - useUpdateFeedback   — admin PATCH /admin/feedback/{id} (status / forward)

export const feedbackKeys = {
  all: ['feedback'] as const,
  list: (params: FeedbackListParams) => ['feedback', 'list', params] as const,
}

export interface FeedbackListParams {
  status?: 'new' | 'triaged' | 'closed' | ''
  category?: 'bug' | 'feature' | 'other' | ''
  limit?: number
  offset?: number
}

function buildQuery(params: FeedbackListParams): string {
  const sp = new URLSearchParams()
  if (params.status) sp.set('status', params.status)
  if (params.category) sp.set('category', params.category)
  // Guard with Number.isFinite (not `typeof === 'number'`) so a NaN/Infinity
  // leaking in from arithmetic (e.g. page * PAGE_SIZE when page is NaN) never
  // serialises `limit=NaN`, which the backend rejects as a 400.
  if (Number.isFinite(params.limit)) sp.set('limit', String(params.limit))
  if (Number.isFinite(params.offset)) sp.set('offset', String(params.offset))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export function useSubmitFeedback() {
  const { success, error } = useMutationToast()
  return useMutation({
    mutationFn: (input: FeedbackSubmitInput) =>
      request<FeedbackEntry>('/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      success('toast.feedback.submit.success', 'Thanks — feedback submitted')
    },
    onError: (e) => error(e, 'toast.feedback.submit.error', 'Failed to submit feedback'),
  })
}

export function useFeedbackList(params: FeedbackListParams = {}) {
  return useQuery({
    queryKey: feedbackKeys.list(params),
    queryFn: ({ signal }) =>
      request<FeedbackListResponse>(`/admin/feedback${buildQuery(params)}`, { signal }),
    placeholderData: keepPreviousData,
  })
}

export function useUpdateFeedback() {
  const qc = useQueryClient()
  const { success, error } = useMutationToast()
  return useMutation({
    mutationFn: ({ id, update }: { id: number; update: FeedbackUpdateInput }) =>
      request<FeedbackEntry>(`/admin/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: feedbackKeys.all })
      success('toast.feedback.update.success', 'Feedback updated')
    },
    onError: (e) => error(e, 'toast.feedback.update.error', 'Failed to update feedback'),
  })
}
