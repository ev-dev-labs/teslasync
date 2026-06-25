import {useMemo} from 'react';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {request} from '../client';
import {useMutationToast} from './_toastHelpers';

const STALE_TIMES = {
  SLOW: 5 * 60_000,
} as const;

export type AnnotationCategory =
  | 'milestone'
  | 'maintenance'
  | 'trip'
  | 'issue'
  | 'upgrade'
  | 'custom';

export type AnnotationScope =
  | 'battery'
  | 'efficiency'
  | 'cost'
  | 'tire'
  | 'energy'
  | 'drivetrain'
  | 'mileage'
  | 'charging';

export interface DataAnnotation {
  id: string;
  timestamp: string;
  label: string;
  description?: string;
  category: AnnotationCategory;
  context: string;
  vehicleId?: number;
  createdAt: string;
}

export interface ChartAnnotationRow {
  id: number;
  user_id?: number | null;
  vehicle_id?: number | null;
  occurred_at: string;
  category: AnnotationCategory;
  title: string;
  description?: string | null;
  scope: string[];
  color?: string | null;
  created_at: string;
  updated_at: string;
}

export function toDataAnnotation(row: ChartAnnotationRow): DataAnnotation {
  return {
    id: String(row.id),
    timestamp: row.occurred_at,
    label: row.title,
    description: row.description ?? undefined,
    category: row.category,
    context: row.scope[0] ?? '',
    vehicleId: row.vehicle_id ?? undefined,
    createdAt: row.created_at,
  };
}

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
  if (params.vehicleId != null) {
    usp.append('vehicle_id', String(params.vehicleId));
  }
  if (params.scope) {
    usp.append('scope', params.scope);
  }
  if (params.from) {
    usp.append('from', params.from);
  }
  if (params.to) {
    usp.append('to', params.to);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

function invalidateAnnotationQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({queryKey: annotationKeys.all});
}

export function useChartAnnotations(params: AnnotationListParams = {}) {
  return useQuery({
    queryKey: annotationKeys.list(params),
    queryFn: ({signal}) =>
      request<ChartAnnotationRow[]>(`/annotations${buildQuery(params)}`, {
        signal,
      }),
    staleTime: STALE_TIMES.SLOW,
  });
}

export function useChartAnnotationsAsData(
  params: AnnotationListParams = {},
): {
  annotations: DataAnnotation[];
  isLoading: boolean;
} {
  const {data, isLoading} = useChartAnnotations(params);
  const annotations = useMemo<DataAnnotation[]>(
    () => (data ?? []).map(toDataAnnotation),
    [data],
  );
  return {annotations, isLoading};
}

export function useCreateAnnotation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (input: CreateAnnotationInput) =>
      request<ChartAnnotationRow>('/annotations', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      invalidateAnnotationQueries(qc);
      success('toast.annotation.created.success', 'Annotation added');
    },
    onError: e =>
      error(e, 'toast.annotation.created.error', 'Failed to add annotation'),
  });
}

export function useUpdateAnnotation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: ({id, ...patch}: UpdateAnnotationInput) =>
      request<ChartAnnotationRow>(`/annotations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      invalidateAnnotationQueries(qc);
      success('toast.annotation.updated.success', 'Annotation updated');
    },
    onError: e =>
      error(e, 'toast.annotation.updated.error', 'Failed to update annotation'),
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  const {success, error} = useMutationToast();
  return useMutation({
    mutationFn: (id: number) =>
      request<void>(`/annotations/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      invalidateAnnotationQueries(qc);
      success('toast.annotation.deleted.success', 'Annotation removed');
    },
    onError: e =>
      error(e, 'toast.annotation.deleted.error', 'Failed to remove annotation'),
  });
}
