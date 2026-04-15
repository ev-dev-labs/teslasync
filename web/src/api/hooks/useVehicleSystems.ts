import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import type { ClimateState, TirePressureReading, MaintenanceItem, ServiceRecord, SoftwareUpdate, SafetySnapshot, MediaSnapshot } from '@/types/vehicle-systems';

export const vehicleSystemsKeys = {
  climate: (vehicleId: string) => ['climate', vehicleId] as const,
  climateHistory: (vehicleId: string) => ['climate', 'history', vehicleId] as const,
  tirePressure: (vehicleId: string) => ['tire-pressure', vehicleId] as const,
  tirePressureHistory: (vehicleId: string) => ['tire-pressure', 'history', vehicleId] as const,
  maintenance: ['maintenance'] as const,
  serviceRecords: ['service-records'] as const,
  softwareUpdates: (vehicleId: string) => ['software-updates', vehicleId] as const,
  safety: (vehicleId: string) => ['safety', vehicleId] as const,
  safetyHistory: (vehicleId: string) => ['safety', 'history', vehicleId] as const,
  media: (vehicleId: string) => ['media', vehicleId] as const,
  mediaHistory: (vehicleId: string) => ['media', 'history', vehicleId] as const,
};

export function useClimate(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.climate(vehicleId),
    queryFn: () => request<ClimateState>(`/climate/latest?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    refetchInterval: 30_000,
  });
}

export function useClimateHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.climateHistory(vehicleId),
    queryFn: () => request<ClimateState[]>(`/climate?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useTirePressure(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.tirePressure(vehicleId),
    queryFn: () => request<TirePressureReading>(`/tire-pressure/latest?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    refetchInterval: 30_000,
  });
}

export function useTirePressureHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.tirePressureHistory(vehicleId),
    queryFn: () => request<TirePressureReading[]>(`/tire-pressure?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useMaintenance() {
  return useQuery({
    queryKey: vehicleSystemsKeys.maintenance,
    queryFn: () => request<MaintenanceItem[]>('/maintenance'),
    retry: false,
    staleTime: Infinity,
    select: safeArray,
  });
}

export function useServiceRecords() {
  return useQuery({
    queryKey: vehicleSystemsKeys.serviceRecords,
    queryFn: () => request<ServiceRecord[]>('/maintenance/records'),
    retry: false,
    staleTime: Infinity,
    select: safeArray,
  });
}

export function useSoftwareUpdates(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.softwareUpdates(vehicleId),
    queryFn: () => request<SoftwareUpdate[]>('/software-updates'),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useSafety(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safety(vehicleId),
    queryFn: () => request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    refetchInterval: 30_000,
  });
}

export function useSafetyHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safetyHistory(vehicleId),
    queryFn: () => request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useMedia(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.media(vehicleId),
    queryFn: () => request<MediaSnapshot>(`/media/latest?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    refetchInterval: 30_000,
  });
}

export function useMediaHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.mediaHistory(vehicleId),
    queryFn: () => request<MediaSnapshot[]>(`/media?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,
    select: safeArray,
  });
}
