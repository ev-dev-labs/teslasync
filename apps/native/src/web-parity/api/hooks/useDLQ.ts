import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request, SudoCanceledError} from '../client';
import {useMutationToast} from './_toastHelpers';

const INTERVALS = {
  STANDARD: 30_000,
} as const;

const STALE_TIMES = {
  MODERATE: 30_000,
  STATIC: Infinity,
} as const;

const PAGINATION = {
  DEFAULT_LIMIT: 50,
} as const;

export {SudoCanceledError};

export type DLQReplayResult =
  | 'ok'
  | 'publish_failed'
  | 'rate_limited'
  | 'disabled'
  | 'not_found'
  | 'unparseable';

export interface DLQEntrySummary {
  id: number;
  arrived_at: string;
  dlq_topic: string;
  parsed_reason: string;
  parsed_vehicle_id: number | null;
  parsed_vin: string | null;
  parsed_source_topic: string | null;
  parsed_redeliveries: number | null;
  parsed_timestamp: string | null;
  parse_error: string | null;
  replayable: boolean;
  raw_payload_size: number;
  inner_payload_size: number;
}

export interface DLQEntryFull extends DLQEntrySummary {
  raw_payload_b64: string;
  inner_payload_b64: string;
}

export interface DLQListResponse {
  count: number;
  replay_enabled: boolean;
  entries: DLQEntrySummary[];
}

export interface DLQReplayResponse {
  ok: boolean;
  replayed_id: number;
  dst_topic: string;
  result: DLQReplayResult;
  error?: string;
  audit_id?: number;
}

export interface DLQReplayAuditRecord {
  id: number;
  replayed_at: string;
  actor: string;
  actor_ip: string;
  dlq_id: number;
  src_topic: string;
  dst_topic: string;
  payload: string;
  reason: string;
  result: DLQReplayResult;
  error: string;
  trace_id: string;
}

export interface DLQAuditResponse {
  count: number;
  limit: number;
  dlq_id: number;
  rows: DLQReplayAuditRecord[];
}

export const dlqKeys = {
  list: ['system', 'dlq', 'list'] as const,
  entry: (id: number) => ['system', 'dlq', 'entry', id] as const,
  audit: (limit: number) => ['system', 'dlq', 'audit', limit] as const,
  entryAudit: (id: number, limit: number) =>
    ['system', 'dlq', 'entry', id, 'audit', limit] as const,
};

export function useDLQList() {
  return useQuery({
    queryKey: dlqKeys.list,
    queryFn: ({signal}) => request<DLQListResponse>('/system/dlq', {signal}),
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useDLQEntry(id: number | null | undefined, enabled = true) {
  const numericId = typeof id === 'number' && id > 0 ? id : 0;
  return useQuery({
    queryKey: dlqKeys.entry(numericId),
    queryFn: ({signal}) =>
      request<DLQEntryFull>(`/system/dlq/${numericId}`, {signal}),
    enabled: enabled && numericId > 0,
    staleTime: STALE_TIMES.STATIC,
    retry: 1,
  });
}

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
    queryFn: ({signal}) => {
      const url = scoped
        ? `/system/dlq/${dlqId}/audit?limit=${limit}`
        : `/system/dlq/audit?limit=${limit}`;
      return request<DLQAuditResponse>(url, {signal});
    },
    staleTime: STALE_TIMES.MODERATE,
    refetchInterval: INTERVALS.STANDARD,
    refetchIntervalInBackground: false,
    retry: 1,
  });
}

export function useDLQReplay() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation<DLQReplayResponse, Error, {id: number}>({
    mutationFn: ({id}) =>
      request<DLQReplayResponse>(`/system/dlq/${id}/replay`, {
        method: 'POST',
      }),
    onSuccess: res => {
      qc.invalidateQueries({queryKey: ['system', 'dlq']});
      success('admin.dlq.toast.replaySuccess', 'Replay published to {{topic}}', {
        topic: res.dst_topic,
      });
    },
    onError: err => {
      if (err instanceof SudoCanceledError) {
        return;
      }
      const status = (err as {status?: number}).status;
      if (status === 403) {
        return;
      }
      error(err, 'admin.dlq.toast.replayError', 'Replay failed');
    },
  });
}
