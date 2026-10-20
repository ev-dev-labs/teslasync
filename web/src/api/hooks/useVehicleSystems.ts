import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { safeArray } from '@/lib/safeArray';
import { INTERVALS, STALE_TIMES } from '@/lib/constants';
import { isDriveDateBound, type DriveWindow } from './useDriving';
import type { ClimateState, TirePressureReading, MaintenanceItem, ServiceRecord, SoftwareUpdate, SafetySnapshot, MaintenanceForecast } from '@/types/vehicle-systems';
// MediaSnapshot must be the canonical snake_case shape that matches the Go
// media handler JSON tags (now_playing_title, playback_source, audio_volume,
// created_at, …). The camelCase MediaSnapshot in @/types/vehicle-systems does
// NOT match the wire shape, so the API-layer type is authoritative here.
import type { MediaSnapshot } from '@/api/types';

export const vehicleSystemsKeys = {
  climate: (vehicleId: string) => ['climate', vehicleId] as const,
  climateHistory: (vehicleId: string, start = '', end = '') =>
    start || end
      ? ['climate', 'history', vehicleId, start, end] as const
      : ['climate', 'history', vehicleId] as const,
  tirePressure: (vehicleId: string) => ['tire-pressure', vehicleId] as const,
  tirePressureHistory: (vehicleId: string) => ['tire-pressure', 'history', vehicleId] as const,
  tirePressureAnalysisHistory: (vehicleId: string, days: number, range?: Pick<DriveWindow, 'start' | 'end'>) =>
    range
      ? ['tire-pressure', 'analysis-history', vehicleId, days, range.start ?? null, range.end ?? null] as const
      : ['tire-pressure', 'analysis-history', vehicleId, days] as const,
  maintenance: ['maintenance'] as const,
  serviceRecords: ['service-records'] as const,
  softwareUpdates: (vehicleId: string) => ['software-updates', vehicleId] as const,
  safety: (vehicleId: string) => ['safety', vehicleId] as const,
  safetyHistory: (vehicleId: string) => ['safety', 'history', vehicleId] as const,
  media: (vehicleId: string) => ['media', vehicleId] as const,
  mediaHistory: (vehicleId: string, start = '', end = '') =>
    start || end
      ? ['media', 'history', vehicleId, start, end] as const
      : ['media', 'history', vehicleId] as const,
};

export function useClimate(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.climate(vehicleId),
    queryFn: ({ signal }) => request<ClimateState>(`/climate/latest?vehicle_id=${vehicleId}`, { signal }),
    enabled: !!vehicleId,
    refetchInterval: INTERVALS.STANDARD,
  });
}

/**
 * Workspace bounds are inclusive start / exclusive end instants, passed unchanged.
 * Omitting the range preserves the endpoint's default seven-day history.
 */
export function useClimateHistory(
  vehicleId: string,
  range?: { start?: string; end?: string },
) {
  const start = range?.start ?? '';
  const end = range?.end ?? '';
  return useQuery({
    queryKey: vehicleSystemsKeys.climateHistory(vehicleId, start, end),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<ClimateState[]>(`/climate?${params.toString()}`, { signal });
    },
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

/** Workspace bounds override the legacy rolling window; the server filters the complete TPMS timeline. */
export function useTirePressureAnalysisHistory(
  vehicleId: string,
  days = 30,
  range?: Pick<DriveWindow, 'start' | 'end'>,
) {
  const boundedDays = Number.isFinite(days)
    ? Math.max(1, Math.min(365, Math.floor(days)))
    : 30;
  return useQuery({
    queryKey: vehicleSystemsKeys.tirePressureAnalysisHistory(vehicleId, boundedDays, range),
    queryFn: ({ signal }) => {
      if (range && (!range.start || !range.end
        || !isDriveDateBound(range.start) || !isDriveDateBound(range.end)
        || Date.parse(range.start) >= Date.parse(range.end))) {
        throw new Error('Tire pressure analysis requires a valid start and end date range');
      }
      const start = range?.start ?? new Date(Date.now() - boundedDays * 86_400_000).toISOString();
      const params = new URLSearchParams({ vehicle_id: vehicleId, start });
      if (range?.end) params.set('end', range.end);
      return request<TirePressureReading[]>(
        `/tire-pressure?${params}`,
        { signal },
      );
    },
    enabled: !!vehicleId,
    staleTime: STALE_TIMES.MODERATE,
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

/** Fetches the wear-based maintenance forecast (defaults to first vehicle). */
export function useMaintenanceForecast(vehicleId?: number) {
  return useQuery({
    queryKey: [...vehicleSystemsKeys.maintenance, 'forecast', vehicleId] as const,
    queryFn: ({ signal }) =>
      request<MaintenanceForecast>(
        `/maintenance/forecast${vehicleId ? `?vehicle_id=${vehicleId}` : ''}`,
        { signal },
      ),
    retry: false,
    staleTime: STALE_TIMES.STATIC,
  });
}

export function useSoftwareUpdates(vehicleId: string) {
  return useQuery({
    queryKey: vehicleSystemsKeys.softwareUpdates(vehicleId),
    // The query is keyed + gated per vehicle, so the request MUST scope to that
    // vehicle. The backend /software-updates handler filters by the vehicle_id
    // query param; omitting it returned every vehicle's updates under a
    // per-vehicle cache key (stale cross-vehicle data).
    queryFn: ({ signal }) =>
      request<SoftwareUpdate[]>(`/software-updates?vehicle_id=${vehicleId}`, { signal }),
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

/** Workspace callers pass their inclusive start and exclusive end instants unchanged. */
export function useMediaHistory(
  vehicleId: string,
  range?: { start?: string; end?: string },
) {
  const start = range?.start ?? '';
  const end = range?.end ?? '';
  return useQuery({
    queryKey: vehicleSystemsKeys.mediaHistory(vehicleId, start, end),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ vehicle_id: vehicleId });
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      return request<MediaSnapshot[]>(`/media?${params.toString()}`, { signal });
    },
    enabled: !!vehicleId,
    select: safeArray,
  });
}
