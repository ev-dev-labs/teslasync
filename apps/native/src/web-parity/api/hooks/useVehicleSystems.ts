import { useQuery } from '@tanstack/react-query';

import { request } from '../client';

const INTERVALS = {
  STANDARD: 30_000,
} as const;

const STALE_TIMES = {
  STATIC: Infinity,
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

export interface ClimateState {
  id?: number;
  created_at?: string;
  timestamp?: string;
  insideTemp?: number | null;
  outsideTemp?: number | null;
  driverTempSetting?: number | null;
  passengerTempSetting?: number | null;
  hvacPower?: string | null;
  isAcOn?: boolean | null;
  hvacAutoMode?: string | null;
  fanSpeed?: number | null;
  hvacFanStatus?: number | null;
  climateKeeperMode?: string | null;
  defrostMode?: string | null;
  defrostForPreconditioning?: boolean | null;
  rearDefrostEnabled?: boolean | null;
  wiperHeatEnabled?: boolean | null;
  rearDisplayHvacEnabled?: boolean | null;
  batteryHeater?: boolean | null;
  overheatProtection?: string | null;
  cabinOverheatProtectionTempLimit?: string | null;
  hvacSteeringWheelHeatAuto?: boolean | null;
  hvacSteeringWheelHeatLevel?: number | null;
  seatHeaterLeft?: number | null;
  seatHeaterRight?: number | null;
  seatHeaterRearLeft?: number | null;
  seatHeaterRearRight?: number | null;
  seatHeaterRearCenter?: number | null;
  autoSeatClimateLeft?: boolean | null;
  autoSeatClimateRight?: boolean | null;
  climateSeatCoolingFrontLeft?: number | null;
  climateSeatCoolingFrontRight?: number | null;
  seatVentEnabled?: boolean | null;
}

export interface TirePressureReading {
  id: string;
  vehicleId: string;
  frontLeft: number;
  frontRight: number;
  rearLeft: number;
  rearRight: number;
  tpmsHardWarning: boolean;
  tpmsSoftWarning: boolean;
  timestamp: string;
}

export type TirePosition = 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight';
export type TireStatus = 'normal' | 'warning' | 'critical';

export interface MaintenanceItem {
  id: string;
  name: string;
  description: string;
  intervalKm: number;
  intervalMonths: number;
  category: string;
  estimatedCostUsd: number;
}

export interface ServiceRecord {
  itemId: string;
  date: string;
  odometerKm: number;
  notes: string;
}

export type MaintenanceStatus = 'good' | 'soon' | 'overdue';

export interface SoftwareUpdate {
  id: string;
  vehicleId: string;
  version: string;
  status: 'installed' | 'installing' | 'downloading' | 'available' | 'scheduled';
  installedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
}

export interface SafetySnapshot {
  id?: number;
  vehicle_id?: number;
  automatic_blind_spot_camera?: boolean | null;
  automatic_emergency_braking_off?: boolean | null;
  blind_spot_collision_warning?: boolean | null;
  cruise_follow_distance?: string | boolean | number | null;
  emergency_lane_departure_avoidance?: boolean | null;
  forward_collision_warning?: string | boolean | number | null;
  lane_departure_avoidance?: string | boolean | number | null;
  speed_limit_warning?: string | boolean | number | null;
  pin_to_drive_enabled?: boolean | null;
  miles_since_reset?: number | null;
  self_driving_miles_since_reset?: number | null;
  created_at?: string;
}

export interface MediaSnapshot {
  id: string;
  vehicleId: string;
  title: string;
  artist: string;
  album: string;
  station: string;
  source: string;
  playbackStatus: string;
  volume: number;
  volumeMax: number;
  elapsed: number;
  duration: number;
  timestamp: string;
}

export const vehicleSystemsKeys = {
  climate: (vehicleId: string) => ['climate', vehicleId] as const,
  climateHistory: (vehicleId: string) => ['climate', 'history', vehicleId] as const,
  tirePressure: (vehicleId: string) => ['tire-pressure', vehicleId] as const,
  tirePressureHistory: (vehicleId: string) =>
    ['tire-pressure', 'history', vehicleId] as const,
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
    queryFn: ({ signal }) =>
      request<ClimateState>(`/climate/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useClimateHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.climateHistory(vehicleId),
    queryFn: ({ signal }) =>
      request<ClimateState[]>(`/climate?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useTirePressure(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.tirePressure(vehicleId),
    queryFn: ({ signal }) =>
      request<TirePressureReading>(`/tire-pressure/latest?vehicle_id=${vehicleId}`, {
        signal,
      }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useTirePressureHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.tirePressureHistory(vehicleId),
    queryFn: ({ signal }) =>
      request<TirePressureReading[]>(`/tire-pressure?vehicle_id=${vehicleId}`, {
        signal,
      }),
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
    queryFn: ({ signal }) =>
      request<ServiceRecord[]>('/maintenance/records', { signal }),
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
    queryFn: ({ signal }) =>
      request<SafetySnapshot>(`/safety/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useSafetyHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.safetyHistory(vehicleId),
    queryFn: ({ signal }) =>
      request<SafetySnapshot[]>(`/safety?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}

export function useMedia(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.media(vehicleId),
    queryFn: ({ signal }) =>
      request<MediaSnapshot>(`/media/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

export function useMediaHistory(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.mediaHistory(vehicleId),
    queryFn: ({ signal }) =>
      request<MediaSnapshot[]>(`/media?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    select: safeArray,
  });
}
