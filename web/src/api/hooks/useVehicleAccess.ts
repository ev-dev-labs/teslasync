import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';
import { useToast } from '@/components/feedback/Toast';
import type { VehicleDriver, VehicleInvitation } from '../types';

export const vehicleAccessKeys = {
  drivers: (id: string) => ['vehicle-drivers', id] as const,
  invitations: (id: string) => ['vehicle-invitations', id] as const,
};

// ── Queries ──────────────────────────────────────────────────────

export function useVehicleDrivers(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleAccessKeys.drivers(vehicleId ?? ''),
    queryFn: () => request<VehicleDriver[]>(`/vehicles/${vehicleId}/drivers`),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useVehicleInvitations(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleAccessKeys.invitations(vehicleId ?? ''),
    queryFn: () => request<VehicleInvitation[]>(`/vehicles/${vehicleId}/invitations`),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

// ── Mutations ────────────────────────────────────────────────────

export function useRefreshVehicleDrivers() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      request<VehicleDriver[]>(`/vehicles/${vehicleId}/drivers/refresh`, { method: 'POST' }),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.drivers(vehicleId) });
      toast.success('Drivers refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh drivers: ${err.message}`);
    },
  });
}

export function useRefreshVehicleInvitations() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      request<VehicleInvitation[]>(`/vehicles/${vehicleId}/invitations/refresh`, { method: 'POST' }),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.invitations(vehicleId) });
      toast.success('Invitations refreshed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to refresh invitations: ${err.message}`);
    },
  });
}

export function useRemoveVehicleDriver() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ vehicleId, shareUserId }: { vehicleId: string; shareUserId: number }) =>
      request<void>(`/vehicles/${vehicleId}/drivers`, {
        method: 'DELETE',
        body: JSON.stringify({ share_user_id: shareUserId }),
      }),
    onSuccess: (_data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.drivers(vehicleId) });
      toast.success('Driver removed');
    },
    onError: (err: Error) => {
      toast.error(`Failed to remove driver: ${err.message}`);
    },
  });
}

export function useCreateVehicleInvitation() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      request<VehicleInvitation>(`/vehicles/${vehicleId}/invitations`, { method: 'POST' }),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.invitations(vehicleId) });
      toast.success('Invitation created');
    },
    onError: (err: Error) => {
      toast.error(`Failed to create invitation: ${err.message}`);
    },
  });
}

export function useRevokeVehicleInvitation() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ vehicleId, invitationId }: { vehicleId: string; invitationId: string }) =>
      request<void>(`/vehicles/${vehicleId}/invitations/${invitationId}/revoke`, { method: 'POST' }),
    onSuccess: (_data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.invitations(vehicleId) });
      toast.success('Invitation revoked');
    },
    onError: (err: Error) => {
      toast.error(`Failed to revoke invitation: ${err.message}`);
    },
  });
}
