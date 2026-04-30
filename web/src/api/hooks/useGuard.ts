import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';

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

export interface GuardEvent {
  id: number;
  vehicle_id: number;
  event_type: 'vehicle_moved' | 'unauthorized_unlock' | 'unauthorized_drive' | 'sentry_triggered' | 'manual_panic' | 'test_alert';
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  details: Record<string, unknown> | null;
  notified_channels: string[] | null;
  acknowledged: boolean;
  acknowledged_at: string | null;
  created_at: string;
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

export function useGuardConfig(vehicleId: number) {
  return useQuery({
    queryKey: guardKeys.config(vehicleId),
    queryFn: () => request<GuardConfig>(`/vehicles/${vehicleId}/guard`),
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.REALTIME,
    refetchInterval: INTERVALS.REALTIME,
  });
}

export function useGuardEvents(vehicleId: number) {
  return useQuery({
    queryKey: guardKeys.events(vehicleId),
    queryFn: () => request<GuardEvent[]>(`/vehicles/${vehicleId}/guard/events`),
    enabled: vehicleId > 0,
    staleTime: STALE_TIMES.QUICK,
  });
}

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: guardKeys.config(vehicleId) });
      queryClient.invalidateQueries({ queryKey: guardKeys.events(vehicleId) });
      toast.success('Guard configuration updated');
    },
    onError: (err: Error) => {
      toast.error(`Failed to update guard config: ${err.message}`);
    },
  });
}

export function useGuardPanic() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (vehicleId: number) =>
      request<PanicResponse>(`/vehicles/${vehicleId}/guard/panic`, {
        method: 'POST',
      }),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: guardKeys.events(vehicleId) });
      toast.success('Panic alert triggered');
    },
    onError: (err: Error) => {
      toast.error(`Failed to trigger panic: ${err.message}`);
    },
  });
}

export function useAcknowledgeGuardEvent() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ vehicleId, eventId }: { vehicleId: number; eventId: number }) =>
      request<{ status: string }>(`/vehicles/${vehicleId}/guard/events/${eventId}/acknowledge`, {
        method: 'POST',
      }),
    onSuccess: (_data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: guardKeys.events(vehicleId) });
      toast.success('Event acknowledged');
    },
    onError: (err: Error) => {
      toast.error(`Failed to acknowledge event: ${err.message}`);
    },
  });
}
