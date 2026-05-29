/**
 * @module api/hooks/useDLQ
 *
 * TanStack Query bindings for the dead-letter queue inspector routes
 * mounted under `/api/v1/system/dlq*`. Backed by Go handlers in
 * `internal/api/dlq_handler.go`.
 *
 * Endpoint summary (router.go ~L3520):
 *   GET    /system/dlq                  → DLQListResponse
 *   GET    /system/dlq/audit            → DLQAuditResponse  (global, last N)
 *   GET    /system/dlq/{id}             → DLQEntryFull
 *   GET    /system/dlq/{id}/audit       → DLQAuditResponse  (scoped)
 *   POST   /system/dlq/{id}/replay      → DLQReplayResponse (sudo-gated)
 *
 * The shared `request()` client auto-prepends `/api/v1` and transparently
 * handles `SUDO_REQUIRED` 401s by re-opening the mounted ReauthDialog,
 * so the replay mutation needs no special-case sudo plumbing. The one
 * non-sudo failure mode worth surfacing is the `DLQ_REPLAY_ENABLED=false`
 * env gate which the handler returns as HTTP 403 with
 * `{ result: "disabled" }` — pages should branch on `error.status === 403`.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { request, SudoCanceledError } from '../client';
import { INTERVALS, STALE_TIMES, PAGINATION } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import type {
  DLQListResponse,
  DLQEntryFull,
  DLQAuditResponse,
  DLQReplayResponse,
} from '@/types/admin-diagnostics';

export { SudoCanceledError };

export const dlqKeys = {
  list: ['system', 'dlq', 'list'] as const,
  entry: (id: number) => ['system', 'dlq', 'entry', id] as const,
  audit: (limit: number) => ['system', 'dlq', 'audit', limit] as const,
  entryAudit: (id: number, limit: number) =>
    ['system', 'dlq', 'entry', id, 'audit', limit] as const,
};

/**
 * List of recent DLQ entries plus the server-side `replay_enabled` flag
 * (mirrors `DLQ_REPLAY_ENABLED` env). Polled at INTERVALS.STANDARD; the
 * DLQ shouldn't move quickly under normal operation so a 30 s cadence is
 * generous without flooding the read path.
 */
export function useDLQList() {
  return useQuery({
    queryKey: dlqKeys.list,
    queryFn: ({ signal }) =>
      request<DLQListResponse>('/system/dlq', { signal }),
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * Full DLQ entry (summary fields + raw + inner payload, base64). Disabled
 * until `id` is truthy + `enabled` is true so the drawer can lazy-load on
 * open. `staleTime: STATIC` because a stored DLQ row never changes — once
 * fetched it's safe to read from cache for the lifetime of the page.
 */
export function useDLQEntry(id: number | null | undefined, enabled = true) {
  const numericId = typeof id === 'number' && id > 0 ? id : 0;
  return useQuery({
    queryKey: dlqKeys.entry(numericId),
    queryFn: ({ signal }) =>
      request<DLQEntryFull>(`/system/dlq/${numericId}`, { signal }),
    enabled: enabled && numericId > 0,
    staleTime: STALE_TIMES.STATIC,
    retry: 1,
  });
}

/**
 * Recent replay-audit rows. Pass `dlqId` to scope to a single entry's
 * replay history; omit it (or pass 0) for the global feed. `limit` mirrors
 * the server-side query param and caps at PAGINATION.MAX_LIMIT.
 */
export function useDLQAudit(
  dlqId?: number | null,
  limit: number = PAGINATION.DEFAULT_LIMIT,
) {
  const scoped = typeof dlqId === 'number' && dlqId > 0;
  const queryKey = scoped
    ? dlqKeys.entryAudit(dlqId, limit)
    : dlqKeys.audit(limit);

  return useQuery({
    queryKey,
    queryFn: ({ signal }) => {
      const url = scoped
        ? `/system/dlq/${dlqId}/audit?limit=${limit}`
        : `/system/dlq/audit?limit=${limit}`;
      return request<DLQAuditResponse>(url, { signal });
    },
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

/**
 * Replay a single DLQ entry (sudo-gated). Toast handling is split:
 *
 *   • Success path                → green success toast
 *   • SudoCanceledError (user X'd ReauthDialog) → silent, no toast
 *   • status === 403              → caller surfaces a "replay disabled"
 *                                    banner instead of a toast (env flag,
 *                                    not transient)
 *   • Any other error             → red error toast via _toastHelpers
 *
 * The mutation also invalidates the list + audit feed so the UI re-renders
 * with the new audit row and the entry's updated state.
 */
export function useDLQReplay() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation<DLQReplayResponse, Error, { id: number }>({
    mutationFn: ({ id }) =>
      request<DLQReplayResponse>(`/system/dlq/${id}/replay`, {
        method: 'POST',
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['system', 'dlq'] });
      success('admin.dlq.toast.replaySuccess', 'Replay published to {{topic}}', {
        topic: res.dst_topic,
      });
    },
    onError: (err) => {
      if (err instanceof SudoCanceledError) return;
      // Disabled (403) is handled as a banner by the page, not a toast,
      // because the operator needs to read a longer remediation message
      // than the toast surface affords.
      const status = (err as { status?: number }).status;
      if (status === 403) return;
      error(err, 'admin.dlq.toast.replayError', 'Replay failed');
    },
  });
}
