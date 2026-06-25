import {useQuery} from '@tanstack/react-query';

import {request} from '../client';

function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

export interface Trip {
  id: number;
  vehicle_id: number;
  name: string | null;
  start_date: string;
  end_date: string | null;
  started_at: string;
  ended_at: string | null;
  total_distance_m: number;
  total_energy_wh: number;
  total_duration_s: number;
  total_cost: number;
  drive_count: number;
  charge_count: number;
  created_at: string;
  created_by_user?: number | null;
  auto_generated?: boolean;
  notes?: string | null;
}

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
  if (params?.vehicle_id) {
    sp.append('vehicle_id', String(params.vehicle_id));
  }
  if (params?.limit) {
    sp.append('limit', String(params.limit));
  }
  if (params?.offset != null && params.offset > 0) {
    sp.append('offset', String(params.offset));
  }
  if (params?.start) {
    sp.append('start', params.start);
  }
  if (params?.end) {
    sp.append('end', params.end);
  }
  const qs = sp.toString();

  return useQuery({
    queryKey: [...tripKeys.all, params ?? {}],
    queryFn: ({signal}) => request<Trip[]>(qs ? `/trips?${qs}` : '/trips', {signal}),
    select: safeArray,
  });
}

/**
 * @deprecated Backend has no `GET /trips/{id}` route - only `GET /trips`
 * (list) is registered in `internal/api/router.go`. Calls made by this
 * hook will resolve to a 404 from the backend and surface through
 * tanstack-query's `error` channel; consumers display the error gracefully
 * through their standard error path.
 *
 * Retained because removing it would break consumers at compile time; the UI
 * shape should remain in place until the backend adds a replacement endpoint.
 */
export function useTrip(id: string) {
  return useQuery({
    queryKey: tripKeys.detail(id),
    queryFn: ({signal}) => request<Trip>(`/trips/${id}`, {signal}),
    enabled: !!id,
  });
}
