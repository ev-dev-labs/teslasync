import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { useDeferredMutationToast, useMutationToast } from './_toastHelpers';
import { STALE_TIMES } from '@/lib/constants';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import type {
  AnnotationCategory,
  AnnotationScope,
  ChartAnnotationRow,
  DataAnnotation,
} from '@/types/annotations';
import { toDataAnnotation } from '@/types/annotations';

/**
 * TanStack Query hooks for the durable chart-annotation store. Replaces
 * the localStorage-only `useAnnotations` hook in
 * `web/src/hooks/useAnnotations.ts` (which is now a thin compat wrapper that
 * delegates to these hooks).
 *
 * Wire contract: see `internal/api/chart_annotation_handler.go`.
 */

export const annotationKeys = {
  all: ['annotations'] as const,
  list: (params: AnnotationListParams) =>
    [
      'annotations',
      params.vehicleId ?? 'all',
      params.scope ?? 'all',
      params.from ?? '',
      params.to ?? '',
    ] as const,
};

export interface AnnotationListParams {
  vehicleId?: number | null;
  scope?: AnnotationScope;
  from?: string;
  to?: string;
  enabled?: boolean;
}

export interface CreateAnnotationInput {
  vehicle_id?: number | null;
  occurred_at: string;
  category: AnnotationCategory;
  title: string;
  description?: string;
  scope?: AnnotationScope[];
  color?: string;
}

export interface UpdateAnnotationInput {
  id: number;
  occurred_at?: string;
  category?: AnnotationCategory;
  title?: string;
  description?: string;
  scope?: AnnotationScope[];
  color?: string;
  clear_description?: boolean;
  clear_color?: boolean;
}

function buildQuery(params: AnnotationListParams): string {
  const usp = new URLSearchParams();
  if (params.vehicleId != null) usp.set('vehicle_id', String(params.vehicleId));
  if (params.scope) usp.set('scope', params.scope);
  if (params.from) usp.set('from', params.from);
  if (params.to) usp.set('to', params.to);
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Fetch annotations from the backend, scoped to an optional vehicle / chart
 * bucket / time window. The backend returns rows pinned to the vehicle PLUS
 * fleet-wide rows (vehicle_id IS NULL) so a single utility-rate annotation
 * shows up on every vehicle's cost chart.
 */
export function useChartAnnotations(params: AnnotationListParams = {}) {
  return useQuery({
    queryKey: annotationKeys.list(params),
    queryFn: ({ signal }) => request<ChartAnnotationRow[]>(`/annotations${buildQuery(params)}`, { signal }),
    staleTime: STALE_TIMES.SLOW,
    enabled: params.enabled ?? true,
  });
}

/**
 * Convenience wrapper — returns the data already projected onto the
 * `DataAnnotation` shape the existing `<AnnotationList>` and
 * `renderAnnotationLines()` consumers expect. The projected list is memoised
 * so chart consumers don't re-render every poll cycle.
 *
 * `isError` / `error` are passed through so a consumer that renders ONLY the
 * annotation overlay (and never touches {@link useChartAnnotations} directly)
 * can still surface a failed fetch instead of silently showing an empty list.
 */
export function useChartAnnotationsAsData(params: AnnotationListParams = {}): {
  annotations: DataAnnotation[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const { data, isLoading, isError, error } = useChartAnnotations(params);
  const annotations = useMemo<DataAnnotation[]>(
    () => (Array.isArray(data) ? data : []).map(toDataAnnotation),
    [data],
  );
  return { annotations, isLoading, isError, error };
}

export function useCreateAnnotation() {
  const qc = useQueryClient();
  const { success, error } = useDeferredMutationToast();
  return useMutation({
    mutationFn: (input: CreateAnnotationInput) =>
      request<ChartAnnotationRow>('/annotations', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: annotationKeys.all });
      success('toast.annotation.created.success', 'Annotation added');
    },
    onError: (e) => error(e, 'toast.annotation.created.error', 'Failed to add annotation'),
  });
}

export function useUpdateAnnotation() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateAnnotationInput) =>
      request<ChartAnnotationRow>(`/annotations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: annotationKeys.all });
      success('toast.annotation.updated.success', 'Annotation updated');
    },
    onError: (e) => error(e, 'toast.annotation.updated.error', 'Failed to update annotation'),
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  const { success, error } = useDeferredMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/annotations/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidateAndBroadcast(qc, { queryKey: annotationKeys.all });
      success('toast.annotation.deleted.success', 'Annotation removed');
    },
    onError: (e) => error(e, 'toast.annotation.deleted.error', 'Failed to remove annotation'),
  });
}
