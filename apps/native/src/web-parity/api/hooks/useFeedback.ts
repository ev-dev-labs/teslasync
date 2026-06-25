import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

export type FeedbackCategory = 'bug' | 'feature' | 'other';
export type FeedbackStatus = 'new' | 'triaged' | 'closed';

export interface FeedbackEntry {
  id: number;
  created_at: string;
  category: FeedbackCategory;
  title: string;
  body: string;
  page_route: string;
  user_agent: string;
  app_version: string;
  user_email: string;
  recent_errors: unknown;
  console_tail: string;
  status: FeedbackStatus;
  github_issue_url: string;
  submitter_subject: string;
  submitter_ip: string;
  triaged_at: string | null;
  triaged_by: string;
}

export interface FeedbackSubmitInput {
  category: FeedbackCategory;
  title: string;
  body: string;
  page_route?: string;
  user_agent?: string;
  app_version?: string;
  user_email?: string;
  recent_errors?: unknown;
  console_tail?: string;
}

export interface FeedbackUpdateInput {
  status?: FeedbackStatus;
  github_issue_url?: string;
  forward_to_github?: boolean;
}

export interface FeedbackListResponse {
  items: FeedbackEntry[];
  total: number;
  limit: number;
  offset: number;
  github_bridge_enabled: boolean;
  github_repo?: string;
}

export interface FeedbackListParams {
  status?: FeedbackStatus | '';
  category?: FeedbackCategory | '';
  limit?: number;
  offset?: number;
}

export const feedbackKeys = {
  all: ['feedback'] as const,
  list: (params: FeedbackListParams) => ['feedback', 'list', params] as const,
};

function buildQuery(params: FeedbackListParams): string {
  const sp = new URLSearchParams();
  if (params.status) {
    sp.append('status', params.status);
  }
  if (params.category) {
    sp.append('category', params.category);
  }
  if (typeof params.limit === 'number') {
    sp.append('limit', String(params.limit));
  }
  if (typeof params.offset === 'number') {
    sp.append('offset', String(params.offset));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export function useSubmitFeedback() {
  const {success, error} = useMutationToast();
  return useMutation<FeedbackEntry, Error, FeedbackSubmitInput>({
    mutationFn: input =>
      request<FeedbackEntry>('/feedback', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      success('toast.feedback.submit.success', 'Thanks \u2014 feedback submitted');
    },
    onError: e =>
      error(e, 'toast.feedback.submit.error', 'Failed to submit feedback'),
  });
}

export function useFeedbackList(params: FeedbackListParams = {}) {
  return useQuery({
    queryKey: feedbackKeys.list(params),
    queryFn: ({signal}) =>
      request<FeedbackListResponse>(`/admin/feedback${buildQuery(params)}`, {
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateFeedback() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation<
    FeedbackEntry,
    Error,
    {id: number; update: FeedbackUpdateInput}
  >({
    mutationFn: ({id, update}) =>
      request<FeedbackEntry>(`/admin/feedback/${id}`, {
        method: 'PATCH',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(update),
      }),
    onSuccess: () => {
      qc.invalidateQueries({queryKey: feedbackKeys.all});
      success('toast.feedback.update.success', 'Feedback updated');
    },
    onError: e =>
      error(e, 'toast.feedback.update.error', 'Failed to update feedback'),
  });
}
