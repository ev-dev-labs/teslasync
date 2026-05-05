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

