import { vi } from 'vitest';
import type { ChartAnnotationRow, DataAnnotation } from '@/types/annotations';

/**
 * Inverse of `toDataAnnotation`: lets a test describe annotations in the
 * chart-render shape while ChartContainer reads backend rows from
 * `useChartAnnotations`.
 */
export function annotationRowFrom(annotation: DataAnnotation): ChartAnnotationRow {
  return {
    id: Number(annotation.id),
    occurred_at: annotation.timestamp,
    title: annotation.label,
    description: annotation.description ?? null,
    category: annotation.category,
    scope: annotation.context ? [annotation.context] : [],
    vehicle_id: annotation.vehicleId ?? null,
    created_at: annotation.createdAt ?? annotation.timestamp,
    updated_at: annotation.createdAt ?? annotation.timestamp,
  };
}

/** A settled `useChartAnnotations` result carrying `annotations` as rows. */
export function annotationQueryDouble(annotations: readonly DataAnnotation[] = []) {
  return {
    data: annotations.map(annotationRowFrom),
    isPending: false,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    fetchStatus: 'idle' as const,
    dataUpdatedAt: 0,
    refetch: vi.fn(),
  };
}
