import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { Trip, TripDetail } from '@/api/types';

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

/**
 * Fetch the trip list from `GET /trips` (registered in
 * `internal/api/router.go`). Optional {@link UseTripParams} become
 * snake_case query params — the backend convention. Only meaningful values
 * are serialised: a zero/negative `limit` or a non-positive `offset` is
 * omitted so the URL never carries a nonsensical page window, and a falsy
 * `vehicle_id` (0 is never a valid primary key) is dropped. The response is
 * run through {@link safeArray} so a Go `nil` slice — which marshals to JSON
 * `null` — becomes `[]` instead of crashing a downstream `.map`.
 */
export function useTrips(params?: UseTripParams) {
  const sp = new URLSearchParams();
  if (params?.vehicle_id) sp.set('vehicle_id', String(params.vehicle_id));
  if (params?.limit != null && params.limit > 0) sp.set('limit', String(params.limit));
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
 * Fetch a single trip with its per-drive breakdown from
 * `GET /trips/{trip_id}` (registered in `internal/api/router.go`, served by
 * `internal/api/tripsdetail`). Returns a {@link TripDetail} — a superset of
 * the list-shape {@link Trip} that additionally carries `drives[]` and the
 * `energy_used_wh` alias. A missing/deleted trip surfaces as a 404 through
 * tanstack-query's `error` channel; the consumer renders it via `QueryError`.
 */
export function useTrip(id: string) {
  return useQuery({
    queryKey: tripKeys.detail(id),
    // encodeURIComponent keeps a stray slash / special char in the id from
    // escaping the `/trips/{trip_id}` route segment. Numeric ids pass through
    // unchanged, so existing callers are unaffected.
    queryFn: ({ signal }) => request<TripDetail>(`/trips/${encodeURIComponent(id)}`, { signal }),
    enabled: !!id,
  });
}
