import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
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
    queryFn: ({ signal }) => request<ClimateState>(`/climate/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useClimateHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.climateHistory(vehicleId),
    queryFn: ({ signal }) => request<ClimateState[]>(`/climate?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useTirePressure(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.tirePressure(vehicleId),
    queryFn: ({ signal }) => request<TirePressureReading>(`/tire-pressure/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useTirePressureHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.tirePressureHistory(vehicleId),
    queryFn: ({ signal }) => request<TirePressureReading[]>(`/tire-pressure?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useMaintenance() {
  return useQuery({
    queryKey: vehicleSystemsKeys.maintenance,
    queryFn: ({ signal }) => request<MaintenanceItem[]>('/maintenance', { signal }),
    retry: false,
    staleTime: STALE_TIMES.STATIC,
    select: safeArray,
  });
}

export function useServiceRecords() {
  return useQuery({
    queryKey: vehicleSystemsKeys.serviceRecords,
    queryFn: ({ signal }) => request<ServiceRecord[]>('/maintenance/records', { signal }),
    retry: false,
    staleTime: STALE_TIMES.STATIC,
    select: safeArray,
  });
}

export function useSoftwareUpdates(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.softwareUpdates(vehicleId),
    queryFn: ({ signal }) => request<SoftwareUpdate[]>('/software-updates', { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useSafety(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safety(vehicleId),
    queryFn: ({ signal }) => request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useSafetyHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safetyHistory(vehicleId),
    queryFn: ({ signal }) => request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useMedia(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.media(vehicleId),
    queryFn: ({ signal }) => request<MediaSnapshot>(`/media/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useMediaHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.mediaHistory(vehicleId),
    queryFn: ({ signal }) => request<MediaSnapshot[]>(`/media?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}
