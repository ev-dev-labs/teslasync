import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { STALE_TIMES } from '@/lib/constants';
import { useMutationToast } from './_toastHelpers';
import type { VehicleDriver, VehicleInvitation } from '../types';

export const vehicleAccessKeys = {
  drivers: (id: string) => ['vehicle-drivers', id] as const,
  invitations: (id: string) => ['vehicle-invitations', id] as const,
};

// ── Queries ──────────────────────────────────────────────────────

export function useVehicleDrivers(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleAccessKeys.drivers(vehicleId ?? ''),
    queryFn: ({ signal }) => request<VehicleDriver[]>(`/vehicles/${vehicleId}/drivers`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

export function useVehicleInvitations(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleAccessKeys.invitations(vehicleId ?? ''),
    queryFn: ({ signal }) => request<VehicleInvitation[]>(`/vehicles/${vehicleId}/invitations`, { signal }),
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.STANDARD,
    select: safeArray,
  });
}

// ── Mutations ────────────────────────────────────────────────────

export function useRefreshVehicleDrivers() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      request<VehicleDriver[]>(`/vehicles/${vehicleId}/drivers/refresh`, { method: 'POST' }),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.drivers(vehicleId) });
      success('toast.vehicleAccess.drivers.refresh.success', 'Drivers refreshed');
    },
    onError: (err) => error(err, 'toast.vehicleAccess.drivers.refresh.error', 'Failed to refresh drivers'),
  });
}

export function useRefreshVehicleInvitations() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      request<VehicleInvitation[]>(`/vehicles/${vehicleId}/invitations/refresh`, { method: 'POST' }),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.invitations(vehicleId) });
      success('toast.vehicleAccess.invitations.refresh.success', 'Invitations refreshed');
    },
    onError: (err) => error(err, 'toast.vehicleAccess.invitations.refresh.error', 'Failed to refresh invitations'),
  });
}

export function useRemoveVehicleDriver() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ vehicleId, shareUserId }: { vehicleId: string; shareUserId: number }) =>
      request<void>(`/vehicles/${vehicleId}/drivers`, {
        method: 'DELETE',
        body: JSON.stringify({ share_user_id: shareUserId }),
      }),
    onSuccess: (_data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.drivers(vehicleId) });
      success('toast.vehicleAccess.drivers.remove.success', 'Driver removed');
    },
    onError: (err) => error(err, 'toast.vehicleAccess.drivers.remove.error', 'Failed to remove driver'),
  });
}

export function useCreateVehicleInvitation() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: (vehicleId: string) =>
      request<VehicleInvitation>(`/vehicles/${vehicleId}/invitations`, { method: 'POST' }),
    onSuccess: (_data, vehicleId) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.invitations(vehicleId) });
      success('toast.vehicleAccess.invitations.create.success', 'Invitation created');
    },
    onError: (err) => error(err, 'toast.vehicleAccess.invitations.create.error', 'Failed to create invitation'),
  });
}

export function useRevokeVehicleInvitation() {
  const queryClient = useQueryClient();
  const { success, error } = useMutationToast();
  return useMutation({
    mutationFn: ({ vehicleId, invitationId }: { vehicleId: string; invitationId: string }) =>
      request<void>(`/vehicles/${vehicleId}/invitations/${invitationId}/revoke`, { method: 'POST' }),
    onSuccess: (_data, { vehicleId }) => {
      queryClient.invalidateQueries({ queryKey: vehicleAccessKeys.invitations(vehicleId) });
      success('toast.vehicleAccess.invitations.revoke.success', 'Invitation revoked');
    },
    onError: (err) => error(err, 'toast.vehicleAccess.invitations.revoke.error', 'Failed to revoke invitation'),
  });
}
