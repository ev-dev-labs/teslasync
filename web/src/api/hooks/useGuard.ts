import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
import { invalidateAndBroadcast } from '@/lib/queryBroadcast';
import { safeArray } from '@/lib/safeArray';

// ── Types ───────────────────────────────────────────────────────────────

export interface GuardConfig {
  vehicle_id: number;
  enabled: boolean;
  home_geofence_id: number | null;
  sensitivity: 'low' | 'medium' | 'high';
  auto_panic: boolean;
  created_at: string;
  updated_at: string;
}

/** Wire shape of a guard event.
 *
 *  Matches `database.GuardEvent` from `internal/database/guard_repo.go`
 *  exactly; do NOT add fields the backend does not emit. The guard
 *  events endpoint returns state-change records sourced from
 *  `security_events`, not legacy alert-shaped events (`vehicle_moved`,
 *  `unauthorized_drive`, …). `event_type` is therefore a free-form
 *  `string`, so the UI must use lookup-with-fallback for labels/icons
 *  rather than exhaustive switching.
 *
 *  `acknowledged` is DERIVED from `acknowledged_at != null`; the
 *  backend does not emit it as a separate boolean. */
export interface GuardEvent {
  id: number;
  vehicle_id: number;
  ts: string;
  event_type: string;
  from_state: string | null;
  to_state: string | null;
  details: Record<string, unknown> | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

/** Helper: a guard event is "acknowledged" iff acknowledged_at is set. */
export function isGuardEventAcknowledged(ev: Pick<GuardEvent, 'acknowledged_at'>): boolean {
  return ev.acknowledged_at != null;
}

/** Envelope returned by GET `/vehicles/{id}/guard/events`.
 *
 *  Mirrors `internal/api/guard_handler.go::GuardEventsResponse`. The
 *  envelope shape (vs a bare array) echoes `vehicle_id`; the frontend
 *  MUST NOT assume the response is an array — use `safeArray(data?.events)`
 *  (already done inside `useGuardEvents` via TanStack `select`). */
export interface GuardEventsResponse {
  vehicle_id: number;
  events: GuardEvent[];
}

interface SetConfigResponse {
  config: GuardConfig;
  arm_results: Record<string, string>;
}

interface PanicResponse {
  command_results: Record<string, string>;
  notified_channels: string[];
  event_id: number;
}

// ── Query Keys ──────────────────────────────────────────────────────────

export const guardKeys = {
  config: (vehicleId: number) => ['guard-config', vehicleId] as const,
  events: (vehicleId: number) => ['guard-events', vehicleId] as const,
};

// ── Hooks ───────────────────────────────────────────────────────────────

/**
 * Subscribes to the guard config (`GET /vehicles/{id}/guard`).
 *
 *  Backed by `guard_repo` over `security_events`; see
 *  `internal/api/guard_handler.go` and `internal/api/router.go:820-823`.
 */
export function useGuardConfig(vehicleId: number) {
  return useQuery({
    queryKey: guardKeys.config(vehicleId),
    queryFn: ({ signal }) => request<GuardConfig>(`/vehicles/${vehicleId}/guard`, { signal }),
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: INTERVALS.REALTIME,
  });
}

/**
 * Subscribes to the guard events feed.
 *
 *  The backend returns an envelope `{ vehicle_id, events: [...] }`;
 *  see `GuardEventsResponse`. We unwrap with `safeArray(data?.events)`
 *  inside TanStack's `select` so callers always receive `GuardEvent[]`
 *  and never need to defend against shape drift. This is the canonical
 *  way to absorb the contract change without a "bridge" layer.
 */
export function useGuardEvents(vehicleId: number) {
  return useQuery({
    queryKey: guardKeys.events(vehicleId),
    queryFn: ({ signal }) =>
      request<GuardEventsResponse>(`/vehicles/${vehicleId}/guard/events`, { signal }),
    select: (data): GuardEvent[] => safeArray<GuardEvent>(data?.events),
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.QUICK,
  });
}

/** Mutates the guard config (`POST /vehicles/{id}/guard`). */
export function useSetGuardConfig() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ vehicleId, ...body }: {
      vehicleId: number;
      enabled: boolean;
      home_geofence_id: number | null;
      sensitivity: string;
      auto_panic: boolean;
    }) =>
      request<SetConfigResponse>(`/vehicles/${vehicleId}/guard`, {
        method: 'POST',
        requiresLiveMode: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    networkMode: 'always',
    onSuccess: (_data, { vehicleId }) => {
      invalidateAndBroadcast(queryClient, { queryKey: guardKeys.config(vehicleId) });
      invalidateAndBroadcast(queryClient, { queryKey: guardKeys.events(vehicleId) });
      toast.success('Guard configuration updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update guard config: ${err.message}`);
    },
  });
}

/** Triggers a panic alert (`POST /vehicles/{id}/guard/panic`). */
export function useGuardPanic() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (vehicleId: number) =>
      request<PanicResponse>(`/vehicles/${vehicleId}/guard/panic`, {
        method: 'POST',
        requiresLiveMode: true,
      }),
    networkMode: 'always',
    onSuccess: (_data, vehicleId) => {
      invalidateAndBroadcast(queryClient, { queryKey: guardKeys.events(vehicleId) });
      toast.success('Panic alert triggered');
    },
    onError: (err: Error) => {
      toast.error(`Failed to trigger panic: ${err.message}`);
    },
  });
}

/**
 * Acknowledges a guard event
 * (`POST /vehicles/{id}/guard/events/{eventID}/acknowledge`).
 */
export function useAcknowledgeGuardEvent() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ vehicleId, eventId }: { vehicleId: number; eventId: number }) =>
      request<{ status: string }>(`/vehicles/${vehicleId}/guard/events/${eventId}/acknowledge`, {
        method: 'POST',
        requiresLiveMode: true,
      }),
    networkMode: 'always',
    onSuccess: (_data, { vehicleId }) => {
      invalidateAndBroadcast(queryClient, { queryKey: guardKeys.events(vehicleId) });
      toast.success('Event acknowledged');
    },
    onError: (err: Error) => {
      toast.error(`Failed to acknowledge event: ${err.message}`);
    },
  });
}
