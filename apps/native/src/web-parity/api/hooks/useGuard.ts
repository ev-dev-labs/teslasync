import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

import { request } from '../client';
import { useMutationToast } from './_toastHelpers';

const INTERVALS = {
  REALTIME: 5_000,
} as const;

const STALE_TIMES = {
  REALTIME: 5_000,
  QUICK: 10_000,
} as const;

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

export const nativeGuardHookCapabilities = {
  queryBroadcastAvailable: false,
  localQueryInvalidation: true,
  mutationFeedbackPrimitive: 'Alert.alert',
} as const;

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

function invalidateAndBroadcast(
  qc: QueryClient,
  filters: { queryKey: QueryKey },
): void {
  void qc.invalidateQueries(filters);
}

export interface GuardConfig {
  vehicle_id: number;
  enabled: boolean;
  home_geofence_id: number | null;
  sensitivity: 'low' | 'medium' | 'high';
  auto_panic: boolean;
  created_at: string;
  updated_at: string;
}

/** Wire shape of a guard event. */
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
export function isGuardEventAcknowledged(
  ev: Pick<GuardEvent, 'acknowledged_at'>,
): boolean {
  return ev.acknowledged_at != null;
}

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

export const guardKeys = {
  config: (vehicleId: number) => ['guard-config', vehicleId] as const,
  events: (vehicleId: number) => ['guard-events', vehicleId] as const,
};

/**
 * Subscribes to the guard config (`GET /vehicles/{id}/guard`).
 */
export function useGuardConfig(vehicleId: number) {
  return useQuery({
    queryKey: guardKeys.config(vehicleId),
    queryFn: ({ signal }) =>
      request<GuardConfig>(`/vehicles/${vehicleId}/guard`, { signal }),
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: INTERVALS.REALTIME,
  });
}

/**
 * Subscribes to the guard events feed and unwraps the backend envelope.
 */
export function useGuardEvents(vehicleId: number) {
  return useQuery({
    queryKey: guardKeys.events(vehicleId),
    queryFn: ({ signal }) =>
      request<GuardEventsResponse>(`/vehicles/${vehicleId}/guard/events`, {
        signal,
      }),
    select: (data): GuardEvent[] => safeArray<GuardEvent>(data?.events),
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.QUICK,
  });
}

/** Mutates the guard config (`POST /vehicles/{id}/guard`). */
export function useSetGuardConfig() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: ({
      vehicleId,
      ...body
    }: {
      vehicleId: number;
      enabled: boolean;
      home_geofence_id: number | null;
      sensitivity: string;
      auto_panic: boolean;
    }) =>
      request<SetConfigResponse>(`/vehicles/${vehicleId}/guard`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, { vehicleId }) => {
      invalidateAndBroadcast(queryClient, {
        queryKey: guardKeys.config(vehicleId),
      });
      invalidateAndBroadcast(queryClient, {
        queryKey: guardKeys.events(vehicleId),
      });
      success('toast.guard.config.success', 'Guard configuration updated');
    },
    onError: err => {
      error(err, 'toast.guard.config.error', 'Failed to update guard config');
    },
  });
}

/** Triggers a panic alert (`POST /vehicles/{id}/guard/panic`). */
export function useGuardPanic() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: (vehicleId: number) =>
      request<PanicResponse>(`/vehicles/${vehicleId}/guard/panic`, {
        method: 'POST',
      }),
    onSuccess: (_data, vehicleId) => {
      invalidateAndBroadcast(queryClient, {
        queryKey: guardKeys.events(vehicleId),
      });
      success('toast.guard.panic.success', 'Panic alert triggered');
    },
    onError: err => {
      error(err, 'toast.guard.panic.error', 'Failed to trigger panic');
    },
  });
}

/**
 * Acknowledges a guard event
 * (`POST /vehicles/{id}/guard/events/{eventID}/acknowledge`).
 */
export function useAcknowledgeGuardEvent() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();

  return useMutation({
    mutationFn: ({
      vehicleId,
      eventId,
    }: {
      vehicleId: number;
      eventId: number;
    }) =>
      request<{ status: string }>(
        `/vehicles/${vehicleId}/guard/events/${eventId}/acknowledge`,
        {
          method: 'POST',
        },
      ),
    onSuccess: (_data, { vehicleId }) => {
      invalidateAndBroadcast(queryClient, {
        queryKey: guardKeys.events(vehicleId),
      });
      success('toast.guard.ack.success', 'Event acknowledged');
    },
    onError: err => {
      error(err, 'toast.guard.ack.error', 'Failed to acknowledge event');
    },
  });
}
