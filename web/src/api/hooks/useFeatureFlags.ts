/**
 * @module api/hooks/useFeatureFlags
 *
 * TanStack Query bindings for the typed feature-flag registry mounted
 * under `/api/v1/system/flags*`. Backed by Go handlers in
 * `internal/api/apiflagsh/handler.go`.
 *
 * Endpoint summary (router.go ~L3540):
 *   GET /system/flags → FeatureFlagsListResponse
 *   GET /system/flags/changes → FeatureFlagChangesResponse
 *   GET /system/flags/{key} → FeatureFlagEntry
 *   GET /system/flags/{key}/changes → FeatureFlagChangesResponse
 *   PUT /system/flags/{key} → FeatureFlagWriteResponse (sudo)
 *   DELETE /system/flags/{key}?reason=… → FeatureFlagWriteResponse (sudo)
 *
 * Sudo handling is fully delegated to the shared `request` interceptor
 * `SUDO_REQUIRED` 401s reopen the mounted ReauthDialog and the mutation
 * resolves transparently on a successful step-up. User-cancel resolves as
 * SudoCanceledError and is swallowed silently in onError.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { request, SudoCanceledError } from '../client';
import { INTERVALS, STALE_TIMES, PAGINATION } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import type {
  FeatureFlagsListResponse,
  FeatureFlagEntry,
  FeatureFlagSetRequest,
  FeatureFlagWriteResponse,
  FeatureFlagChangesResponse,
  FeatureFlagValue,
} from '@/types/admin-diagnostics';

export { SudoCanceledError };

export const featureFlagKeys = {
  list: ['system', 'flags', 'list'] as const,
  flag: (key: string) => ['system', 'flags', 'flag', key] as const,
  changes: (flagKey: string | null, limit: number) =>
    ['system', 'flags', 'changes', flagKey ?? '__all__', limit] as const,
};

/**
 * Full registry of currently-stored flags. 30 s refetch interval keeps the
 * page in lock-step with operator changes from a peer admin session
 * without thrashing the DB.
 */
export function useFlags() {
  return useQuery({
    queryKey: featureFlagKeys.list,
    queryFn: ({ signal }) =>
      request<FeatureFlagsListResponse>('/system/flags', { signal }),
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/** Single-flag fetcher used to refresh the edit drawer post-save. */
export function useFlag(key: string | null | undefined) {
  return useQuery({
    queryKey: featureFlagKeys.flag(key ?? ''),
    queryFn: ({ signal }) =>
      request<FeatureFlagEntry>(`/system/flags/${encodeURIComponent(key ?? '')}`, {
        signal,
      }),
    enabled: typeof key === 'string' && key.length > 0,
    staleTime: STALE_TIMES.MODERATE,
    retry: 1,
  });
}

/**
 * Flag-change audit feed. Pass `flagKey` to scope to a single flag's
 * history; omit (or null) for the global feed across every flag.
 */
export function useFlagChanges(
  flagKey?: string | null,
  limit: number = PAGINATION.DEFAULT_LIMIT,
) {
  const scoped = typeof flagKey === 'string' && flagKey.length > 0;
  return useQuery({
    queryKey: featureFlagKeys.changes(scoped ? flagKey : null, limit),
    queryFn: ({ signal }) => {
      const url = scoped
        ? `/system/flags/${encodeURIComponent(flagKey)}/changes?limit=${limit}`
        : `/system/flags/changes?limit=${limit}`;
      return request<FeatureFlagChangesResponse>(url, { signal });
    },
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * Create or update a single flag (sudo-gated). The mutation invalidates
 * both the list and the per-flag change feed so the table + audit panel
 * re-render with the new value and the matching audit row.
 */
export function useSetFlag() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation<
    FeatureFlagWriteResponse,
    Error,
    { key: string; value: FeatureFlagValue; reason: string }
  >({
    mutationFn: ({ key, value, reason }) => {
      if (typeof value !== 'string') {
        throw new TypeError('Feature flag values must be strings');
      }
      const body: FeatureFlagSetRequest = { value, reason };
      return request<FeatureFlagWriteResponse>(
        `/system/flags/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          requiresLiveMode: true,
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['system', 'flags'] });
      qc.invalidateQueries({ queryKey: featureFlagKeys.flag(vars.key) });
      success('admin.flags.toast.saveSuccess', 'Flag "{{key}}" saved', {
        key: vars.key,
      });
    },
    onError: (err) => {
      if (err instanceof SudoCanceledError) return;
      error(err, 'admin.flags.toast.saveError', 'Failed to save flag');
    },
  });
}

/**
 * `deleted` is omitted for an absent flag by Go's omitempty. Audit ID zero
 * means the store operation completed without a persisted audit row.
 */
export function assertFeatureFlagDeleteResult(
  result: FeatureFlagWriteResponse | null | undefined,
  key: string,
): void {
  if (
    !result ||
    result.key !== key ||
    (result.deleted !== undefined && typeof result.deleted !== 'boolean') ||
    !Number.isSafeInteger(result.audit_id) ||
    result.audit_id < 0
  ) {
    throw new Error('The server returned an invalid flag deletion result; deletion and audit persistence could not be confirmed.');
  }
  if (result.audit_id === 0) {
    throw new Error(
      result.deleted === true
        ? 'The flag was deleted, but the change was not recorded in the audit feed.'
        : 'The flag was already absent, but the delete attempt was not recorded in the audit feed.',
    );
  }
}

/**
 * Delete a single flag (sudo-gated). `reason` is required by the
 * backend audit. Only a confirmed, audited outcome resolves the mutation.
 */
export function useDeleteFlag() {
  const qc = useQueryClient();
  const { success, warning, error } = useMutationToast();
  return useMutation<FeatureFlagWriteResponse, Error, { key: string; reason: string }>({
    mutationFn: async ({ key, reason }) => {
      const qs = new URLSearchParams({ reason }).toString();
      const result = await request<FeatureFlagWriteResponse>(
        `/system/flags/${encodeURIComponent(key)}?${qs}`,
        { method: 'DELETE', requiresLiveMode: true },
      );
      assertFeatureFlagDeleteResult(result, key);
      return result;
    },
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ['system', 'flags'] });
      qc.invalidateQueries({ queryKey: featureFlagKeys.flag(vars.key) });
      if (res.deleted !== true) {
        warning('toast.noChanges', 'No changes');
        return;
      }
      success('admin.flags.toast.deleteSuccess', 'Flag "{{key}}" deleted', {
        key: vars.key,
      });
    },
    onError: (err) => {
      if (err instanceof SudoCanceledError) return;
      // The registry may have changed even when audit persistence failed.
      qc.invalidateQueries({ queryKey: ['system', 'flags'] });
      error(err, 'admin.flags.toast.deleteError', 'Failed to delete flag');
    },
  });
}
