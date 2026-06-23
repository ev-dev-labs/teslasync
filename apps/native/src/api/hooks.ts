import { useQuery } from '@tanstack/react-query';

import { request } from './client';
import type { Alert, SystemStatus, Vehicle } from './types';

export function useVehicles() {
  return useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts', 'latest'],
    queryFn: () => request<Alert[]>('/alerts?limit=10'),
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: () => request<SystemStatus>('/system/status'),
    staleTime: 15_000,
  });
}
