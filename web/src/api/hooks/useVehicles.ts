import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../client';
import type { Vehicle } from '@/types/vehicle';

export const vehicleKeys = {
  all: ['vehicles'] as const,
  detail: (id: string) => ['vehicles', id] as const,
};

export function useVehicles() {
  return useQuery({
    queryKey: vehicleKeys.all,
    queryFn: () => request<Vehicle[]>('/vehicles'),
    staleTime: 30_000,
  });
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: vehicleKeys.detail(id),
    queryFn: () => request<Vehicle>(`/vehicles/${id}`),
    enabled: !!id,
  });
}

export function useRefreshVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<Vehicle>(`/vehicles/${id}/refresh`, { method: 'POST' }),
    onSuccess: (data, id) => {
      queryClient.setQueryData(vehicleKeys.detail(id), data);
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request<void>(`/vehicles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
    },
  });
}
