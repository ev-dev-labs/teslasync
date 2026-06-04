import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { Trip } from '@/api/types';

export const tripKeys = {
  all: ['trips'] as const,
  detail: (id: string) => ['trips', id] as const,
};

export interface UseTripParams {
  vehicle_id?: number;
  limit?: number;
  offset?: number;
  start?: string;
  end?: string;
}

export function useTrips(params?: UseTripParams) {
  const sp = new URLSearchParams();
  if (params?.vehicle_id) sp.set('vehicle_id', String(params.vehicle_id));
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.offset != null && params.offset > 0) sp.set('offset', String(params.offset));
  if (params?.start) sp.set('start', params.start);
  if (params?.end) sp.set('end', params.end);
  const qs = sp.toString();

  return useQuery({
    queryKey: [...tripKeys.all, params ?? {}],
    queryFn: ({ signal }) => request<Trip[]>(qs ? `/trips?${qs}` : '/trips', { signal }),
    select: safeArray,
  });
}

/**
 * @deprecated Backend has no `GET /trips/{id}` route — only `GET /trips`
 * (list) is registered in `internal/api/router.go`. Calls made by this
 * hook will resolve to a 404 from the backend and surface through
 * tanstack-query's `error` channel; consumers (TripDetailPage) display
 * the error gracefully via the standard PageContainer error path.
 *
 * Retained because removing it would break the consumer at compile time;
 * the UI shape should remain in place until the backend adds a replacement
 * endpoint.
 */
export function useTrip(id: string) {
  return useQuery({
    queryKey: tripKeys.detail(id),
    queryFn: ({ signal }) => request<Trip>(`/trips/${id}`, { signal }),
    enabled: !!id,
  });
}
