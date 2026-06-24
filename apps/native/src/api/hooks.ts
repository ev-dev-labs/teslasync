import { useQuery } from '@tanstack/react-query';

import { request } from './client';
import type {
  Alert,
  AppSettings,
  AuthModeResponse,
  ChargingSession,
  Drive,
  SystemStatus,
  UnknownApiObject,
  Vehicle,
} from './types';

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

export function useDrives() {
  return useQuery({
    queryKey: ['drives', 'latest'],
    queryFn: () => request<Drive[]>('/drives?limit=20'),
  });
}

export function useChargingSessions() {
  return useQuery({
    queryKey: ['charging', 'latest'],
    queryFn: () => request<ChargingSession[]>('/charging?limit=20'),
  });
}

export function useVehicleEnergy(vehicleId: number | null) {
  return useQuery({
    queryKey: ['vehicles', vehicleId, 'energy'],
    queryFn: () => request<UnknownApiObject>(`/vehicles/${vehicleId}/energy`),
    enabled: vehicleId != null,
  });
}

export function useAuthMode() {
  return useQuery({
    queryKey: ['auth', 'mode'],
    queryFn: () => request<AuthModeResponse>('/system/auth-mode'),
    staleTime: 5 * 60_000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => request<AppSettings>('/settings'),
  });
}
