import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type { ExportJob } from '@/types/export';

export const exportKeys = {
  all: ['exports'] as const,
  detail: (id: string) => ['exports', id] as const,
  jobs: ['export-jobs'] as const,
  job: (id: string) => ['export-jobs', id] as const,
  /** Phase-46/62 — column-picker catalog cache key, keyed by export type so
   *  switching the wizard between drives/charging triggers a separate
   *  fetch instead of stale-flashing the previous catalog. */
  columns: (type: string) => ['export-columns', type] as const,
  /** Phase-46/65 — recurring "scheduled exports" cache key. The list
   *  is per-user (server enforces by FORWARD_AUTH_HEADER), so the key
   *  is identity-free; refetch on auth change is the consumer's job
   *  via TanStack Query's standard invalidation. */
  scheduled: ['scheduled-exports'] as const,
};

/** Backwards-compatible: legacy hook used by the dashboard ExportStatusWidget.
 *  Hits the `/exports` v1 endpoint that returns the user's hexagonal-architecture
 *  export job summaries. */
export function useExports() {
  return useQuery({
    queryKey: exportKeys.all,
    queryFn: ({ signal }) => request<ExportJob[]>('/export/jobs', { signal }),
    select: safeArray,
  });
}

/** Job summary as exposed by the legacy /export/jobs endpoint. Mirrors the
 *  Go `models.ExportJobSummary` shape (snake_case fields). */
export interface ExportJobSummary {
  id: string;
  type: string;
  format: string;
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'expired';
  vehicle_id?: number;
  file_name?: string;
  file_size?: number;
  record_count?: number;
  error_message?: string;
  duration_ms?: number;
  created_at: string;
  completed_at?: string;
}

/** List recent export jobs. Polls every 5 seconds while there is at least
 *  one queued/processing job so the UI surfaces progress without manual
 *  refresh. Falls back to no polling when everything is settled. */
export function useExportJobs(opts?: { pollWhileActive?: boolean }) {
  const pollWhileActive = opts?.pollWhileActive ?? true;
  return useQuery({
    queryKey: exportKeys.jobs,
    queryFn: ({ signal }) => request<ExportJobSummary[]>('/export/jobs', { signal }),
    select: safeArray,
    refetchInterval: (query) => {
      if (!pollWhileActive) return false;
      const data = query.state.data as ExportJobSummary[] | undefined;
      const active = data?.some((j) => j.status === 'queued' || j.status === 'processing');
      return active ? 5_000 : false;
    },
  });
}

/** Poll a single export job by id. Stops polling once the job is ready/failed. */
export function useExportJob(id: string | undefined) {
  return useQuery({
    queryKey: id ? exportKeys.job(id) : exportKeys.jobs,
    queryFn: ({ signal }) => request<ExportJobSummary>(`/export/jobs/${id}`, { signal }),
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data as ExportJobSummary | undefined;
      if (!data) return 5_000;
      if (data.status === 'queued' || data.status === 'processing') return 5_000;
      return false;
    },
  });
}

export function useExport(id: string) {
  return useQuery({
    queryKey: exportKeys.detail(id),
    queryFn: ({ signal }) => request<ExportJob>(`/exports/${id}`, { signal }),
    enabled: !!id,
  });
}

/** Generic submit-export mutation against the legacy /export/jobs endpoint. */
export interface CreateExportPayload {
  type: 'drives' | 'charging' | 'analytics' | 'backup' | 'account';
  format?: 'csv' | 'json' | 'zip';
  vehicle_id?: number;
  start?: string;
  end?: string;
  /** Phase-46/62 — caller-supplied column allowlist. When omitted the
   *  backend writes every catalog column (legacy behaviour). When present
   *  the backend validates each entry against the catalog for `type`,
   *  silently re-prepends always-included columns, and emits the data
   *  in the caller-supplied order. */
  columns?: string[];
}

export function useCreateExport() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (payload: CreateExportPayload) =>
      request<ExportJobSummary>('/export/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(queryClient, { queryKey: exportKeys.jobs });
      invalidateAndBroadcast(queryClient, { queryKey: exportKeys.all });
      success('toast.export.create.success', 'Export started');
    },
    onError: (err: Error) => {
      error(err, 'toast.export.create.error', 'Failed to start export');
    },
  });
}

/** GDPR-style "Download my data" mutation. Optional vehicle_id and date range
 *  scope the export. The backend produces a ZIP with one CSV per allowed
 *  table plus a manifest.json. */
export interface CreateAccountExportPayload {
  vehicle_id?: number;
  start?: string;
  end?: string;
}

export function useCreateAccountExport() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (payload: CreateAccountExportPayload = {}) =>
      request<ExportJobSummary>('/export/jobs/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(queryClient, { queryKey: exportKeys.jobs });
      invalidateAndBroadcast(queryClient, { queryKey: exportKeys.all });
      success('toast.export.account.success', 'Account export queued');
    },
    onError: (err: Error) => {
      error(err, 'toast.export.account.error', 'Failed to queue account export');
    },
  });
}

/** Build the URL the browser should hit to download a finished export job's
 *  artifact. Uses the API client's URL builder so it works with the same
 *  `/api/v1` prefix as request(). */
export function exportDownloadUrl(jobId: string): string {
  return `/api/v1/export/jobs/${jobId}/download`;
}

export interface ExportBulkResult {
  deleted: number;
  failed: { id: string; reason: string }[];
}

/**
 * useBulkExportsDelete — POST /export/jobs/bulk
 * Phase-45 / Prompt 32. Deletes a batch of export-job UUIDs and refreshes
 * the jobs list + legacy /exports cache. Returns the server's report so
 * callers can surface partial-success counts.
 */
export function useBulkExportsDelete() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (ids: string[]) =>
      request<ExportBulkResult>('/export/jobs/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, op: 'delete' }),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: exportKeys.jobs });
      invalidateAndBroadcast(qc, { queryKey: exportKeys.all });
      success('toast.export.bulkDelete.success', 'Exports deleted');
    },
    onError: (err) =>
      error(err, 'toast.export.bulkDelete.error', 'Failed to delete exports'),
  });
}

// ---------------------------------------------------------------------------
// Phase-46 / Prompt 62 — column-selector catalog
// ---------------------------------------------------------------------------

/** Wire shape of a single column entry as returned by GET /exports/columns. */
export interface ExportColumnInfo {
  name: string;
  label: string;
  always_included: boolean;
}

/** Wire shape of the columns endpoint response. `columns` is empty when
 *  the export type is recognised but column selection isn't supported
 *  (e.g. account, backup, analytics). The frontend hides the picker when
 *  `supports_selection` is false. */
export interface ExportColumnsResponse {
  type: string;
  columns: ExportColumnInfo[];
  supports_selection: boolean;
}

/** Fetch the publishable column catalog for a given export type. The
 *  catalog is static per type, so we cache aggressively (5 minutes
 *  staleTime). Disabled when `type` is empty / unsupported so callers
 *  can wire it conditionally without additional guards. */
export function useExportColumns(type: string | undefined) {
  return useQuery({
    queryKey: exportKeys.columns(type ?? '__none__'),
    queryFn: ({ signal }) =>
      request<ExportColumnsResponse>(
        `/exports/columns?type=${encodeURIComponent(type ?? '')}`,
        { signal },
      ),
    enabled: !!type,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Phase-46 / Prompt 65 — recurring scheduled exports
// ---------------------------------------------------------------------------

/** Delivery dispatcher attached to a schedule. Mirrors the typed JSONB
 *  `delivery` column on the backend. `target` is required for `email` /
 *  `webhook`; for `download` it is silently ignored — the server also
 *  drops it on write so a stray value never round-trips. */
export interface ScheduledExportDelivery {
  kind: 'download' | 'email' | 'webhook';
  target?: string;
}

/** Wire shape of a row in `scheduled_exports`. Times are ISO-8601
 *  strings and are always UTC. Nullable columns are surfaced as
 *  `null` (not omitted) so the SPA doesn't have to guess between
 *  "field missing" and "field null". */
export interface ScheduledExport {
  id: number;
  owner_subject: string;
  name: string;
  export_type: 'drives' | 'charging' | 'trips' | 'positions' | 'signals';
  format: 'csv' | 'json';
  vehicle_id: number | null;
  /** `null` = "all columns" (legacy default). Empty array also means
   *  all-columns at write-time, but the server normalises to `null`. */
  columns: string[] | null;
  schedule_cron: string;
  delivery: ScheduledExportDelivery;
  range_window: string;
  enabled: boolean;
  last_run_at: string | null;
  last_status: 'ok' | 'failed' | null;
  last_error: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Create / update payload. The `owner_subject` field is intentionally
 *  absent — the server takes ownership from FORWARD_AUTH_HEADER and
 *  refuses any owner_subject in the body (DisallowUnknownFields). */
export interface ScheduledExportInput {
  name: string;
  export_type: ScheduledExport['export_type'];
  format: ScheduledExport['format'];
  vehicle_id?: number | null;
  columns?: string[];
  schedule_cron: string;
  delivery: ScheduledExportDelivery;
  range_window?: string;
  enabled?: boolean;
}

/** List the authenticated user's scheduled exports. Returns an empty
 *  array when the user has none, NOT undefined; consumers can iterate
 *  without a null guard. Polls every 60s in the foreground so a
 *  freshly fired schedule's last_run_at lands without manual refresh.
 *  Background polling stays paused per Phase-46/53 contract. */
export function useScheduledExports() {
  return useQuery({
    queryKey: exportKeys.scheduled,
    queryFn: ({ signal }) =>
      request<ScheduledExport[]>('/scheduled-exports', { signal }),
    select: safeArray,
    refetchInterval: 60_000,
  });
}

export function useCreateScheduledExport() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (payload: ScheduledExportInput) =>
      request<ScheduledExport>('/scheduled-exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: exportKeys.scheduled });
      success('toast.export.scheduled.create.success', 'Schedule created');
    },
    onError: (err: Error) =>
      error(err, 'toast.export.scheduled.create.error', 'Failed to create schedule'),
  });
}

export function useUpdateScheduledExport() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ScheduledExportInput }) =>
      request<ScheduledExport>(`/scheduled-exports/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: exportKeys.scheduled });
      success('toast.export.scheduled.update.success', 'Schedule updated');
    },
    onError: (err: Error) =>
      error(err, 'toast.export.scheduled.update.error', 'Failed to update schedule'),
  });
}

export function useDeleteScheduledExport() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/scheduled-exports/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: exportKeys.scheduled });
      success('toast.export.scheduled.delete.success', 'Schedule deleted');
    },
    onError: (err: Error) =>
      error(err, 'toast.export.scheduled.delete.error', 'Failed to delete schedule'),
  });
}

/** Manual "Run now" trigger — advances the schedule's next_run_at to
 *  now() so the server-side worker tick picks the row up on its next
 *  iteration. Returns the updated row so the SPA can refresh the
 *  table without a follow-up GET. */
export function useRunScheduledExportNow() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<ScheduledExport>(`/scheduled-exports/${id}/run`, { method: 'POST' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: exportKeys.scheduled });
      success('toast.export.scheduled.run.success', 'Schedule queued');
    },
    onError: (err: Error) =>
      error(err, 'toast.export.scheduled.run.error', 'Failed to queue schedule'),
  });
}

