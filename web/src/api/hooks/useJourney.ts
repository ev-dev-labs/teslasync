import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { queryPolicy } from '../queryPolicy';
import { scopedPath } from '../scope';
import { safeArray } from '@/lib/safeArray';
import { useMutationToast } from './_toastHelpers';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';

/**
 * Journey Autopilot: trip sessions + versioned plans. Reads the backend
 * routes registered in internal/api/router.go:
 *
 *   POST /journey/sessions
 *   GET  /journey/sessions?vehicle_id=&status=&limit=
 *   GET  /journey/sessions/{id}
 *   POST /journey/sessions/{id}/start|pause|resume|complete|abort
 *   POST /journey/sessions/{id}/plans
 *
 * `request()` prepends the version prefix automatically, so the paths below
 * must NOT include it. All field names are snake_case to mirror the Go JSON
 * tags. Durations are SI seconds; the UI converts at render.
 */

export type JourneyStatus = 'planned' | 'active' | 'paused' | 'completed' | 'aborted';

export interface JourneySession {
  id: number;
  vehicle_id: number;
  name: string;
  origin_name: string;
  origin_lat: number | null;
  origin_lng: number | null;
  dest_name: string;
  dest_lat: number | null;
  dest_lng: number | null;
  status: JourneyStatus;
  plan_version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface JourneyPlanVersion {
  id: number;
  session_id: number;
  version: number;
  plan: unknown;
  note: string;
  created_at: string;
}

export interface JourneyDetail {
  session: JourneySession;
  plans: JourneyPlanVersion[];
  next_statuses: JourneyStatus[];
}

export interface CreateJourneyRequest {
  vehicle_id: number;
  name: string;
  origin_name?: string;
  origin_lat?: number | null;
  origin_lng?: number | null;
  dest_name?: string;
  dest_lat?: number | null;
  dest_lng?: number | null;
}

export const journeyKeys = {
  all: ['journey'] as const,
  list: (vehicleId: number | null, status: string) =>
    ['journey', 'sessions', vehicleId, status] as const,
  detail: (id: number | null) => ['journey', 'session', id] as const,
};

function isValidVehicle(vehicleId: number | null | undefined): vehicleId is number {
  return vehicleId != null && vehicleId > 0;
}

/** Lists journey sessions for a vehicle, newest first. */
export function useJourneys(
  vehicleId: number | null | undefined,
  status = '',
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: journeyKeys.list(vehicleId ?? null, status),
    queryFn: ({ signal }) => {
      if (!isValidVehicle(vehicleId)) {
        throw new Error('vehicle_id must be a positive integer');
      }
      return request<JourneySession[]>(
        scopedPath('/journey/sessions', {
          vehicleId,
          filters: { status: status || null },
        }),
        { signal },
      );
    },
    enabled: (options?.enabled ?? true) && isValidVehicle(vehicleId),
    ...queryPolicy('operational'),
    select: safeArray,
  });
}

/** Reads one session with its plan history and reachable statuses. */
export function useJourney(id: number | null | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: journeyKeys.detail(id ?? null),
    queryFn: ({ signal }) =>
      request<JourneyDetail>(`/journey/sessions/${id}`, { signal }),
    enabled: (options?.enabled ?? true) && id != null && id > 0,
    ...queryPolicy('operational'),
  });
}

/** Plans a new journey (starts in `planned`). */
export function useCreateJourney() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (params: CreateJourneyRequest) =>
      request<JourneySession>('/journey/sessions', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: (session) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.all });
      success('toast.journey.create.success', 'Journey planned', {
        name: session.name,
      });
    },
    onError: (err) => error(err, 'toast.journey.create.error', 'Failed to plan journey'),
  });
}

export type JourneyTransition = 'start' | 'pause' | 'resume' | 'complete' | 'abort';

/** Moves a session along its status machine. */
export function useTransitionJourney() {
  const qc = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: JourneyTransition }) =>
      request<JourneySession>(`/journey/sessions/${id}/${action}`, { method: 'POST' }),
    onSuccess: (session) => {
      invalidateAndBroadcast(qc, { queryKey: journeyKeys.all });
      success('toast.journey.transition.success', 'Journey {{status}}', {
        status: session.status,
      });
    },
    onError: (err) => error(err, 'toast.journey.transition.error', 'Failed to update journey'),
  });
}
