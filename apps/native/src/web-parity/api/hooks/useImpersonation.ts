import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {isApiError, request, type ApiError} from '../client';
import {useMutationToast} from './_toastHelpers';

export type ImpersonationStatus =
  | {mode: 'open'}
  | {mode: 'inactive'}
  | {
      mode: 'active';
      original_admin: string;
      target: string;
      expires_at: string;
    };

export interface ImpersonationCandidate {
  subject: string;
}

export type ImpersonationCandidatesResponse =
  | {mode: 'open'}
  | {
      mode: 'session';
      candidates: ImpersonationCandidate[];
    };

export interface ImpersonationStartRequest {
  subject: string;
}

export const impersonationKeys = {
  status: ['impersonation', 'status'] as const,
  candidates: ['impersonation', 'candidates'] as const,
};

const AUTH_MODE_OPEN_CODE = 'AUTH_MODE_OPEN';

interface ImpersonationStatePayload {
  mode: 'inactive' | 'active';
  original_admin?: string;
  target?: string;
  expires_at?: string;
}

export function useImpersonationStatus(options?: {enabled?: boolean}) {
  return useQuery<ImpersonationStatus, ApiError>({
    queryKey: impersonationKeys.status,
    queryFn: async ({signal}) => {
      try {
        const payload = await request<ImpersonationStatePayload>(
          '/admin/impersonate',
          {signal},
        );
        if (payload.mode === 'active') {
          return {
            mode: 'active',
            original_admin: payload.original_admin ?? '',
            target: payload.target ?? '',
            expires_at: payload.expires_at ?? '',
          };
        }
        return {mode: 'inactive'};
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return {mode: 'open'};
        }
        throw err;
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
    enabled: options?.enabled ?? true,
  });
}

export function isImpersonationOpenMode(
  status: ImpersonationStatus | undefined,
): boolean {
  return status?.mode === 'open';
}

export function isImpersonationActive(
  status: ImpersonationStatus | undefined,
): boolean {
  return status?.mode === 'active';
}

export function useImpersonationCandidates(options?: {enabled?: boolean}) {
  return useQuery<ImpersonationCandidatesResponse, ApiError>({
    queryKey: impersonationKeys.candidates,
    queryFn: async ({signal}) => {
      try {
        const payload = await request<{
          mode: 'session';
          candidates: ImpersonationCandidate[];
        }>('/admin/impersonate/candidates', {signal});
        return {
          mode: 'session',
          candidates: payload.candidates ?? [],
        };
      } catch (err) {
        if (isApiError(err) && err.code === AUTH_MODE_OPEN_CODE) {
          return {mode: 'open'};
        }
        throw err;
      }
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: options?.enabled ?? false,
  });
}

export function useStartImpersonation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();

  return useMutation<ImpersonationStatus, ApiError, ImpersonationStartRequest>({
    mutationFn: body =>
      request<ImpersonationStatus>('/admin/impersonate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: data => {
      qc.setQueryData(impersonationKeys.status, data);
      void qc.invalidateQueries();
      success('impersonation.toast.started', 'Impersonation started');
    },
    onError: err =>
      error(
        err,
        'impersonation.toast.startFailed',
        'Failed to start impersonation',
      ),
  });
}

export function useEndImpersonation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();

  return useMutation<void, ApiError, void>({
    mutationFn: async () => {
      await request<void>('/admin/impersonate/end', {method: 'POST'});
    },
    onSuccess: () => {
      qc.setQueryData<ImpersonationStatus>(impersonationKeys.status, {
        mode: 'inactive',
      });
      void qc.invalidateQueries();
      success('impersonation.toast.ended', 'Impersonation ended');
    },
    onError: err =>
      error(
        err,
        'impersonation.toast.endFailed',
        'Failed to end impersonation',
      ),
  });
}
